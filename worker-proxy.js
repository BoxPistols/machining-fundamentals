// =============================================================================
// machining-fundamentals プロキシ for Cloudflare Workers
//
// ルート:
//   /v1/tts 他    → xAI Grok TTS プロキシ (既存)
//   /api/chat    → Chat AI (OpenAI / Gemini、3 ティア)
//
// Chat AI 3 ティア:
//   Anonymous  — ヘッダなし。サーバ側 OPENAI_API_KEY/GEMINI_API_KEY を使用、50 req/day
//   Invited    — X-Invite-Code ヘッダ有効。100 req/day、maxUsers bind
//   BYOK       — Authorization: Bearer sk-... / AIza... 直接転送、無制限
//
// 必要な Cloudflare 設定:
//   Variables and Secrets:
//     XAI_API_KEY            (Secret)  TTS Shared モード用 xAI キー (TTS を使うなら必須)
//     OPENAI_API_KEY         (Secret)  Chat Anonymous/Invited 用 OpenAI キー
//     GEMINI_API_KEY         (Secret)  Chat Anonymous/Invited 用 Google AI Studio キー
//     ALLOWED_ORIGIN         (Text)    "https://machining-fundamentals.vercel.app" 推奨
//     PROXY_SHARED_SECRET    (Secret)  BYOK 利用時の追加認証 (任意)
//     RATE_LIMIT_PER_DAY     (Text)    TTS 1日上限。省略時 30
//     CHAT_LIMIT_ANON_REQ    (Text)    Chat Anon req/日。省略時 50
//     CHAT_LIMIT_INVITED_REQ (Text)    Chat Invited req/日。省略時 100
//     CHAT_LIMIT_TOKENS_ANON (Text)    Chat Anon token/日。省略時 150000
//     CHAT_LIMIT_TOKENS_INVITED (Text) Chat Invited token/日。省略時 300000
//     CHAT_MAX_INPUT_TOKENS  (Text)    1リクエスト入力上限。省略時 4000
//     CHAT_MAX_OUTPUT_TOKENS (Text)    1リクエスト出力上限。省略時 800
//   Bindings:
//     RATE_LIMIT_KV    (KV Namespace)  TTS + Chat 日次カウンタ
//     INVITE_KV        (KV Namespace)  招待コード管理 (Chat 用、任意 — 未設定時は invite 無効)
// =============================================================================

const DEFAULT_ALLOWED_ORIGIN = "*";
const DEFAULT_RATE_LIMIT = 30;
const XAI_API_BASE = "https://api.x.ai";
const OPENAI_API_BASE = "https://api.openai.com/v1/chat/completions";
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const CHAT_DEFAULTS = {
  anonReq: 50,
  invitedReq: 100,
  anonTokens: 150000,
  invitedTokens: 300000,
  maxInputTokens: 4000,
  maxOutputTokens: 800,
  defaultTemperature: 0.3,
};

function corsHeaders(allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Proxy-Secret",
    "Access-Control-Expose-Headers":
      "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Proxy-Mode",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function nextMidnightUtcEpoch() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

// IP+UA を複合キーにする (オフィス NAT で UA が違えば別カウンタになり誤巻き込みを抑制)
async function buildClientKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ua = request.headers.get("User-Agent") || "";
  return await sha256Hex(`${ip}::${ua}`);
}

// 日次カウンタ (KV)。インクリメント方式。
// 注: KV は eventual consistency。短時間の連打で +1 ずつぶれる可能性はあるが
//     1日30件規模ならビジネス影響なしと割り切る。
async function consumeRateLimit(env, request) {
  const limit = parseInt(env.RATE_LIMIT_PER_DAY) || DEFAULT_RATE_LIMIT;
  const resetAt = nextMidnightUtcEpoch();

  if (!env.RATE_LIMIT_KV) {
    // KV 未バインド時はカウンタなしで通すが、ヘッダで明示
    return { allowed: true, limit, remaining: -1, resetAt, kv: false };
  }

  const userKey = await buildClientKey(request);
  const counterKey = `rl:${todayUtc()}:${userKey}`;
  const current = parseInt(await env.RATE_LIMIT_KV.get(counterKey)) || 0;

  if (current >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt, kv: true };
  }

  await env.RATE_LIMIT_KV.put(counterKey, String(current + 1), {
    expirationTtl: 60 * 60 * 24 * 2, // 2日後に自動消滅
  });

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - (current + 1)),
    resetAt,
    kv: true,
  };
}

