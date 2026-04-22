# Chat AI 機能 実装計画 (草案 v2)

**ステータス**: Proposed (owner レビュー待ち、peer にモデル ID 正式確認依頼中)
**最終更新**: 2026-04-23
**v1 → v2 の変更**: provider を xAI Grok 単独から **OpenAI + Gemini** に変更、2 モードから **3 ティア** (Anonymous / Invited / BYOK) に拡張、招待コード機構を追加
**主要参照**: Matlens Pack 3 / Pack 11 / Pack 12
**関連**: [`integration-points.md`](../integration-points.md) / [`docs/monorepo-decisions.md`](./monorepo-decisions.md)

---

## 1. Vision — 学習者にとっての価値

machining-fundamentals は静的な学習教材ですが、現状の体験には次の壁があります：

- 章を読んでいて分からない用語があっても「教科書を再度開く」コストが高い
- 「なぜこの値になるのか」「なぜチタンは難削材なのか」を質問できる相手がいない
- Part A の物理と Part B の経験式の間の **「だから何？」** が読者個別にはつかめない

Chat AI が埋めるのは **「読みながら質問できる、章コンテキストを知っているチューター」** です。教科書を覚えるのではなく、目の前の疑問から逆引きで物理にたどる学習体験を作ります。

本アプリは **OSS として公開**するため、無限利用による API コスト暴走を防ぎつつ、**オープンな学習機会を提供**するバランス設計が必要。これを 3 ティアで解決します。

---

## 2. 3 ティア設計（Core Decision）

| ティア | 判定 | レート制限 | 利用可能モデル | 想定ユーザー |
|---|---|---|---|---|
| **Anonymous** | 招待なし (default) | **20 req/day**（変数化） | GPT-5.4-nano / Gemini 2.5 Flash | 一般公開の来訪者 |
| **Invited** | 有効な招待コード | **30 req/day**（変数化） | GPT-5.4-nano / Gemini 2.5 Flash | owner が個別配布した招待者 |
| **BYOK** | 自分の API キー入力 | **無制限** | 上記 + **GPT-5.4-mini** | 上級ユーザー・開発者 |

### 判定ロジック (Workers 側)

```js
function determineT(req) {
  const byokKey = req.headers.get('Authorization');
  if (byokKey && byokKey.startsWith('Bearer sk-')) return { tier: 'byok', key: byokKey };

  const inviteCode = req.headers.get('X-Invite-Code');
  if (inviteCode) {
    const entry = await env.INVITE_KV.get(`invite:${inviteCode}`);
    if (entry) {
      const parsed = JSON.parse(entry);
      if (parsed.valid) return { tier: 'invited', code: inviteCode };
    }
  }

  return { tier: 'anonymous' };
}
```

### レート制限値の env 管理

```
CHAT_LIMIT_ANON_REQ = 20        # Anonymous 1日あたり
CHAT_LIMIT_INVITED_REQ = 30     # Invited 1日あたり
CHAT_LIMIT_TOKENS_PER_DAY = 20000   # Anonymous/Invited 共通、入出力合計
CHAT_LIMIT_TOKENS_PER_REQ = 4000    # 1リクエスト入力上限
CHAT_MAX_OUTPUT_TOKENS = 800        # 1リクエスト出力上限
```

Cloudflare ダッシュボードから即時変更可能。運用中に調整可能な設計。

---

## 3. モデル選定

### デフォルト (Anonymous / Invited)

| モデル | 用途 | モデル ID (実装時確定) |
|---|---|---|
| **GPT-5.4-nano** ★default | 軽量・安価、一般的な質問応答 | `gpt-5.4-nano` (peer 確認中) |
| **Gemini 2.5 Flash** | 日本語強化、長文コンテキスト | `gemini-2.5-flash` (peer 確認中) |

UI でドロップダウン選択可能。owner の想定は `default = gpt-5.4-nano`。

### BYOK 専用

| モデル | 条件 | モデル ID |
|---|---|---|
| **GPT-5.4-mini** | BYOK モード有効時のみ UI で enable | `gpt-5.4-mini` (peer 確認中) |

ユーザーが自分の API キーを設定するまでは UI で disabled 表示。

> **⚠ モデル ID の最終確認**: owner 確認済のモデル名を採用。正式な API モデル ID 文字列は peer (Matlens) 側で実運用知見を持っているため、実装直前に最終確認して env 値として投入します。

### Provider 切替

OpenAI と Gemini は API 形式が異なるため、Workers 内で provider 別アダプタを実装:

