# Chat AI Phase 0 — Runbook (実行手順書)

本ドキュメントは Phase 0「準備」を実行するための owner 向けチェックリストです。
chat-ai-plan v2.2 §10 のロードマップ Phase 0 行に対応。

**所要時間目安**: 1-2 日（API キー発行の待ち時間含む）
**前提**: chat-ai-plan v2.2 が Approved 状態 (済)、worker-proxy.js は Chat ハンドラ実装済 (commit `a7f1076`)

---

## Step 1: API キー発行

### OpenAI
1. <https://platform.openai.com/> にログイン (or サインアップ)
2. Settings → API keys → Create new secret key
3. キー名: `machining-fundamentals-shared` 等
4. 作成されたキー (`sk-...`) を **その場で控える** (再表示不可)
5. Settings → Billing → 残高 \$20 程度入金 (Phase 0 テスト + 初月運用想定)

### Google AI Studio (Gemini)
1. <https://aistudio.google.com/> にログイン
2. Get API key → Create API key in new project
3. キー (`AIza...`) を控える
4. 課金設定: Google Cloud Console → 該当プロジェクト → Billing → Link billing account
   (Free tier あり、超過時のみ課金。Phase 0 テスト程度なら無料枠内)

---

## Step 2: ローカルで接続テスト

```bash
cd /Users/ai/dev/Asagiri/Metal/machining-fundamentals
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="AIza..."
bash scripts/chat-conn-test.sh
```

期待される出力 (Test 1-6):
- Test 0 PASS: キー形式 OK
- Test 1 PASS: gpt-5.4-nano 推論成功
- Test 2 PASS or WARN: Gemini OpenAI 互換 endpoint (preview 期間で挙動不明)
- Test 3 (Test 2 が WARN の時のみ): Gemini ネイティブ endpoint fallback
- Test 4 INFO: 日本語品質サンプルを目視確認
- Test 5 PASS: SSE フォーマット OK
- Test 6 INFO: コスト試算

### Test 結果に応じた `chat-ai-plan.md` の更新

| Test | 結果 | 反映先 |
|---|---|---|
| Test 1 PASS | OpenAI 側の決済 OK、本格運用 GO | §10 Phase 0 完了マーク |
| Test 2 PASS | Gemini も adapter パターン流用可 | §3 PROVIDERS.gemini そのまま |
| Test 2 WARN + Test 3 PASS | Gemini 専用 parser が必要 | §3 PROVIDERS.gemini に独自 endpoint 追記 |
| Test 4 で日本語品質低 | gemini-3-flash を Anonymous 既定から外す | §3 default を gpt-5.4-nano 単独に |
| Test 6 価格 > 想定 | Anonymous レート制限を 50 → 30 等に下方調整 | §2 env 値見直し |

---

## Step 3: Cloudflare Workers 設定

### 3-1: Worker のデプロイ更新

1. Cloudflare ダッシュボード > Workers & Pages
2. 既存 Worker (例: `grok-tts-proxy`) を開く
3. Edit Code で `worker-proxy.js` の最新版 (commit `73e7022` 時点) を貼り付け
4. Save and Deploy

### 3-2: 環境変数追加

Worker > Settings > Variables and Secrets で以下を追加:

| 変数名 | タイプ | 値 | 必須 |
|---|---|---|---|
| `OPENAI_API_KEY` | Secret | `sk-...` (Step 1 で控えたもの) | Chat 利用時必須 |
| `GEMINI_API_KEY` | Secret | `AIza...` | Gemini 提供時必須 |
| `CHAT_LIMIT_ANON_REQ` | Text | `50` | 任意 (省略時 50) |
| `CHAT_LIMIT_INVITED_REQ` | Text | `100` | 任意 (省略時 100) |
| `CHAT_LIMIT_TOKENS_ANON` | Text | `150000` | 任意 |
| `CHAT_LIMIT_TOKENS_INVITED` | Text | `300000` | 任意 |
| `ALLOWED_ORIGIN` | Text | `https://machining-fundamentals.vercel.app` | **production 推奨** |

