// =============================================================================
// xAI Grok TTS プロキシ for Cloudflare Workers
//
// 目的: ブラウザから直接xAI APIを呼ぶとCORSで弾かれるため、
//       Cloudflare Workersを中継させてCORSヘッダーを付与する。
//
// セキュリティ:
//   - 自分専用で使うため、Authorizationヘッダー（xAI APIキー）はブラウザから
//     送信する前提。APIキーはブラウザのlocalStorageに保存される。
//   - より安全にしたい場合は、PROXY_SHARED_SECRET を設定して、
//     ブラウザ側からも合言葉を送信しないと通らないようにできる（オプション）。
//   - ALLOWED_ORIGIN は、自分が使うブラウザの origin（例: null=ローカルファイル、
//     https://your-site.pages.dev など）に制限するとより安全。
//     "*" でも動きますが、誰でも呼べるURLになるので注意。
//
// デプロイ手順:
//   1. https://dash.cloudflare.com/ にログイン
//   2. 左メニュー「Workers & Pages」→「Create」→「Create Worker」
//   3. 適当な名前（例: grok-tts-proxy）で作成
//   4. コードエディタにこのファイルの内容を貼り付け
//   5. 「Save and Deploy」
//   6. 表示される URL（例: https://grok-tts-proxy.<account>.workers.dev）を控える
//   7. ※ ALLOWED_ORIGIN と PROXY_SHARED_SECRET は、必要に応じて環境変数
//      （Worker 設定 > Variables）で上書き可能
// =============================================================================

// 許可するリクエスト元（"*" なら全て許可）
// ローカル file:// プロトコルからアクセスする場合は "null" を含める
const ALLOWED_ORIGIN = "*";

// ブラウザから送ってもらう合言葉（空ならチェックなし）
// 設定する場合: 推測されにくい文字列（UUIDなど）を設定し、ブラウザ側にも同じものを設定
const PROXY_SHARED_SECRET = ""; // 例: "my-secret-abc123" / 空なら認証なし

// 転送先（xAI API のベース URL）
const XAI_API_BASE = "https://api.x.ai";

// ===== 以下、実装 =====

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Proxy-Secret",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};

export default {
  async fetch(request, env, ctx) {
    // Preflight（OPTIONS）は即返す
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // 合言葉チェック（設定されていれば）
    const sharedSecret = (env && env.PROXY_SHARED_SECRET) || PROXY_SHARED_SECRET;
    if (sharedSecret) {
      const got = request.headers.get("X-Proxy-Secret") || "";
      if (got !== sharedSecret) {
        return new Response(
          JSON.stringify({ error: "Proxy authentication failed" }),
          { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
        );
      }
    }

    // 転送先URLを組み立て
    const url = new URL(request.url);
    const path = url.pathname; // 例: "/v1/tts" など、xAI のパスに一致させる
    const targetUrl = XAI_API_BASE + path + url.search;

    // リクエストヘッダーから不要なものを除外、Authorizationは転送
    const fwdHeaders = new Headers();
    const authHeader = request.headers.get("Authorization");
    if (authHeader) fwdHeaders.set("Authorization", authHeader);
    const contentType = request.headers.get("Content-Type");
    if (contentType) fwdHeaders.set("Content-Type", contentType);

    try {
      const resp = await fetch(targetUrl, {
        method: request.method,
        headers: fwdHeaders,
        body: request.method === "GET" || request.method === "HEAD" ? null : request.body,
      });

      // レスポンスヘッダーにCORSを付ける
      const outHeaders = new Headers(resp.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) {
        outHeaders.set(k, v);
      }

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: outHeaders,
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "Proxy error", message: String(e) }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }
  },
};
