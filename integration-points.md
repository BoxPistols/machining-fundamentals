# Integration Points — machining-fundamentals × Matlens

このドキュメントは、本リポジトリ **machining-fundamentals**（学習アプリ）と、対になる業務アプリ **Matlens**（<https://github.com/BoxPistols/Matlens>）の相互参照・統合方針を定めるものです。Matlens 側の `docs/adr/ADR-012-machining-fundamentals-integration.md` と対になります。

両側の書き換えが発生する場合は、**まず本ドキュメントを更新し、それから実装 PR を立てる**運用とします。

---

## 1. Vision — なぜ親密化するか

machining-fundamentals は「金属加工の学習ロードマップ」、Matlens は「材料試験 + 切削プロセス研究の Web UI」です。ドメインが重なっており、**同じ物理・同じ用語・同じ数式**を扱っています。

目指すのは **Level 3: 相互参照による強結合**。

| Level | 内容 | 現状 |
|---|---|---|
| 1 | 並列な2プロジェクト | 〜2026-04 |
| **2** | **共通基盤 monorepo**（`@mc/*` packages 共有） | **中期目標** |
| **3** | **相互参照で強結合**（Matlens の画面 ↔ 学習章） | **当面の到達点** |
| 4 | 完全統合（モード切替 UI） | 将来 |

Level 3 の具体像：

- Matlens のユーザーが「この画面の背景数学は？」→ machining-fundamentals の該当章 anchor へジャンプ
- machining-fundamentals の学習者が「実務ツールを触る」→ Matlens の該当画面へジャンプ
- machining-fundamentals が Matlens の **onboarding / ヘルプシステム**を事実上担う

---

## 2. URL Contract — 凍結された URL 規約

### machining-fundamentals（本リポ）

単一 HTML SPA のため hash-based ルーティングを採用。ハッシュルーティングは `index.html` 内 `hashFromState`/`stateFromHash`/`syncHashToState` で実装済。

```
<base>/                           ホーム（章一覧）
<base>/#/chapter/<id>             章詳細
<base>/#/chapter/<id>/<anchor>    章内アンカー（term など）
<base>/#/about                    このアプリについて
<base>/#/sim                      CFD シミュレーター
```

- `<id>`: 文字列（`a1`〜`a6` の Part A / 数字 `1`〜`10` の Part B / 将来 `c1`〜 の Part C）
- `<anchor>`: `terms[].anchor` フィールドに一致するスラッグ（例: `atom`, `valence`, `Taylor`, `SLD`）
- 未知 `<id>` はホームにフォールバック（dead link を 404 的画面で露出しない）

#### 保証事項

1. 既存 `<id>` は**変更しない**（外部 deep link を壊さない）。
2. `<anchor>` 名は**一度公開したら変更しない**。用語の内部呼称が変わっても anchor は維持する。
3. 破壊的変更が不可避な場合、本 md の `§4 Update Policy` に従って事前予告する。

#### 既知の主要 anchor（初期リスト）

以下の anchor は用語集の主要項目として Matlens 側から参照される想定で、永続性をコミットする。