function jsonError(status, message, extraHeaders, allowedOrigin) {
  return new Response(JSON.stringify({ error: { status, message } }), {
    status,
    headers: {
      ...corsHeaders(allowedOrigin),
      "Content-Type": "application/json; charset=utf-8",
      ...(extraHeaders || {}),
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const cors = corsHeaders(allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Headers":
            "Authorization, Content-Type, X-Proxy-Secret, X-Invite-Code, X-Chat-Model",
        },
      });
    }

    const url = new URL(request.url);
    // ルーティング
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env, ctx, allowedOrigin);
    }

    // 既存: xAI プロキシ (/v1/tts 等)
    return handleXaiProxy(request, env, allowedOrigin);
  },
};

// =============================================================================
// 既存: xAI TTS プロキシ (関数化して router から呼ぶ)
// =============================================================================
async function handleXaiProxy(request, env, allowedOrigin) {
  const cors = corsHeaders(allowedOrigin);
  const clientAuth = request.headers.get("Authorization");
  const isByok = !!clientAuth;
  let upstreamAuth;
  let rl = null;
  const mode = isByok ? "byok" : "shared";

  if (isByok) {
    const sharedSecret = env.PROXY_SHARED_SECRET;
    if (sharedSecret) {
      const got = request.headers.get("X-Proxy-Secret") || "";
      if (got !== sharedSecret) {
        return jsonError(401, "Proxy secret mismatch", {}, allowedOrigin);
      }
    }
    upstreamAuth = clientAuth;
  } else {
    if (!env.XAI_API_KEY) {
      return jsonError(
        503,
        "Shared API key not configured on this proxy. Set your own xAI API key in settings (BYOK mode).",
        {},
        allowedOrigin
      );
    }
    rl = await consumeRateLimit(env, request);
    if (!rl.allowed) {
      return jsonError(
        429,
        `Daily rate limit exceeded (${rl.limit}/day). Reset at midnight UTC, or set your own xAI API key in settings to bypass this limit.`,
        {
          "X-RateLimit-Limit": String(rl.limit),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rl.resetAt),
          "X-Proxy-Mode": mode,
          "Retry-After": String(
            Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))
          ),
        },
        allowedOrigin
      );
    }
    upstreamAuth = `Bearer ${env.XAI_API_KEY}`;
  }

  const url = new URL(request.url);
  const targetUrl = XAI_API_BASE + url.pathname + url.search;
  const fwdHeaders = new Headers();
  fwdHeaders.set("Authorization", upstreamAuth);
  const ct = request.headers.get("Content-Type");
  if (ct) fwdHeaders.set("Content-Type", ct);

  try {
    const resp = await fetch(targetUrl, {
      method: request.method,
      headers: fwdHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
    });
    const outHeaders = new Headers(resp.headers);
    for (const [k, v] of Object.entries(cors)) outHeaders.set(k, v);
    outHeaders.set("X-Proxy-Mode", mode);
    if (rl) {
      outHeaders.set("X-RateLimit-Limit", String(rl.limit));
      outHeaders.set("X-RateLimit-Remaining", String(rl.remaining));
      outHeaders.set("X-RateLimit-Reset", String(rl.resetAt));
    }
    return new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
      headers: outHeaders,
    });
  } catch (e) {
    return jsonError(502, "Upstream error: " + String(e), {}, allowedOrigin);
  }
}

// =============================================================================
// Chat AI ハンドラ (OpenAI + Gemini、3 ティア)
// =============================================================================

const PROVIDERS = {
  openai: {
    endpoint: OPENAI_API_BASE,
    buildBody: (model, systemPrompt, messages, opts) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      stream: true,
    }),
  },
  gemini: {
    endpoint: GEMINI_API_BASE,
    buildBody: (model, systemPrompt, messages, opts) => ({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      max_tokens: opts.maxOutputTokens,
      temperature: opts.temperature,
      stream: true,
    }),
  },
};

function pickProvider(model) {
  if (!model) return null;
  if (model.startsWith("gpt-")) return { name: "openai", cfg: PROVIDERS.openai };
  if (model.startsWith("gemini-")) return { name: "gemini", cfg: PROVIDERS.gemini };
  return null;
}

// クライアント識別キー: IP + UA (+ invite code が来ている時だけ含める) の SHA-256
async function buildSessionKey(request, inviteCode) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ua = request.headers.get("User-Agent") || "";
  const raw = `${ip}::${ua}${inviteCode ? "::" + inviteCode : ""}`;
  return await sha256Hex(raw);
}

