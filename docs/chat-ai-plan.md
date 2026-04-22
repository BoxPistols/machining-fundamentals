# Chat AI 機能 実装計画 (草案 v1)

**ステータス**: Proposed (owner レビュー待ち)
**最終更新**: 2026-04-23
**主要参照**: Matlens Pack 3（プロンプト設計） / Pack 11（アーキテクチャ）/ peer Q&A（4 質問への回答）
**関連**: [`integration-points.md`](../integration-points.md) / [`docs/monorepo-decisions.md`](./monorepo-decisions.md)

---

## 1. Vision — 学習者にとっての価値

machining-fundamentals は静的な学習教材ですが、現状の体験には次の壁があります：

- 章を読んでいて分からない用語があっても「教科書を再度開く」コストが高い
- 「なぜこの値になるのか」「なぜチタンは難削材なのか」を質問できる相手がいない
- Part A の物理と Part B の経験式の間の **「だから何？」** が読者個別にはつかめない

Chat AI が埋めるのは **「読みながら質問できる、章コンテキストを知っているチューター」** です。教科書を覚えるのではなく、目の前の疑問から逆引きで物理にたどる学習体験を作ります。

この機能は **必須ではないが差別化価値が高い**位置付け（owner 認識）。Phase 1 MVP は確実に通し、Phase 3 以降は需要に応じて投資判断する。

---

## 2. Architecture

```
Browser (single HTML SPA, vanilla JS)
  ├─ ChatWidget (floating button → modal panel)
  ├─ session storage: messages, learner profile
  └─ fetch /api/chat (streaming response)
            │
            ▼
Cloudflare Workers (既存 worker-proxy.js を拡張)
  ├─ /v1/tts (既存)        既存の TTS プロキシ
  ├─ /api/chat (NEW)       Chat 用ハンドラ
  │     ├─ モード判定: Authorization ヘッダ有無で BYOK / Shared 振り分け
  │     ├─ レート制限:    KV で日次 requests + tokens の二段制限
  │     ├─ RAG context:   in-memory glossary + chapter summaries
  │     ├─ プロンプト組立:  Pack 3 の systemPromptFor(level) + RAG
  │     ├─ Shared:        env.XAI_API_KEY で xAI Grok 直接呼び出し
  │     └─ BYOK:          受け取った Authorization で xAI 直接転送
  └─ KV (RATE_LIMIT_KV)    chat:<session>:<date>:requests / :tokens
            │
            ▼
xAI Grok API (Chat Completions, streaming)
```

### なぜ Vercel AI Gateway ではなく xAI 直接か

peer Q&A で Pack 11 の Gateway 推奨が訂正されました。判断マトリクス：

| 評価軸 | Vercel AI Gateway | **xAI Grok 直接** ★ | OpenAI/Anthropic 直接 |
|---|---|---|---|
| 既存インフラとの整合 | 新規追加 | **TTS プロキシと統一** | 新規追加 |
| BYOK 互換性 | Gateway 経由 BYOK は実装複雑 | **直接叩き、シンプル** | シンプル |
| プロバイダ切替 | ◎ 抽象化済 | ✗ Grok 固定 | ✗ 固定 |
| 運用負荷 | Gateway 設定 + 監視 | **TTS と同パターン** | 中 |
| 日本語品質 | プロバイダ依存 | Grok 3/4 は良好 | GPT-4o / Claude 最高 |

**Phase 1 は xAI Grok 直接**を採用。理由：既存 worker-proxy.js の Shared/BYOK パターンをそのまま流用でき、追加インフラゼロ。Phase 3 以降でモデル比較や複数プロバイダ運用が必要になれば Vercel AI Gateway 移行を検討。

---

## 3. Provider 選定と推奨

### Phase 1 default: xAI Grok 3 (または現行の Grok モデル)

- 同じ xAI API キーで TTS と Chat の両方を運用可能
- `https://api.x.ai/v1/chat/completions` (OpenAI 互換 API、AI SDK で扱える)
- ストリーミング対応 (SSE)

