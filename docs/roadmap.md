# machining-fundamentals — Roadmap

本ドキュメントは長期計画。本日完了分はリポジトリの commit log を参照。

最終更新: 2026-04-23

---

## 本日（2026-04-23）完了

- Part A 全6章（材料科学、a1〜a6）執筆
- Part C1（研究実例集）追加
- Part B ch03 / ch07 / ch10 拡充（Pack 7 反映）
- Cloudflare Workers 拡張: `/api/chat` ハンドラ追加（3 ティア + OpenAI + Gemini）
- ChatWidget MVP（Vanilla JS、フローティング、SSE 中継、コンテキスト連動）
- TTS 段落単位 natural highlight + scroll
- 用語 anchor 24個（外部 deep link 対応）
- 設定パネル拡張: 言語 / フォント / フォントサイズ / コンテンツ幅 / リセット
- UI i18n インフラ（JA/EN、~30 キー）
- ch3 対話型ビジュアライザー（Vc/f/ap → MRR/Pc/n、SVG バー）
- 絵文字全廃 → SVG sprite (Feather/Lucide スタイル) 14 アイコン
- 章詳細を 880px 中央寄せ
- ボタン高さ揃え
- Vercel production deploy 数回

---

## Phase 2: 学習体験の深化（短期、~1-2 週間）

### 対話型ビジュアライザー他章展開
ch3 (MRR) と同パターンで:
- **ch6**: Kienzle 主分力 — Kc / h / b スライダーで Fc, Pc, η をプロット
- **ch8**: Taylor 工具寿命 — Vc・n（Taylor 指数）・C スライダーで T が両対数で動く
- **ch10**: Stability Lobe Diagram — 主軸回転数・モーダルパラメータで blim を計算（Pack 6 のロジック流用）

### Pack 8 概念 SVG の章注入
- Merchant 円 → ch6
- BUE サイクル 4 コマ → ch6
- 摩耗形態マップ → ch8
- 切屑形態 4 種 → ch6 / a6

### 既存 Part B 章のテキスト拡充
ch01〜ch09 の内容を Part A 詳細度に近づける。優先順:
1. ch4 工具の基礎（HSS/超硬/コーティング/CBN/PCD 詳細）
2. ch6 切削抵抗と熱（Kienzle 詳細、Merchant モデル導出）
3. ch8 工具摩耗と工具寿命（摩耗形態 6 種、Taylor 数値例）
4. ch5 被削材の基礎（被削性 ISO 分類）
5. ch9 加工精度と表面粗さ（ISO 4287 詳細、Ra/Rz/Rsm）

### Chat AI 拡張（kaze-ux 参考）
本日着手予定だが、本ドキュメント作成時点で別 commit:
- サイドバーモード切替（fab + 右サイド常駐）
- キーボードショートカット 8 アクション（Cmd+K で開閉等、IME 対応）
- ペルソナ自動検出（章 ID + 質問の語彙から学習レベル推定）

---

## Phase 3: シミュレーター拡張（大型、~2-4 週間想定）

> **本日は対象外**。Three.js + 物理計算が必要で、章本文と並行で書ける作業ではない。
> 既存 ch7「冷却液の役割」の CFD シミュレーター（Stable Fluids 法）と同等規模。

### 旋削シミュレーター
- 旋盤の 3D モデル（主軸 + チャック + バイト + ワーク）
- ワーク回転 → バイト位置決め → 切屑生成のアニメ
- スライダーで Vc/f/ap を変えて切削力 / 切屑断面積 / 動力を可視化
- カメラ操作（俯瞰 / 刃先ズーム）
- 実装規模見積: ~1500 行（Three.js + シーンセットアップ + GUI + 切削モデル）

### 穴あけシミュレーター
- ドリルの降下 + 回転
- 切屑排出（深穴で詰まりを可視化）
- L/D 比に応じてペックドリリング動作
- 内部給油の可視化（冷却液流体）
- 実装規模見積: ~1200 行

### 候補追加
- **フライスシミュレーター**（5軸動的）: 最大規模、~3000 行
- **力センサ波形ビューア**: 旋削動力 vs 時刻、FFT 表示

---

## Phase 4: 演習機能（Pack 5 / Pack 9 由来、~2 週間）

### 演習問題ジェネレータ
- カテゴリ: Taylor 寿命 / Kienzle 力 / SLD 安定性 / 表面粗さ予測
- 難度別: easy / medium / hard
- 自動採点（数値回答は ±5% 許容、記述は AI Chat 経由）
- 100 題の seed データ（Pack 9）

### 学習者プロファイル
- 完了済章 + 誤答パターンを localStorage 保存
- Chat AI が回答時にプロファイルを参照（Pack 3 の context_prompt_for）

---

## Phase 5: コンテンツ統合（Matlens 連携、~1 ヶ月）

`integration-points.md` と `docs/adr/ADR-COM-014-...` 参照。

- Phase 4-A 〜 4-E の monorepo 統合スケジュール（2026-06 〜 2026-09 想定）
- `@mc/glossary` `@mc/math-cutting` `@mc/standards` `@mc/viz-svg` の 4 packages 切り出し
- 段階的 npm 公開

---

## Phase 6: 翻訳と国際化拡張（長期、~1 ヶ月以上）

### コンテンツ英訳
- 17 章 × 平均 3000 字 = 51,000 字、技術翻訳精度が必要
- 機械翻訳ベース → 人手レビュー or Chat AI 経由オンデマンド翻訳
- I18N 辞書を `/locales/<lang>/<chapter>.json` に分離

### UI i18n 拡張
- 現在 30 キー → 200 キー前後（ホーム hero / about / 章カード / voice panel 詳細 等）

### 言語追加候補
- 中国語簡体（zh-CN）
- 韓国語（ko）
- 英語以外を含めるかは需要次第

---

## 永続的な改善トラック（継続）

- アクセシビリティ（WCAG AA）監査と改善
- パフォーマンス（LCP / CLS / TTI 計測）
- セキュリティ（CSP, BYOK key 管理強化）
- ドキュメント（README 多言語、CONTRIBUTING.md、コミュニティガイド）

---

## 不採用 / 検討中の案

- ❌ Vercel Workflow DevKit 導入（このアプリの粒度には過剰）
- ❌ Next.js 移行（Vanilla HTML で十分、Vercel ホスティングで動的レンダリング不要）
- ❌ React 化（既存 Vanilla JS の保守性で問題なし、Chat AI 含めて完結）
- ⚠ PWA 化（オフライン学習価値あるが優先度中、Phase 4 以降で）

---

_次回見直し: Phase 2 の対話型ビジュアライザー 4 章展開完了時、または Vercel デプロイ 1 ヶ月運用後の利用ログ確認時_