// 招待コード検証 + bind (KV)
async function redeemInviteCode(code, sessionId, env) {
  if (!env.INVITE_KV) return { valid: false, reason: "kv_not_bound" };
  const raw = await env.INVITE_KV.get(`invite:${code}`);
  if (!raw) return { valid: false, reason: "not_found" };
  let invite;
  try {
    invite = JSON.parse(raw);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (invite.valid === false) return { valid: false, reason: "revoked" };
  if (invite.expiresAt && Date.now() > invite.expiresAt) {
    return { valid: false, reason: "expired" };
  }
  const usedBy = Array.isArray(invite.usedBy) ? invite.usedBy : [];
  if (usedBy.includes(sessionId)) {
    return { valid: true };
  }
  const maxUsers = typeof invite.maxUsers === "number" ? invite.maxUsers : 1;
  if (usedBy.length >= maxUsers) {
    return { valid: false, reason: "max_users_reached" };
  }
  usedBy.push(sessionId);
  invite.usedBy = usedBy;
  await env.INVITE_KV.put(`invite:${code}`, JSON.stringify(invite));
  return { valid: true };
}

async function determineTier(request, env) {
  const clientAuth = request.headers.get("Authorization") || "";
  // BYOK: sk- (OpenAI) / AIza (Gemini) どちらも受け付ける
  if (clientAuth.startsWith("Bearer sk-") || clientAuth.startsWith("Bearer AIza")) {
    return { tier: "byok", authHeader: clientAuth };
  }
  const inviteCode = request.headers.get("X-Invite-Code") || "";
  if (inviteCode) {
    const sessionId = await buildSessionKey(request, inviteCode);
    const result = await redeemInviteCode(inviteCode, sessionId, env);
    if (result.valid) return { tier: "invited", code: inviteCode, sessionId };
    // invite 失敗時は Anonymous に fallback (理由はヘッダで伝える)
    return { tier: "anonymous", inviteFail: result.reason };
  }
  return { tier: "anonymous" };
}

function estimateTokens(text) {
  if (!text) return 0;
  const s = String(text);
  const ja = (s.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g) || []).length;
  const en = s.replace(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, "")
    .split(/\s+/).filter(Boolean).length;
  return Math.ceil(ja * 1.5 + en * 1.3);
}

function chatLimitsFor(tier, env) {
  if (tier === "byok") return null; // 制限なし
  if (tier === "invited") {
    return {
      reqLimit: parseInt(env.CHAT_LIMIT_INVITED_REQ) || CHAT_DEFAULTS.invitedReq,
      tokLimit: parseInt(env.CHAT_LIMIT_TOKENS_INVITED) || CHAT_DEFAULTS.invitedTokens,
    };
  }
  return {
    reqLimit: parseInt(env.CHAT_LIMIT_ANON_REQ) || CHAT_DEFAULTS.anonReq,
    tokLimit: parseInt(env.CHAT_LIMIT_TOKENS_ANON) || CHAT_DEFAULTS.anonTokens,
  };
}

async function checkChatRateLimit(env, sessionKey, tier, estimatedInputTokens) {
  const limits = chatLimitsFor(tier, env);
  if (!limits) return { allowed: true, skip: true };
  if (!env.RATE_LIMIT_KV) {
    return { allowed: true, limits, reqCount: -1, tokCount: -1, noKv: true };
  }
  const day = todayUtc();
  const reqKey = `chat:${tier}:${sessionKey}:${day}:requests`;
  const tokKey = `chat:${tier}:${sessionKey}:${day}:tokens`;
  const [reqRaw, tokRaw] = await Promise.all([
    env.RATE_LIMIT_KV.get(reqKey),
    env.RATE_LIMIT_KV.get(tokKey),
  ]);
  const reqCount = parseInt(reqRaw) || 0;
  const tokCount = parseInt(tokRaw) || 0;
  if (reqCount >= limits.reqLimit) {
    return { allowed: false, reason: "request_limit", limits, reqCount, tokCount };
  }
  if (tokCount + estimatedInputTokens >= limits.tokLimit) {
    return { allowed: false, reason: "token_limit", limits, reqCount, tokCount };
  }
  // 先に requests と 推定入力 tokens を増分。出力 token は ストリーム完了後に追加
  await Promise.all([
    env.RATE_LIMIT_KV.put(reqKey, String(reqCount + 1), {
      expirationTtl: 60 * 60 * 24 * 2,
    }),
    env.RATE_LIMIT_KV.put(tokKey, String(tokCount + estimatedInputTokens), {
      expirationTtl: 60 * 60 * 24 * 2,
    }),
  ]);
  return {
    allowed: true,
    limits,
    reqCount: reqCount + 1,
    tokCount: tokCount + estimatedInputTokens,
    reqKey,
    tokKey,
  };
}