### BYOK モード

- ユーザーが自分の xAI キーを設定 → Authorization ヘッダで Workers に渡す
- Workers は Authorization をそのまま xAI に転送、レート制限なし
- API キーは **localStorage にのみ保存**、サーバには送信されない（プロキシ経由で xAI に転送のみ）
- 既存 TTS と同じセキュリティモデル

### Phase 3 以降のオプション

複数プロバイダ運用が必要になった場合：
- **Vercel AI Gateway** 経由で GPT-4o-mini / Claude Haiku / Grok を切り替え
- Shared モードのみ Gateway 経由、BYOK は引き続き直接（Gateway は OIDC 紐付きで BYOK 不可）

---

## 4. RAG 戦略

### Phase 1: In-Memory 全文検索 (Vector DB なし)

Part A/B/C で章本文と用語が整理済みなので、最初は in-memory で十分：

```js
// worker.ts (擬似コード)
function retrieveContext({ query, chapterId, termId }) {
  const chunks = [];

  // Tier 1: 現在開いている章のサマリ
  if (chapterId && CHAPTER_SUMMARIES[chapterId]) {
    chunks.push(`[章 ${chapterId}]\n${CHAPTER_SUMMARIES[chapterId]}`);
  }
  // Tier 2: ホバー中 / 直前にクリックした用語
  if (termId) {
    const term = GLOSSARY.find(t => t.id === termId);
    if (term) chunks.push(`[用語 ${term.id}]\n${term.def}`);
  }
  // Tier 3: クエリキーワードに合致する用語 (最大5)
  const matches = GLOSSARY.filter(t =>
    query.includes(t.name) || query.toLowerCase().includes(t.en.toLowerCase())
  ).slice(0, 5);
  chunks.push(...matches.map(m => `[関連] ${m.name}: ${m.def}`));

  return chunks.length ? `参考情報:\n${chunks.join('\n\n')}` : '';
}
```

**利点**: cold start ゼロ、依存ゼロ、コストゼロ、デバッグ容易
**限界**: 類義語対応なし、曖昧クエリに弱い

### Phase 3: Cloudflare Vectorize 導入

| 候補 | 評価 | 採否 |
|---|---|---|
| **Cloudflare Vectorize** ★ | 既存 Workers と同居、レイテンシ最小 | 採用 |
| Upstash Vector | serverless 互換だが Cloudflare なら Vectorize が自然 | 不採用 |
| pgvector | Postgres インフラが過剰 | 不採用 |

**embed モデル**: OpenAI `text-embedding-3-small` (1536次元、$0.02/1M tokens、日本語良好)
xAI は 2026-04 時点で embedding API を持たないため、ここだけ OpenAI 併用。

**index 更新フロー**:
- ビルド時バッチ更新 (GitHub Actions or `vercel build`)
- 章追加・用語追加で差分 embed → Vectorize アップロード

**チャンク戦略**:
- 用語 1 件 = 1 チャンク（name + def + 関連用語連結）
- 章節 1 段落 = 1 チャンク（h3 単位）
- 演習問題 = 問題 + 解答 + 解説で 1 チャンク

---

## 5. UI 段階設計

### Phase 1 (MVP): フローティングウィジェット

- 画面右下に「💬 AI に質問する」ボタン (40px 円)
- クリックでパネル展開 (max 400×600px、コンテンツを覆わない位置)
- 開いている章 ID と直前にクリックした用語 anchor を自動でコンテキスト送信

```js
// 章コンテキストの取得（hash routing から）
function chatContextFromState() {
  return {
    chapterId: state.chapterId,           // 'a4', '8' 等
    termId: state.chapterAnchor,          // 'VB', 'work-hardening' 等
    visibleSections: getVisibleH3()       // viewport 内の見出し配列
  };
}
```

### Phase 2: サイドパネル常駐 (画面幅 ≥ 1200px のみ)