```js
// provider 抽象化 (~50行)
const PROVIDERS = {
  'gpt-5.4-nano':  openaiAdapter,
  'gpt-5.4-mini':  openaiAdapter,
  'gemini-2.5-flash': geminiAdapter,
};

async function openaiAdapter(model, systemPrompt, messages, apiKey, streamCallback) { /* ... */ }
async function geminiAdapter(model, systemPrompt, messages, apiKey, streamCallback) { /* ... */ }
```

Vercel AI Gateway 統一は Phase 3 以降の選択肢として保留。Phase 1 は直接 fetch で十分シンプル。

---

## 4. 招待コード機構

### 設計: KV 動的管理

```
KV キー: invite:<code>
値 (JSON): {
  "createdAt": "2026-04-23T00:00:00Z",
  "valid": true,
  "note": "自由記述 (誰に発行したか等のメタ情報)",
  "usedAt": "2026-04-25T10:00:00Z"   // 初回使用時刻 (optional)
}
```

- 有効なキーが存在 → `valid` 判定
- `valid: false` で無効化 (取消)
- 使用履歴は KV value の `usedAt` 更新 (非同期 ctx.waitUntil)

### 発行・取消の運用フロー

**Phase 1** は **Cloudflare ダッシュボード手動編集**:
1. owner が招待したい人に 8-16 文字のランダムコードを生成して伝達 (e.g. `mf-2026-abc123`)
2. ダッシュボード > Workers KV > Namespace > Keys で `invite:mf-2026-abc123` を追加
3. 値に `{"createdAt":"2026-04-23T00:00:00Z","valid":true,"note":"user@example.com"}` を投入

**Phase 2** で管理用 API + 簡易 CLI スクリプト (`scripts/invite-admin.js`) を整備予定。

### セキュリティ・運用方針

- **1 コード = 複数利用 OK** (家庭 / 研究室内共有想定、Anonymous との差別化は集合単位で十分)
- ただし **レート制限は「コードを知っているクライアント側の個体」で別カウント** (IP + UA ハッシュ + invite-code の複合キー)
- コード漏洩時は `valid: false` で即取消可能
- コードの推測困難性: 暗号論的乱数 8 文字以上 (`crypto.randomUUID()` の substring 等で生成)

### HMAC 署名トークン案 (Phase 2 以降オプション)

運用が軌道に乗れば、KV ルックアップ不要の HMAC 署名方式に移行検討:
- 発行時のみ秘密鍵で署名、検証は HMAC verify のみ
- 取消は別途 blacklist KV で管理
- レイテンシ 0ms（KV 読み不要）

Phase 1 は KV シンプル方式で十分。

---

## 5. Architecture

```
Browser (single HTML SPA, vanilla JS)
  ├─ ChatWidget (floating button → modal panel)
  ├─ session storage: messages
  ├─ local storage: byok-key, invite-code, model-preference
  └─ fetch /api/chat (streaming response)
            │
            ├─ Authorization: Bearer sk-...  (BYOK 時)
            └─ X-Invite-Code: mf-2026-abc123  (Invited 時)
            ▼
Cloudflare Workers (既存 worker-proxy.js を拡張)
  ├─ /v1/tts (既存)        既存の TTS プロキシ
  ├─ /api/chat (NEW)       Chat 用ハンドラ
  │     ├─ Tier 判定:      BYOK / Invited / Anonymous
  │     ├─ レート制限:     KV で日次 requests + tokens の二段制限 (tier 別上限)
  │     ├─ RAG context:   in-memory glossary + chapter summaries
  │     ├─ プロンプト組立:  Pack 3 systemPromptFor(level) + RAG
  │     ├─ Provider 抽出:  modelId → openaiAdapter / geminiAdapter
  │     ├─ Shared (Anon/Invited): env の API キーで provider 呼び出し
  │     └─ BYOK: 受け取った Authorization で直接 provider 呼び出し
  ├─ KV (RATE_LIMIT_KV)    chat:<tier>:<clientKey>:<date>:requests / :tokens
  └─ KV (INVITE_KV)        invite:<code>
            │
            ├─ (anonymous/invited/byok GPT) → OpenAI API
            └─ (anonymous/invited Gemini)   → Google AI Studio API
```

### なぜ xAI Grok ではなく OpenAI + Gemini か (v1 からの方針変更)

| 軸 | xAI Grok (v1) | **OpenAI + Gemini (v2)** ★ |
|---|---|---|
| 既存インフラ整合 | TTS と統一される | TTS は Grok、Chat は別 provider |
| 価格 (1M tokens) | 入力 $3 / 出力 $15 | Nano/Flash: 入力 $0.05-0.15 / 出力 $0.30-0.60 目安 |
| 日本語品質 | 良好 | Gemini Flash は日本語特に強い |
| モデル選択肢 | Grok のみ | 小/中の selectable、BYOK で上位も |
| コスト暴走リスク | Shared で月 $40+/10人 | Nano default で月 $5 以下/10人想定 |

