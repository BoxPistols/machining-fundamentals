# Monorepo 統合 — 4 判断点メモ（草案）

machining-fundamentals × Matlens の monorepo 統合（Level 2 → Level 4）に向けて、Matlens 側 peer から提示された 4 つの判断点について、本リポ側の **推奨方針** を整理する。

最終決定はオーナー判断。本メモは proposal であり、合意形成後に Matlens 側 ADR-012 / ADR-013 と整合させる。

参照: [integration-points.md](../integration-points.md), Matlens [ADR-012](https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-012-machining-fundamentals-integration.md) / [ADR-013](https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-013-url-contract-and-terminology-ownership.md)

---

## 判断点 1: ADR の再採番

**問題**: Matlens 側に ADR-001〜ADR-013 がある。machining-fundamentals 側は ADR を持っていない。monorepo 統合時にどう扱うか。

| 選択肢 | 説明 | 評価 |
|---|---|---|
| A. Matlens の ADR をそのまま引き継ぐ | ADR-001〜013 が monorepo の ADR になる | ✓ 履歴保全。✗ 数字が learning 起源と混在し意味曖昧 |
| **B. プレフィックス分離** | `ADR-MAT-001`, `ADR-LRN-001`, `ADR-COM-001` のように所属を示す | **★ 推奨** |
| C. 完全再採番 | 全 ADR を 001 から振り直し | ✗ Matlens の既存リンクが死ぬ |

**推奨: B**
理由: 履歴保全と所属明示の両立。当面の追加コストはプレフィックス命名規約のみ。Matlens 既存 ADR は **ADR-MAT-XXX** にリネーム（リダイレクトなしの破壊的変更だが、外部リンクが少ない段階の今が機会）。本リポは未だ ADR ゼロなので追加コストなし。

---

## 判断点 2: デザイントークンの共通化

**問題**: Matlens は 4 テーマ（light / dark / eng / cae）を持つ。machining-fundamentals は 2 テーマ（light / dark）。共通化するか。

| 選択肢 | 説明 | 評価 |
|---|---|---|
| A. 完全共通化 | `@mc/ui-tokens` を作って両 app で参照 | ✗ machining-fundamentals に eng/cae を持たせる必要なし、複雑化 |
| **B. ベース共通 + 拡張別** | base tokens（grayscale, accent, semantic）は共通、業務系テーマ（eng/cae）は Matlens 専用 | **★ 推奨** |
| C. 完全独立 | 共通化しない | ✗ ブランディングが分裂、保守二重化 |

**推奨: B**
理由: 学習アプリと業務アプリで「アクセント色」「等価コントラスト」を揃えると、相互リンクで遷移したときの**心理的な距離が縮まる**。一方で eng/cae は業務固有のため共通化する価値が薄い。

実装イメージ:
```
@mc/ui-tokens-base     ← 両 app から import (--bg-1, --bg-2, --accent, --text-0, etc.)
@matlens/ui-tokens-ext ← Matlens のみ (--theme-eng-*, --theme-cae-*)
```

---

## 判断点 3: ライセンス整合

**問題**: machining-fundamentals は **MIT（コード）+ CC BY 4.0（コンテンツ）** のデュアル。Matlens は **MIT 単独**。monorepo にしたらどうするか。

| 選択肢 | 説明 | 評価 |
|---|---|---|
| A. 全 MIT 化 | コンテンツも MIT で配布 | ✗ MIT は「ソフトウェア」を対象とする文言で、本文・図にはやや不向き |
| **B. パッケージ別ライセンス** | `apps/learning` のコンテンツは CC BY 4.0、それ以外は MIT を継承 | **★ 推奨** |
| C. 全 CC BY 4.0 化 | Matlens 含めコンテンツ寄りライセンス | ✗ 業務コードに対しては不適切 |

**推奨: B**
理由: ライセンス分離は SPDX タグで明確化可能。各ファイル冒頭に `SPDX-License-Identifier: MIT` または `CC-BY-4.0` を書けば自動チェック可。GitHub も認識する。

ファイルレベル指定例:
- `apps/learning/src/content/**/*.md` → `CC-BY-4.0`
- `apps/learning/src/**/*.{ts,tsx,html,css}` → `MIT`
- `packages/@mc/**` → `MIT`
- `apps/matlens/**` → `MIT`

LICENSE / LICENSE-CONTENT の 2 ファイルをルートに保ち、SPDX で参照させる方式。

---

## 判断点 4: npm 公開範囲

**問題**: monorepo の packages（`@mc/*`）を npm に公開するか。公開すれば外部利用可、公開しなければ内部限定。

| 選択肢 | 説明 | 評価 |
|---|---|---|
| A. 全 public | 全 packages を npm.org に公開 | ✗ プロトタイプ段階で API が固まる前は推奨しない |
| **B. 段階的 public** | `@mc/glossary`, `@mc/math-cutting`, `@mc/standards`, `@mc/viz-svg` の 4 つだけ public、他は private | **★ 推奨** |
| C. 全 private | npm 非公開、両 app 内部利用のみ | ○ 安全だが OSS の恩恵を受けにくい |

**推奨: B**
理由: glossary / math-cutting / standards / viz-svg は API が比較的安定で外部からも価値が高い（金属加工教育 / 業務 OSS 分野で）。逆に `@mc/ai-prompts`, `@mc/rag-knowledge`, `@mc/exercises` は両 app 固有のロジックを含み、prematurely 公開すると変更が困難になる。

公開タイミング:
1. **Phase A**: monorepo 化完了 → 全 private で動作検証
2. **Phase B**: API 安定 → 4 packages を v0.x で public 公開（experimental タグ）
3. **Phase C**: v1.0 で安定化、SemVer 厳守

公開時の package 名候補（npm の名前空間）:
- `@boxpistols/mc-glossary`（個人スコープ）
- `@machining/glossary`（取得可能なら organization scope）
- どちらにせよ user 側で npm org を取得後に最終決定

---

## 統合まとめ — Phase 計画への接続

判断点 1〜4 が決まると、Matlens ADR-012 の Phase 1〜4 と次のように接続する：

| Phase | 動く判断点 |
|---|---|
| Phase 1（双方向リンク + ADR-013 運用開始） | 判断不要（既存 repo のまま） |
| Phase 2（最小統合 — `@mc/math-cutting` + `@mc/glossary` 切り出し） | **判断点 1** プレフィックス命名、**判断点 4** Phase A |
| Phase 3（UI 共通化 — `@mc/viz-svg`, `@mc/ui-tokens-base`） | **判断点 2** B案実装 |
| Phase 4（完全統合） | **判断点 3** SPDX 導入、**判断点 4** Phase B/C |

Phase 1 は既に Matlens 側で着手済（PR #74 merge）のため、本判断点メモは **Phase 2 に入る前に user 確認を取る** ことが目的。

---

## 次のアクション

1. **owner（BoxPistols）が判断点 1〜4 にレビュー**
2. レビュー結果を Matlens 側 peer に送信（送信は私が代行可能）
3. Matlens 側で ADR-014「monorepo 統合実行計画」を起票（peer 担当）
4. 実際の monorepo 化作業は別 PR で（タイミングは未定、Phase 1 の運用が安定してから）

---

_最終更新: 2026-04-23（草案 v1）_