async function addOutputTokensToCounter(env, tokKey, outputTokens) {
  if (!env.RATE_LIMIT_KV || !tokKey || !outputTokens) return;
  const raw = await env.RATE_LIMIT_KV.get(tokKey);
  const current = parseInt(raw) || 0;
  await env.RATE_LIMIT_KV.put(tokKey, String(current + outputTokens), {
    expirationTtl: 60 * 60 * 24 * 2,
  });
}

// 最小限の system prompt (Pack 3 のレベル別詳細版は Phase 2 で差し込む)
function defaultSystemPrompt(level) {
  const common =
    "あなたは金属加工の学習をサポートする熟練技術者です。回答は日本語、数式や数値には単位を添え、材料・工具・機械剛性で変わる条件依存性を明示してください。1 回の返答は 200〜400 字目安。学習者の間違いは肯定的に扱ってください。";
  const levelNote = {
    beginner:
      "対象レベル: 初学者。専門用語は初出時に簡潔な説明を入れ、物理イメージを優先して伝えてください。",
    intermediate:
      "対象レベル: 中級者。Vc / f / ap / VB / Kc 等の基本用語は説明省略可。条件依存の幅とメカニズムを示してください。",
    advanced:
      "対象レベル: 上級。Altintas 2012 / CIRP レベルの議論、構成式や SLD の導出にも踏み込んで構いません。",
  }[level] || "";
  return `${common}\n${levelNote}`;
}

function buildRagContext({ query, chapterId, termId }, env) {
  // Phase 1 最小版: Workers 内には learning content を持たず、
  // フロントから渡される chapterId / termId を system prompt に明示するだけ。
  // Phase 3 で章サマリ + 用語集を KV/R2 に同梱して展開予定。
  const parts = [];
  if (chapterId) parts.push(`ユーザーが現在閲覧している章: ${chapterId}`);
  if (termId) parts.push(`ユーザーが直前にクリックした用語 anchor: ${termId}`);
  if (parts.length === 0) return "";
  return "[参考情報]\n" + parts.join("\n");
}