owner 判断: 学習者層に届けるには **Nano/Flash クラスで十分、コスト暴走しない** ことが重要。Grok は TTS で継続使用、Chat は別 provider で分離。

---

## 6. RAG 戦略

v1 から変更なし。

### Phase 1: In-Memory 全文検索 (Vector DB なし)

```js
function retrieveContext({ query, chapterId, termId }) {
  const chunks = [];
  // Tier 1: 現在の章サマリ
  if (chapterId && CHAPTER_SUMMARIES[chapterId]) {
    chunks.push(`[章 ${chapterId}]\n${CHAPTER_SUMMARIES[chapterId]}`);
  }
  // Tier 2: 直前クリックした用語
  if (termId) {
    const term = GLOSSARY_BY_ID[termId];
    if (term) chunks.push(`[用語 ${term.name}]: ${term.def}`);
  }
  // Tier 3: キーワード一致 (最大5)
  const matches = Object.values(GLOSSARY_BY_ID).filter(t =>
    query.includes(t.name) || query.toLowerCase().includes(t.en.toLowerCase())
  ).slice(0, 5);
  chunks.push(...matches.map(m => `[関連] ${m.name}: ${m.def}`));
  return chunks.length ? `参考情報:\n${chunks.join('\n\n')}` : '';
}
```

### Phase 3: Cloudflare Vectorize + OpenAI text-embedding-3-small

v1 と同じ。

---

## 7. UI 段階設計

### Phase 1 (MVP): フローティングウィジェット

v1 と同じ。追加要素：

- **モデル選択ドロップダウン**（GPT-5.4-nano / Gemini 2.5 Flash から選択）
- **BYOK モード時のみ GPT-5.4-mini が enable**
- **招待コード入力欄**（⚙ 設定モーダル内、既存の xAI キー設定の下に配置）
- **現在のティア表示**（「Anonymous: 残り 15/20」「Invited: 残り 28/30」「BYOK: 無制限」）

### Phase 2: サイドパネル常駐 (画面幅 ≥ 1200px のみ)

v1 と同じ。

---

## 8. レート制限 / コスト保護

### 複合キー

```
clientKey = sha256(IP + UA + inviteCode || '')
```

- IP のみ → オフィス NAT で誤巻き込み
- IP + UA → ブラウザ違いで別カウント
- invite-code 有無でも別カウント（同じ PC で Anon/Invited 区別）

### KV キー

```
chat:<tier>:<clientKey>:<YYYY-MM-DD>:requests
chat:<tier>:<clientKey>:<YYYY-MM-DD>:tokens
```

- tier を含めることで、招待コード追加後すぐカウンタリセット
- TTL 2日で自動消滅

### 二段制限

v1 と同じ (requests/day + tokens/day)。値は §2 の env で tier 別に設定。

### BYOK 時

レート制限スキップ。ただし DoS 対策として 1リクエストあたり最大 token 数 (`CHAT_LIMIT_TOKENS_PER_REQ`) だけは強制。

---

## 9. コスト試算

### Anonymous 層 (GPT-5.4-nano default 想定)
- 価格は peer 確認次第（想定: 入力 $0.05/1M、出力 $0.40/1M レンジ）
- 1 リクエスト平均: 入力 2k / 出力 500 → **$0.00030**
- 20 req/day × 30日 × 10 ユーザー = 6,000 req → **$1.80/月**

### Invited 層 (同 default)
- 30 req/day × 30日 × 10 ユーザー = 9,000 req → **$2.70/月**

### Gemini 2.5 Flash を default にした場合 (類似レンジ想定)
- 同等〜やや安の範囲で推移

→ **想定ユーザー数が 100 人規模でも月 $30 以下**、コスト暴走しない設計。

*※価格は peer 確認で実値に置換予定*

---

## 10. Phase ロードマップ