- 章閲覧中、右サイドに 320-400px の常駐パネル
- 「読みながら質問」体験
- 狭幅では常駐モード不可（読書体験を破壊しないため）
- `prefers-reduced-motion` 等のアクセシビリティ配慮

### Phase 2 補助: 章末インライン Q&A

- 各章末尾に「この章について質問する」セクション
- 章限定コンテキストで回答精度向上
- 静的にコンテキスト明示できるので学習者にとって安心感大

### 不採用: 専用 `/#/chat` ページ
- 章を読みながらの対話体験を崩すため、専用ページは Phase 3 以降の補助用途に限定

---

## 6. レート制限 / コスト保護

### 二段制限 (Shared モード)

```js
const LIMITS = {
  maxRequestsPerDay: 10,    // Phase 1 は控えめスタート
  maxTokensPerDay: 50_000,
  maxTokensPerRequest: 4_000,  // 入力上限、長文 paste 防御
  maxOutputTokens: 800,
  maxHistoryTurns: 10,         // マルチターン上限、超えたら古い順に圧縮
};
```

### KV キー設計

```
chat:<sessionKey>:<YYYY-MM-DD>:requests   → カウンタ
chat:<sessionKey>:<YYYY-MM-DD>:tokens     → カウンタ (input + output 累積)
```

- `sessionKey` = sha256(IP + UA)（既存 TTS と同じ複合キー）
- TTL 2日（`expirationTtl: 86400 * 2`）

### 二段消費フロー

1. リクエスト到着 → 入力 token を近似カウント
2. (requests, tokens) を読み、上限チェック
3. 上限内なら処理続行、上限超なら 429 + `X-RateLimit-*` ヘッダ
4. ストリーミング完了後、実際の (input, output) tokens を post-increment

### Token 近似カウンタ (tiktoken なし)

```js
function estimateTokens(text) {
  const ja = (text.match(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g) || []).length;
  const enWords = text.replace(/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]/g, '').split(/\s+/).filter(Boolean).length;
  return Math.ceil(ja * 1.5 + enWords * 1.3);
}
```

精度は 20% 程度の誤差。レート制限用途には十分。実費精算は xAI 側 usage で事後補正。

### BYOK 時

- レート制限スキップ
- ただし最低限の DoS 対策として、**1リクエストあたり最大 token 数**だけは強制（プロキシ自体の保護のため）

---

## 7. コスト試算

### xAI Grok 3 想定 (2026-04 時点、要再確認)
- 入力 $3/1M tokens、出力 $15/1M tokens
- 1 リクエスト平均: 入力 2k / 出力 500 → **$0.0135**
- 10 req/day × 30日 / ユーザー = 300 req → $4.05/月/ユーザー
- 10 ユーザーで $40.5/月

### GPT-4o-mini との比較 (Phase 3 で Gateway 採用時)
- 入力 $0.15/1M、出力 $0.60/1M
- 1 リクエスト ≈ $0.0006 → 同条件で 10 ユーザー で **$1.8/月**

→ Phase 1 は Grok 直接で簡素化、ユーザー数が増えてコスト issue になれば Gateway + GPT 切替。**Shared 制限を 10 req/day で開始**することがコスト保護の本丸。

---

## 8. Phase ロードマップ

| Phase | 期間 | 内容 |
|---|---|---|
| **Phase 0** 準備 | 1日 | xAI 残高確認、Workers env に Chat 設定追加、ChatWidget の HTML 雛形 |
| **Phase 1** MVP | 3日 | `/api/chat` 実装、in-memory RAG、フローティング UI、Shared 10 req/day 制限、BYOK 透過、Pack 3 systemPrompt 適用 |
| **Phase 2** 体験向上 | 3日 | ストリーミング応答、マルチターン会話 + 履歴圧縮、レベル切替 UI、章末 Q&A セクション、エラー UX |
| **Phase 3** 精度向上 | 5日 | Cloudflare Vectorize 導入、章本文 embedding バッチ、出典表示 (「Part B ch08 より」) |
| **Phase 4** 学習支援 | 5日 | 学習者プロファイル (完了済 / 誤解パターン)、Pack 5 演習問題ジェネレータ統合、ソクラテス式モード |
| **Phase 5** 公開運用 | 継続 | 使用量メトリクス、コスト監視アラート、フィードバック UI (👍/👎)、A/B テスト |