### 3-3: KV Namespace 作成 + bind

1. Worker > Settings > Bindings
2. Add Binding > KV Namespace
3. Variable name: `INVITE_KV`
4. KV namespace: 「Create new」→ 名前 `invite-codes` で作成
5. Save

(既存の `RATE_LIMIT_KV` は TTS で使用中、そのまま維持)

### 3-4: 招待コード発行

dashboard > Workers KV > `invite-codes` namespace > KV Pairs:

| Key | Value (JSON) |
|---|---|
| `invite:mf-2026-trial-001` | `{"createdAt":"2026-04-23T00:00:00Z","expiresAt":1735689600000,"maxUsers":5,"usedBy":[],"valid":true,"note":"trial code"}` |

owner が招待したい人にコード文字列 `mf-2026-trial-001` を伝える。
ChatWidget の ⚙ で「招待コード」欄に入力 → Invited 層で動作。

---

## Step 4: ブラウザで動作確認

1. <https://machining-fundamentals.vercel.app/> を強制リロード (Cmd+Shift+R)
2. 右下の「AI に質問」をクリック
3. ⚙ ボタン → プロキシ URL を入力 → 保存
4. 「VB とは何ですか？」と入力 → SSE で応答が流れるか確認
5. 別タブで招待コードを入れて Invited 層動作確認
6. 別タブで `Bearer sk-...` を BYOK 入力欄に入れて BYOK 層動作確認

### 確認項目チェックリスト

- [ ] Anonymous で送信 → 応答ストリーミング
- [ ] tier pill が `anonymous` 表示
- [ ] 残数表示 `49/50` 等
- [ ] 50 リクエスト送って 429 が返る (制限動作確認、env で 5 等に下げてテスト推奨)
- [ ] Invited で送信 → tier pill が `invited`、上限 100
- [ ] BYOK で送信 → tier pill が `byok`、無制限
- [ ] モデル切替 (gpt-5.4-nano → gemini-3-flash) で応答 provider が変わる
- [ ] Cmd+K で開閉、Esc 閉じる、Cmd+Shift+L クリア
- [ ] サイドバーモード切替 (画面幅 1200px+)

---

## Step 5: 結果フィードバック

接続テスト結果と動作確認結果を以下に反映:

1. `chat-ai-plan.md` v2.3 として更新 (Test 結果反映)
2. `roadmap.md` の Phase 0 行を「✓ 完了」マーク
3. peer (Matlens / kaze-ux / dev-album) に成果共有

---

## トラブルシュート

### 「OPENAI_API_KEY not configured」
- Workers env で Secret 設定漏れ。Step 3-2 やり直し

### 429 が一度で返る
- KV カウンタが過去のテストで残っている。dashboard > KV > `cfd-rate-limit` namespace で `chat:*` キーを手動削除

### Gemini で 404
- モデル ID が `gemini-3-flash` 以外 (例: `gemini-3.1-flash`) の可能性。<https://ai.google.dev/gemini-api/docs/models> で正式名確認

### CORS エラー (ブラウザ console)
- `ALLOWED_ORIGIN` が production URL と不一致。Step 3-2 で `https://machining-fundamentals.vercel.app` (末尾スラッシュなし) に設定

### 招待コードが effective でない
- KV value の JSON 構文エラー。`maxUsers` 数値型、`valid` true 確認
- `INVITE_KV` binding 名のタイポ確認

---

## 完了基準

Phase 0 は以下が満たせれば完了:
- [ ] 接続テスト Test 1, 2 (or 3), 4, 5 が PASS or 許容範囲
- [ ] ブラウザで Anonymous / Invited / BYOK 3 ティアの動作確認
- [ ] `chat-ai-plan.md` v2.3 に結果反映
- [ ] owner が「Phase 1 着手 GO」を peer に通知

完了後、Phase 1 (会話履歴圧縮 / プロンプト精緻化 / レベル別表示) に進みます。

---

_最終更新: 2026-04-23_
