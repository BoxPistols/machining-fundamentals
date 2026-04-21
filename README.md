# 切削加工入門 — 学習ロードマップ

航空機やエンジンなど、精密な金属部品を作る **切削加工** を、全10章で体系的に概観する学習教材です。初学者が全体像を掴むことを目的にしています。

🌐 **公開URL**: https://YOUR-PROJECT.vercel.app  
（公開後、このURLを差し替えてください）

## このアプリについて

- **全10章の概説** — 切削加工とは何か、から航空機部品加工の特殊性まで
- **各章にSVG図解** — ダークテーマに合わせた視覚補助
- **用語集と参考資料** — 日英対訳、教科書・規格・メーカー資料へのリンク
- **体験シミュレーター** — 第7章「冷却液の役割」から起動できる3D CFDシミュレーター（Three.js）
- **テキスト書き出し** — 他の音声読み上げツール（VOICEVOX、ElevenLabs等）に流し込めるプレーンテキスト出力
- **音声読み上げモード** — ブラウザ内蔵音声、または xAI Grok TTS（各自でAPIキー登録）
- **ダーク / ライト テーマ切替**
- **学習進捗の記録**（localStorage）

## 免責事項

本教材の内容は **AI（Claude）が執筆した初学者向け概説** です。細部の正確性・最新性は保証されません。実務や研究に適用する際は、各章末尾の「さらに学ぶには」で紹介している教科書・JIS規格・工具メーカー技術資料などで裏取りしてください。

## 技術スタック

- 単一HTML（外部ビルドなし）
- Three.js r160（WebGL 3D描画、シミュレーター部分）
- 2D CFDソルバ: Jos Stam の Stable Fluids 法の実装
- Web Speech API（ブラウザ内蔵読み上げ）
- IndexedDB（Grok TTS の音声キャッシュ）
- Cloudflare Workers（xAI API のCORSプロキシ、任意）

## Grok TTS（高品質音声読み上げ）の使い方 — 上級者向け

ブラウザ内蔵の音声で十分使えますが、さらに高品質な読み上げが欲しい場合は [xAI Grok TTS](https://x.ai/news/grok-stt-and-tts-apis) を使えます。ただし xAI API はブラウザから直接呼べないため、**Cloudflare Workers プロキシ** を各自で立てる必要があります。

### 手順

1. [xAI Console](https://console.x.ai/) でアカウント作成、APIキー発行、クレジット購入（$5程度）
2. Cloudflare アカウントを作成
3. Workers & Pages で新規 Worker 作成
4. このリポジトリの `worker-proxy.js` の内容を貼り付け、`ALLOWED_ORIGIN` を自分が使うドメインに変更
5. デプロイ、Worker URL を控える
6. アプリの ⚙ 設定モーダルで、プロキシURL・APIキーを入力
7. 接続テスト成功 → Grok TTSが使える

APIキー・プロキシURLは **お使いのブラウザの localStorage にのみ保存** され、私のサーバーには送信されません。

## ローカル開発

```bash
# リポジトリクローン
git clone https://github.com/YOUR_USERNAME/machining-fundamentals.git
cd machining-fundamentals

# HTTPサーバー起動（Python）
python3 -m http.server 8000
# → http://localhost:8000/ を開く
```

ファイル直開き（`file://`）だとシミュレーターのiframe読み込みなどでブラウザによっては制約があるため、HTTPサーバー経由がおすすめです。

## ライセンス

コード部分は MIT ライセンスで自由にお使いいただけますが、学習コンテンツ（本文・図）の転載・改変の際は一言ご連絡ください。

---

Built with Claude (Anthropic).