| Phase | 期間 | 内容 |
|---|---|---|
| **Phase 0** 準備 | 1-2日 | OpenAI/Gemini API キー発行、Workers env 設定、モデル ID 確定 (peer 回答待ち)、招待コード KV namespace 作成 |
| **Phase 1** MVP | 4-5日 | `/api/chat` 3ティア実装、OpenAI + Gemini アダプタ、招待コード KV 検証、in-memory RAG、フローティング UI、モデル選択ドロップダウン、BYOK 入力欄、Pack 3 systemPrompt |
| **Phase 2** 体験向上 | 3-4日 | ストリーミング応答、マルチターン会話、レベル切替 UI、章末 Q&A セクション、招待コード管理 CLI、エラー UX |
| **Phase 3** 精度向上 | 5日 | Cloudflare Vectorize、章本文 embedding バッチ、出典表示、HMAC 署名トークン検討 |
| **Phase 4** 学習支援 | 5日 | 学習者プロファイル、Pack 5 演習問題ジェネレータ統合、ソクラテス式モード |
| **Phase 5** 公開運用 | 継続 | 使用量メトリクス、コスト監視、フィードバック UI、A/B テスト |

v1 より Phase 1 が 1-2日伸びたのは、provider 抽象化と招待コード機構が追加されたため。

---

## 11. セキュリティ考慮

### Prompt Injection 対策
v1 と同じ。

### BYOK / 招待コードの扱い
- BYOK API キー: localStorage 保存 (既存 TTS と同じ)、Workers 側は転送のみ、保存禁止
- 招待コード: localStorage 保存、Workers 側は KV ルックアップのみ
- いずれもサーバログに出さない

### Abuse 防御
- 同一 clientKey から 10秒内に 3 リクエスト超 → 短期スロットリング (429)
- プロンプトで「機密情報・個人情報を出力しない」を system に含める
- 招待コード総当たりへの耐性: 8文字以上の乱数 + `valid: false` 無効化

### 招待コードの盗難・漏洩
- 1 コード漏洩時は `valid: false` 即取消
- owner は発行台帳 (`note` フィールド活用) で誰に発行したか追跡可能
- HMAC 署名方式 (Phase 3) に移行すれば再発行コスト低減

---

## 12. 運用指標

- tier 別日次 Chat リクエスト数
- 平均トークン消費 (入出力 / provider 別)
- 月次コスト (OpenAI usage / Gemini usage ダッシュボード)
- 応答レイテンシ p50 / p95 (provider 別)
- 招待コード発行数 / 取消数
- 👍/👎 フィードバック率 (Phase 5)
- 章ごとの Chat 利用率

---

## 13. Out of Scope

- 音声入力 / 音声出力での対話（既存 TTS と分離維持）
- 画像入力（Phase 6 以降）
- ユーザー間の Chat 共有・公開
- AI に直接シミュレーター操作させる
- 招待コード販売・収益化（完全に OSS の範疇に留める）

---

## 14. owner 判断待ち

v1 から更新：

1. **モデル ID 最終確認**: owner 確認済のモデル名 (`gpt-5.4-nano` / `gpt-5.4-mini` / `gemini-2.5-flash`) を peer (Matlens) で実運用 ID に確定
2. **Anonymous レート制限 20/day 妥当性**: OSS デモ URL を公開した時の想定流入で上限 20 が現実的か
3. **招待コード発行運用**: Phase 1 は手動ダッシュボード編集で割切 / Phase 2 で CLI or 管理画面整備のどちらが良いか
4. **Gemini provider の採用**: OpenAI 1本でなく Gemini も提供する理由（日本語品質 + multi-provider で片方障害時の冗長化）に同意
5. **招待コード: 1コード共有 vs 1ユーザー bind**: 草案は共有可 (家庭・研究室単位)、単一 bind 必要なら設計変更

owner 確認後、Phase 0 から着手します。

---

## 15. v1 からの主な差分

| 観点 | v1 | v2 |
|---|---|---|
| provider | xAI Grok 単独 | **OpenAI + Gemini** |
| モード数 | 2 (Shared / BYOK) | **3 (Anonymous / Invited / BYOK)** |
| 招待コード | なし | **KV 動的管理** |
| モデル選択 UI | なし | **ドロップダウン + BYOK 専用 enable** |
| Phase 1 期間 | 3日 | 4-5日 |
| コスト試算 | 月 $40/10人 (Grok) | 月 $2-5/10人 (Nano/Flash) |

---

## 16. 参照

- Matlens **Pack 3** — システムプロンプト設計
- Matlens **Pack 11** — Chat AI 実装方針（元アーキテクチャ）
- Matlens **Pack 12** — Vanilla JS + ESM Workers 最小実装の雛形
- 本リポ [`worker-proxy.js`](../worker-proxy.js) — 既存 TTS プロキシ (Chat 拡張のベース)
- 本リポ [`integration-points.md`](../integration-points.md) — Matlens 連携規約
- v1 の履歴は本ファイルの commit 8ce0337 / 9a6670e を参照

---

_最終更新: 2026-04-23 (v2)_
_次回見直し: peer モデル ID 回答受領時、または owner Phase 0 着手承認時_