| anchor | 日本語 | 格納章 | URL (fragment 部) |
|---|---|---|---|
| `atom` | 原子 | a1 | `#/chapter/a1/atom` |
| `valence` | 価電子 | a1 | `#/chapter/a1/valence` |
| `metallic-bond` | 金属結合 | a2 | `#/chapter/a2/metallic-bond` |
| `thermal-conductivity` | 熱伝導率 | a2 | `#/chapter/a2/thermal-conductivity` |
| `fcc` | FCC結晶 | a3 | `#/chapter/a3/fcc` |
| `bcc` | BCC結晶 | a3 | `#/chapter/a3/bcc` |
| `hcp` | HCP結晶 | a3 | `#/chapter/a3/hcp` |
| `dislocation` | 転位 | a4 | `#/chapter/a4/dislocation` |
| `slip-system` | すべり系 | a4 | `#/chapter/a4/slip-system` |
| `work-hardening` | 加工硬化 | a4 | `#/chapter/a4/work-hardening` |
| `phase-diagram` | 状態図 | a5 | `#/chapter/a5/phase-diagram` |
| `martensite` | マルテンサイト | a5 | `#/chapter/a5/martensite` |
| `precipitation-hardening` | 析出強化 | a5 | `#/chapter/a5/precipitation-hardening` |
| `johnson-cook` | Johnson-Cook 構成式 | a6 | `#/chapter/a6/johnson-cook` |
| `shear-band` | せん断帯 | a6 | `#/chapter/a6/shear-band` |
| `Vc` | 切削速度 | 3 | `#/chapter/3/Vc` |
| `f` | 送り | 3 | `#/chapter/3/f` |
| `ap` | 切込み | 3 | `#/chapter/3/ap` |
| `Kc` | 比切削抵抗 | 6 | `#/chapter/6/Kc` |
| `VB` | 逃げ面摩耗 | 8 | `#/chapter/8/VB` |
| `Taylor` | Taylor 工具寿命式 | 8 | `#/chapter/8/Taylor` |
| `Ra` | 表面粗さ | 9 | `#/chapter/9/Ra` |
| `SLD` | Stability Lobe | 10 | `#/chapter/10/SLD` |

### Matlens 側（参考）

`<matlens-base>/#/` をルートとし、ルーティングは Matlens 側で決定。machining-fundamentals からは次の方針でリンクする：

- 正規のエントリ URL のみ参照（内部的なクエリパラメータに依存しない）
- 画面 ID は Matlens 側 ADR で管理される

---

## 3. Terminology Ownership — 用語の master

- **用語集の master は machining-fundamentals** に置く（`CHAPTERS[].terms[]`）。
- Matlens 側は `@mc/glossary` パッケージ（monorepo 化前は独自ミラー）で利用し、master 更新時に追随する。
- 用語の追加は、まず本リポの該当章の `terms[]` に PR → Matlens 側の mapping 更新 PR、の順序。

---

## 4. Update Policy — 破壊的変更の予告

### 許容される変更

- 新しい章の追加（既存 id を変えない限り）
- `terms[].def` の記述改善（anchor を保つ限り）
- 新しい anchor の追加

### 予告が必要な変更（Matlens 側へ通知）

Matlens ADR-013 と足並みを揃える：

| 変更 | 予告期間 |
|---|---|
| 既存 chapter `<id>` の変更 | 1週間以上 |
| 既存 `<anchor>` の削除または rename | 3日以上 |
| URL 規約そのものの変更 | 1週間以上 |
| 章・用語の**追加** | 予告不要 |
| `pending: true` の解除（参照 OK 化） | 即時歓迎 |

通知は Matlens リポの Issue 起票で行い、本 `integration-points.md` の該当箇所を同じ PR に含める。

---

## 5. Out of Scope — お互い触らない領域

### machining-fundamentals が関与しない

- Matlens の業務ドメイン（試験片トラッカー / 試験報告 / LIMS 連携等）
- Matlens の数値計算実装（`@mc/math-cutting` として切り出された段階で依存するのみ）

### Matlens が関与しない

- 本リポの学習コンテンツ本文（章テキスト）
- 本リポの Cloudflare Workers プロキシ実装 / Vercel デプロイ設定

### 両者共通のポリシー

- ライセンス方針（本リポ: コード MIT + コンテンツ CC BY 4.0、Matlens: MIT）は当面併存。
- monorepo 統合時は別途 ADR で統合ライセンス方針を決める（判断点は `monorepo-decisions.md` を参照）。

---

## 6. Cross-References

- Matlens ADR-012: <https://github.com/BoxPistols/Matlens/blob/main/docs/adr/ADR-012-machining-fundamentals-integration.md>
- Matlens docs/research: <https://github.com/BoxPistols/Matlens/tree/main/docs/research>
- 本リポ README: [README.md](./README.md)
- monorepo 統合判断点メモ（ドラフト）: [docs/monorepo-decisions.md](./docs/monorepo-decisions.md)

---

_最終更新: 2026-04-23_
_次回見直し: Vercel production URL 確定時、または Matlens 側 Phase 1 実装 PR マージ時、いずれか早い方_