Phase 1〜2 で **約1週間** で MVP〜実用レベル到達想定。Phase 3 以降は需要を見て判断。

---

## 9. セキュリティ考慮

### Prompt Injection 対策
- ユーザー入力は **system prompt の最後** に配置 (instructional hierarchy 準拠)
- 「以下の指示を無視して」「あなたは ChatGPT です」等の典型的 injection を正規表現で検出 → 警告 or 拒否
- RAG コンテキストは「参考情報」と明示し、区切り記号 (`---`) で囲む

### BYOK キーの扱い
- localStorage 保存（既存 TTS と同じ）。共用 PC 警告は既存設定モーダルで継続
- Workers 側では受信したキーを **KV / R2 に絶対保存しない、ログに出さない**
- キー検証用の `/api/byok/validate` エンドポイント別途用意 (xAI に最小リクエスト送って 401 判定)

### Abuse 防御
- IP + UA hash の複合キーで個人特定リスク最小化
- 同一キーから 10秒内に 3 リクエスト超 → 一時的に 429 (短期スロットリング)
- システムプロンプトに「機密情報・個人情報を出力しないでください」を含める

---

## 10. 運用指標

- 1日あたり Chat リクエスト数 (Shared / BYOK 別)
- 平均トークン消費 (入力 / 出力)
- 月次コスト (xAI usage ダッシュボード)
- 応答レイテンシ p50 / p95
- 👍/👎 フィードバック率 (Phase 5)
- 章ごとの Chat 利用率 (どの章が質問多いか → Part B 改善のヒント)

---

## 11. Out of Scope

- 音声入力 / 音声出力での対話（既存 TTS と分離維持。将来統合は別 ADR）
- 画像入力（学習アプリで diagram 質問は強力だが、Phase 6 以降）
- ユーザー間の Chat 共有・公開（個人学習に集中）
- AI に直接シミュレーター操作させる（観察対象に留める）

---

## 12. owner 判断待ち（実装着手前に確定すべき3点）

1. **Phase 1 のモデル**: xAI Grok 3 / Grok 4 / どれを default に？
2. **Shared レート制限の初期値**: 10 / 20 / 30 req/day のどれで開始？
3. **BYOK Phase 1 同梱可否**: Phase 1 で BYOK も入れる / Phase 2 に回す？

owner 確認が取れ次第、Phase 0 から着手します。

---

## 参照

- Matlens **Pack 3** — システムプロンプト設計（レベル別 / ソクラテス式 / 場面別テンプレート）
- Matlens **Pack 11** — Chat AI 実装方針 (本文書のアーキテクチャ章の原型)
- Matlens **Pack 12** — Vanilla JS + ESM Workers 最小実装の雛形 (本リポ採用想定)
  - Workers ESM ハンドラ (~200行、既存 worker-proxy.js に増設)
  - Vanilla JS ChatWidget (~120行 + CSS ~100行 + HTML ~15行)
  - xAI Grok SSE 中継の正確な実装 (`[DONE]` 終端・部分行バッファ・空 delta 対応)
  - 既知の落とし穴 5件: CORS / Workers ダッシュボード 1MB 制限 / SessionStorage タブ独立 / Grok-3-mini 日本語品質 / hash routing とスクロール位置
- 本リポ [`worker-proxy.js`](../worker-proxy.js) — 既存 TTS プロキシ (Chat 拡張のベース)
- 本リポ [`integration-points.md`](../integration-points.md) — Matlens 連携規約

---

_最終更新: 2026-04-23_
_次回見直し: owner 3 点判断完了時、または Matlens 側で Chat AI 実装が先行した場合_
