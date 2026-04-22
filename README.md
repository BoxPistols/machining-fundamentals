# 切削加工入門 — 学習ロードマップ

航空機やエンジンなど、精密な金属部品を作る **切削加工** を、全10章で体系的に概観する学習教材です。初学者が全体像を掴むことを目的にしています。

🌐 **公開URL**: <https://machining-fundamentals.vercel.app/>

## このアプリについて

- **全10章の概説** — 切削加工とは何か、から航空機部品加工の特殊性まで
- **各章にSVG図解** — ダークテーマに合わせた視覚補助
- **用語集と参考資料** — 日英対訳、教科書・規格・メーカー資料へのリンク
- **体験シミュレーター** — 第7章「冷却液の役割」から起動できる3D CFDシミュレーター（Three.js）
- **テキスト書き出し** — 他の音声読み上げツール（VOICEVOX、ElevenLabs等）に流し込めるプレーンテキスト出力
- **音声読み上げモード** — ブラウザ内蔵音声、または xAI Grok TTS
- **ダーク / ライト テーマ切替**
- **学習進捗の記録**（localStorage）

## 免責事項

本教材の内容は **AI（Claude）が執筆した初学者向け概説** です。細部の正確性・最新性は保証されません。実務や研究に適用する際は、各章末尾の「さらに学ぶには」で紹介している教科書・JIS規格・工具メーカー技術資料などで裏取りしてください。

## 技術スタック

- 単一 HTML（外部ビルドなし）
- Three.js r160（WebGL 3D描画、シミュレーター部分）
- 2D CFD ソルバ: Jos Stam の Stable Fluids 法の実装
- Web Speech API（ブラウザ内蔵読み上げ）
- IndexedDB（Grok TTS の音声キャッシュ）
- Cloudflare Workers（xAI API プロキシ + レート制限）
- Vercel（静的ホスティング）

## Grok TTS（高品質音声読み上げ）

2 つのモードがあります。

| モード | 設定 | 挙動 |
|---|---|---|
| **Shared**（デフォルト） | プロキシ URL のみ登録 | プロキシ運用者の xAI キーを共有。**1日あたり 30 回まで**（変更可） |
| **BYOK** | プロキシ URL + 自分の xAI キーを登録 | 自分の課金で無制限に使用 |

### Shared モード（プロキシ運用者向け、1人 1回のセットアップ）

この OSS リポジトリを公開運用する人が必ず行う作業です。

1. [xAI Console](https://console.x.ai/) で API キーを取得
2. Cloudflare ダッシュボード > Workers & Pages で新規 Worker を作成
3. `worker-proxy.js` を貼り付けて Save and Deploy
4. Worker の Settings > **Variables and Secrets** に以下を追加
   - `XAI_API_KEY`（Secret）— 取得した xAI キー
   - `RATE_LIMIT_PER_DAY`（Text）— 例 `30`（省略時 30）
   - `ALLOWED_ORIGIN`（Text）— 例 `https://your-site.vercel.app`（`*` で全許可）
5. Worker の Settings > **Bindings** に KV Namespace を追加
   - Variable name: `RATE_LIMIT_KV`
   - KV Namespace: 新規作成して紐づけ
   - **未バインドだとレート制限が効かないので注意**
6. Worker の URL（`https://xxx.workers.dev`）をアプリの設定欄に貼る

### BYOK モード（ユーザー向け）

自分の xAI アカウントで使いたい人は、⚙ 設定から：

1. プロキシ URL（運用者のもの、または自分で立てた Worker の URL）
2. xAI API キー（`xai-...`）
3. 必要ならプロキシ合言葉（`PROXY_SHARED_SECRET` を運用者が設定している場合）

これで BYOK モードになり、Shared の上限を消費しません。API キーは**ブラウザの localStorage にのみ**保存され、サーバーには送信されません（プロキシ経由で xAI に転送されるのみ）。

## Vercel デプロイ

静的ファイルのみなので、ビルド設定は不要。

```bash
# CLI で一発デプロイ
npm i -g vercel
vercel            # 初回は対話設定、preview デプロイ
vercel --prod     # 本番デプロイ
```

または GitHub 連携で、main への push で自動デプロイ。`vercel.json` にキャッシュ・セキュリティヘッダのみ定義しています。

## ローカル開発

```bash
git clone https://github.com/BoxPistols/machining-fundamentals.git
cd machining-fundamentals
pnpm install        # serve + vercel CLI を devDependency で
```

起動方法（被りにくい 5555 を既定、代替ポートを複数用意）：

```bash
pnpm dev          # serve  - http://localhost:5555  (既定、被りにくい)
pnpm dev:8000     # serve  - http://localhost:8000
pnpm dev:8080     # serve  - http://localhost:8080
pnpm dev:py       # python - http://localhost:5556  (依存ゼロ派)
pnpm dev:vercel   # vercel dev - http://localhost:5557  (vercel.json のヘッダを実 prod と同じく検証したい時のみ。Vercel project linked 必須)
```

ファイル直開き（`file://`）だとシミュレーターの iframe 読み込みに制約があるため、HTTP サーバー経由を推奨。

> `pnpm dev:vercel` は Vercel project が link 済みのときに使ってください。link されていないと `vercel dev` が `package.json` の `dev` script を再帰呼びしようとして失敗するため、`pnpm dev`（serve 直接）を既定にしています。

デプロイは `pnpm preview`（Preview）または `pnpm deploy`（Production）。

## ライセンス

デュアルライセンスです。

- **コード**（`index.html` 内 JS、`worker-proxy.js`、`vercel.json` 等）— [MIT](./LICENSE)
- **学習コンテンツ**（章本文、SVG、音声原稿、README 等）— [CC BY 4.0](./LICENSE-CONTENT)

コンテンツを使う場合はクレジット表記（著者名・リポジトリへのリンク）をお願いします。商用利用可。

---

Built with Claude (Anthropic).
