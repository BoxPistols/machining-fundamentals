// =============================================================================
// xAI Grok TTS プロキシ for Cloudflare Workers
//
// このプロキシは 2 つのモードで動作します。
//
//   1. Shared モード  — クライアントが Authorization ヘッダ未送信
//        → Worker 側の XAI_API_KEY を使用、IP+UA ハッシュごとに日次レート制限
//        → 公開デモ用。誰でも使えるが、1日あたりの上限あり
//
//   2. BYOK モード     — クライアントが Authorization: Bearer xai-... を送信
//        → 受け取ったキーをそのまま xAI に転送、レート制限なし
//        → 自分の xAI 課金で使う上級ユーザー向け
//
// セットアップ手順 (Cloudflare ダッシュボード)
//   1. Workers & Pages → Create → Create Worker
//   2. このファイルを貼り付けて Save and Deploy
//   3. Settings > Variables and Secrets で以下を設定 (任意項目は不要なら省略)
//        XAI_API_KEY          (Secret)  共有モード用の xAI APIキー。未設定なら BYOK のみ動作
//        RATE_LIMIT_PER_DAY   (Text)    1日あたり上限。省略時 30
//        ALLOWED_ORIGIN       (Text)    許可するOrigin (例 "https://your-site.vercel.app")。"*" で全許可
//        PROXY_SHARED_SECRET  (Secret)  BYOK 利用時の追加認証(任意)
//   4. Settings > Bindings で KV Namespace を追加
//        Variable name: RATE_LIMIT_KV
//        KV Namespace : (新規作成して選択)
//      → KV を未バインドにすると Shared モードはレート制限なしで動作するので注意
// =============================================================================

const DEFAULT_ALLOWED_ORIGIN = "*";
const DEFAULT_RATE_LIMIT = 30;
const XAI_API_BASE = "https://api.x.ai";

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
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN;
    const cors = corsHeaders(allowedOrigin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const clientAuth = request.headers.get("Authorization");
    const isByok = !!clientAuth;

    let upstreamAuth;
    let rl = null;
    const mode = isByok ? "byok" : "shared";

    if (isByok) {
      // BYOK: 任意の合言葉チェック
      const sharedSecret = env.PROXY_SHARED_SECRET;
      if (sharedSecret) {
        const got = request.headers.get("X-Proxy-Secret") || "";
        if (got !== sharedSecret) {
          return jsonError(401, "Proxy secret mismatch", {}, allowedOrigin);
        }
      }
      upstreamAuth = clientAuth;
    } else {
      // Shared: サーバ側 API キー必須 + レート制限
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
            "Retry-After": String(Math.max(1, rl.resetAt - Math.floor(Date.now() / 1000))),
          },
          allowedOrigin
        );
      }
      upstreamAuth = `Bearer ${env.XAI_API_KEY}`;
    }

    // xAI へ転送
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
  },
};