async function handleChat(request, env, ctx, allowedOrigin) {
  const cors = corsHeaders(allowedOrigin);
  const corsOut = {
    ...cors,
    "Access-Control-Expose-Headers":
      "X-Chat-Tier, X-Chat-Provider, X-Chat-Model, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Invite-Fail",
  };

  // body parse
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid_json", corsOut, allowedOrigin);
  }
  const {
    messages,
    model: clientModel,
    level = "intermediate",
    chapterId,
    termId,
  } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return jsonError(400, "messages_required", corsOut, allowedOrigin);
  }

  // モデル選択 (default: gpt-5.4-nano)
  const model = clientModel || "gpt-5.4-nano";
  const provider = pickProvider(model);
  if (!provider) {
    return jsonError(400, `unknown_model: ${model}`, corsOut, allowedOrigin);
  }

  // ティア判定
  const tierInfo = await determineTier(request, env);
  const tier = tierInfo.tier;

  // 入力 token 見積 (system + messages + RAG ctx)
  const ragCtx = buildRagContext({ chapterId, termId }, env);
  const systemPrompt = defaultSystemPrompt(level) + (ragCtx ? "\n\n" + ragCtx : "");
  const estimatedInput =
    estimateTokens(systemPrompt) +
    messages.reduce((sum, m) => sum + estimateTokens(m.content || ""), 0);

  const maxInput = parseInt(env.CHAT_MAX_INPUT_TOKENS) || CHAT_DEFAULTS.maxInputTokens;
  if (estimatedInput > maxInput) {
    return jsonError(
      413,
      `input_too_large: estimated ${estimatedInput} tokens > limit ${maxInput}. 過去の会話を短くするか、新しい会話を開始してください。`,
      corsOut,
      allowedOrigin
    );
  }

  // レート制限 (BYOK はスキップ)
  let sessionKey = null;
  let rlResult = null;
  if (tier !== "byok") {
    sessionKey =
      tierInfo.sessionId || (await buildSessionKey(request, tierInfo.code));
    rlResult = await checkChatRateLimit(env, sessionKey, tier, estimatedInput);
    if (!rlResult.allowed) {
      return jsonError(
        429,
        `${rlResult.reason}: daily limit (${rlResult.limits.reqLimit} req / ${rlResult.limits.tokLimit} tokens) reached. Set your own API key for BYOK (unlimited).`,
        {
          ...corsOut,
          "X-Chat-Tier": tier,
          "X-RateLimit-Limit": String(rlResult.limits.reqLimit),
          "X-RateLimit-Remaining": String(
            Math.max(0, rlResult.limits.reqLimit - rlResult.reqCount)
          ),
          "Retry-After": "3600",
        },
        allowedOrigin
      );
    }
  }

  // Provider の API キー選択
  let upstreamAuth;
  if (tier === "byok") {
    upstreamAuth = tierInfo.authHeader;
  } else if (provider.name === "openai") {
    if (!env.OPENAI_API_KEY) {
      return jsonError(503, "OPENAI_API_KEY not configured", corsOut, allowedOrigin);
    }
    upstreamAuth = `Bearer ${env.OPENAI_API_KEY}`;
  } else if (provider.name === "gemini") {
    if (!env.GEMINI_API_KEY) {
      return jsonError(503, "GEMINI_API_KEY not configured", corsOut, allowedOrigin);
    }
    upstreamAuth = `Bearer ${env.GEMINI_API_KEY}`;
  }

  // Upstream 呼び出し
  const maxOutput = parseInt(env.CHAT_MAX_OUTPUT_TOKENS) || CHAT_DEFAULTS.maxOutputTokens;
  const reqBody = provider.cfg.buildBody(model, systemPrompt, messages, {
    maxOutputTokens: maxOutput,
    temperature: CHAT_DEFAULTS.defaultTemperature,
  });

  let upstream;
  try {
    upstream = await fetch(provider.cfg.endpoint, {
      method: "POST",
      headers: {
        Authorization: upstreamAuth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    return jsonError(502, "upstream_unreachable: " + String(e), corsOut, allowedOrigin);
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return jsonError(
      upstream.status,
      `provider_error: ${errText.slice(0, 500)}`,
      corsOut,
      allowedOrigin
    );
  }

  // SSE 中継 (入出力 token を集計しながら delta を流す)
  const { readable, writable } = new TransformStream();
  const responseHeaders = {
    ...corsOut,
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Chat-Tier": tier,
    "X-Chat-Provider": provider.name,
    "X-Chat-Model": model,
  };
  if (rlResult && rlResult.limits) {
    responseHeaders["X-RateLimit-Limit"] = String(rlResult.limits.reqLimit);
    responseHeaders["X-RateLimit-Remaining"] = String(
      Math.max(0, rlResult.limits.reqLimit - rlResult.reqCount)
    );
  }
  if (tierInfo.inviteFail) {
    responseHeaders["X-Invite-Fail"] = tierInfo.inviteFail;
  }

  const tokKey = rlResult && rlResult.tokKey;
  ctx.waitUntil(pipeSseToClient(upstream.body, writable, env, tokKey));

  return new Response(readable, { status: 200, headers: responseHeaders });
}

// upstream SSE を normalized `data: {"delta":"..."}` 形式でフロントに流す。
// 完了時に出力 token を KV カウンタに加算。
async function pipeSseToClient(upstreamBody, writable, env, tokKey) {
  const reader = upstreamBody.getReader();
  const writer = writable.getWriter();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let outputTokens = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") {
          await writer.write(encoder.encode("data: [DONE]\n\n"));
          continue;
        }
        try {
          const chunk = JSON.parse(payload);
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          const finishReason = chunk.choices?.[0]?.finish_reason;
          if (delta) outputTokens += estimateTokens(delta);
          const forward = {
            delta,
            ...(finishReason ? { finishReason } : {}),
          };
          await writer.write(
            encoder.encode(`data: ${JSON.stringify(forward)}\n\n`)
          );
        } catch {
          // JSON 解析失敗はスキップ (upstream のコメント行等)
        }
      }
    }
    await writer.write(encoder.encode("data: [DONE]\n\n"));
  } catch (e) {
    try {
      await writer.write(
        encoder.encode(
          `data: ${JSON.stringify({ error: "stream_error: " + String(e) })}\n\n`
        )
      );
    } catch {}
  } finally {
    try {
      await writer.close();
    } catch {}
    if (tokKey && outputTokens > 0) {
      await addOutputTokensToCounter(env, tokKey, outputTokens);
    }
  }
}
