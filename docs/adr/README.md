# ADR — Architecture Decision Records

このディレクトリは、本リポと Matlens の **monorepo 統合戦略** に関連する Architecture Decision Record を格納する場所です。

## 命名規約

ADR-013（Matlens 側）で定めた **prefix 分離方針** に従います：

| Prefix | 範囲 | 例 |
|---|---|---|
| `ADR-MAT-*` | Matlens 固有の判断 | （Matlens repo 側で管理） |
| `ADR-LRN-*` | machining-fundamentals 固有の判断 | （現在ゼロ） |
| `ADR-COM-*` | 両者にまたがる共通判断 | `ADR-COM-014-...md` |

`ADR-COM-*` は両リポで同内容を保持し、変更時は両側同時 PR とします。

## 現状一覧

| ID | タイトル | ステータス | 関連 Matlens ADR |
|---|---|---|---|
| [ADR-COM-014](./ADR-COM-014-monorepo-integration-execution-plan.md) | monorepo 統合の実行計画 | **Accepted** (2026-04-23) | [ADR-014](https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-014-monorepo-integration-execution-plan.md) |

参考に Matlens 側で Accepted 化された関連 ADR（本リポでは未複製、参照のみ）:

- [ADR-012](https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-012-machining-fundamentals-integration.md) — 親密化戦略（ビジョン・レベル定義）— **Accepted**
- [ADR-013](https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-013-url-contract-and-terminology-ownership.md) — 運用規約（URL Contract / 用語 master / 予告期間 / dead link）— **Accepted**

## 参照

- [`integration-points.md`](../../integration-points.md) — 相互参照規約・URL Contract
- [`docs/monorepo-decisions.md`](../monorepo-decisions.md) — monorepo 4 判断点メモ
- Matlens ADR ディレクトリ: <https://github.com/BoxPistols/Matlens/tree/main/docs/adr>
