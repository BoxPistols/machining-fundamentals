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

| ID | タイトル | ステータス |
|---|---|---|
| [ADR-COM-014](./ADR-COM-014-monorepo-integration-execution-plan.md) | monorepo 統合の実行計画 | Proposed |

## 参照

- [`integration-points.md`](../../integration-points.md) — 相互参照規約・URL Contract
- [`docs/monorepo-decisions.md`](../monorepo-decisions.md) — monorepo 4 判断点メモ
- Matlens ADR ディレクトリ: <https://github.com/BoxPistols/Matlens/tree/main/docs/adr>
