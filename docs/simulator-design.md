# シミュレーター拡張 — 設計ドキュメント

`docs/roadmap.md` Phase 3 のシミュレーター拡張に向けた仕様書。実装前の合意形成用。

**現状**: 第7章 (冷却液) に Three.js + Stable Fluids CFD シミュレーターが既存
**追加目標**: 旋削 / 穴あけシミュレーター、+ 5軸フライス（候補）

**最終更新**: 2026-04-23

---

## 1. 既存資産

### ch7 CFD シミュレーター
- Three.js r160 (UMD lazy load)
- Jos Stam Stable Fluids 法 (2D)
- iframe srcdoc 隔離 (メインアプリと分離、blob URL)
- 起動: `state.view = 'sim'` → renderSim() → template から取り出して iframe 注入
- 規模: ~1000 行 (HTML + script、index.html 末尾の sim-template に同梱)

### ch3 / ch6 / ch8 / ch10 対話型ビジュアライザー
- 純 SVG + range slider + リアルタイム計算
- 物理モデル: Vc 計算 / Kienzle 力 / Taylor 寿命 / 概念 SLD
- iframe 不要、メインアプリ内で動作

### ch2 旋削 2D アニメーション (本 commit で追加)
- 純 SVG + requestAnimationFrame
- ワーク回転インジケータ + バイト送り + 切屑スパーク
- スライダー: n/f/ap → リアルタイムで Vc/Vf/MRR
- 規模: ~150 行、iframe 不要

---

## 2. Phase 3-A: 3D 旋削シミュレーター

### 目的
2D アニメ (現状) では伝わらない「立体感 + 切削力の方向性」を 3D で見せる。
学習者の到達目標: バイトの姿勢 (すくい角・逃げ角) が切削力にどう影響するかの体感。

### 機能仕様

| 機能 | 必須 | 詳細 |
|---|---|---|
| ワーク 3D 表示 | ★必須 | 円柱メッシュ、回転アニメ、削り取られると径が縮む |
| バイト 3D 表示 | ★必須 | インサート + ホルダー、X-Z 軸で位置決め |
| 切屑生成可視化 | ★必須 | バイト先端から螺旋切屑を生成 (パーティクル or chunk geometry) |
| カメラ操作 | ★必須 | OrbitControls (マウス回転)、4 プリセット (俯瞰/側面/上面/刃先寄り) |
| パラメータ UI | ★必須 | n / f / ap スライダー + バイト姿勢 (rake / clearance) |
| リアルタイム計算 | ★必須 | Vc / Vf / MRR / Fc (Kienzle) を表示 |
| 切削音 | △任意 | 回転速度に応じた sine wave (WebAudio、quiz と同じ) |
| 切削温度カラー | △任意 | バイト先端の温度をジェットマップで色付け (Vc 依存) |
| 5軸対応 | ✗ Phase 3-D 候補 | A 軸・B 軸の傾斜は別段階 |

### 技術スタック

```
Three.js r160 (既存と統一)
  - Scene, PerspectiveCamera, WebGLRenderer
  - OrbitControls (examples/jsm)
  - メッシュ: CylinderGeometry (work), BufferGeometry (custom tool insert)
  - パーティクル: Points + 螺旋座標生成 (chip geometry)
  - シェーダー: 標準 MeshStandardMaterial で十分、温度マップは vertex color or shader

iframe srcdoc 隔離 (既存 ch7 と同パターン)
  - blob URL で独立読込
  - メインアプリと state 分離
  - import map で Three.js CDN 解決
```

### 実装ファイル構成

```
sim-templates/
  turning-3d.html       (~1500 行、HTML + Three.js + UI)
  drilling-3d.html      (~1200 行、Phase 3-B)

index.html
  - sim-template id="turning-3d-template" として末尾に同梱 or
  - 別ファイル fetch (Vercel deploy 構成上、別ファイル化が望ましい)
```

### renderSim 拡張

```js
// 現状: state.view === 'sim' → 単一の CFD sim
// 変更: state.simType を導入、ch7 から 'cfd', 新たに 'turning-3d' / 'drilling-3d'
function renderSim() {
  const tplId = `sim-${state.simType || 'cfd'}-template`;
  const tpl = document.getElementById(tplId);
  // ...既存パターン
}
```

URL 規約:
- `/#/sim/cfd` (既存 ch7)
- `/#/sim/turning-3d` (新規)
- `/#/sim/drilling-3d` (新規)

### 規模見積もり
- 純 Three.js + UI: 1500-2000 行 / シミュレーター
- 物理計算 (切屑生成軌跡、温度マップ等): +300 行
- テスト + 調整: 2-3 日 / シミュレーター
- **合計: 3-5 日 / 1 シミュレーター** (1 人作業前提)

---

## 3. Phase 3-B: 穴あけシミュレーター

### 機能仕様 (旋削との差分)

| 機能 | 仕様 |
|---|---|
| ドリル 3D | ツイストドリル (helix geometry)、スパイラル溝 |
| ワーク | 平板 (Box) + 既存穴 (CSG or hole geometry) |
| 切屑排出 | スパイラル溝に沿って上に排出される animation |
| L/D 制約表示 | 深さに応じてペックドリリング動作 (一定深さで引き抜き) |
| 内部給油 | through-coolant の流体粒子 (ch7 CFD 流用可能) |
| パラメータ | n / fn / 穴径 D / 深さ L |
| リアルタイム計算 | Vc / Vf / 穴あけ時間 / 必要動力 |

### 規模見積もり
- ドリルメッシュ + ペックアニメは旋削より複雑
- **5-7 日 / 1 シミュレーター** (1 人作業前提)

---

## 4. Phase 3-C: フライス 5 軸 (大型、候補)

最大規模。10-15 日想定。

- ボールエンドミル + 5 軸 (X/Y/Z + A/B 回転) 機構
- ツールパス可視化 (G コード読み込み or 軌跡生成)
- RTCP/TCPM の概念実装
- 工具姿勢に応じた切削力 (背分力分布) 可視化

優先度低。owner 需要次第で着手判断。

---

## 5. Phase 3 段階的アプローチ (推奨)

無理に full Three.js から始めず、段階的に投資:

| Step | 内容 | 想定工数 |
|---|---|---|
| **3-α** | 2D 旋削アニメ (本 commit で完了) | ✓ 完了 |
| **3-β** | 2D 穴あけアニメ (SVG + 縦方向ドリル降下 + ペック動作) | 半日 |
| **3-γ** | 2D フライス回転表示 (上面図、エンゲージ ae/D の可視化) | 半日 |
| **3-A** | 3D 旋削 (Three.js 初導入) | 3-5 日 |
| **3-B** | 3D 穴あけ | 5-7 日 |
| **3-C** | 3D フライス 5 軸 | 10-15 日 |

3-α-γ は SVG レベルで「全方式の触れる教材」を完成させ、3-A 以降は需要が
顕在化してから着手する判断が合理的。

---

## 6. 既存 CFD との一貫性

ch7 CFD シミュレーターと新規 3D シミュレーターは UI/UX を統一:

- 戻るリンク: 「← 第N章に戻る」(N は元章)
- パラメータパネル: 右側 / 上側、スライダー + 数値表示
- リアルタイム計算結果: パネル下部に大きめのフォントで
- カメラリセット / プリセットボタン
- 一時停止 / 速度倍率 (ch7 にある)
- mainEl.classList.add('wide') (既存)

---

## 7. owner 判断待ち

Phase 3 着手前に決めること:

1. **どの段階から始めるか**: 3-α (完了) → 3-β/γ (1日) → 3-A (3-5日) のどこまで?
2. **シミュレーター複数表示**: ch3 で旋削、ch4 で穴あけ、ch5 でフライス、を別々に設置するか、`/#/sim` で選択式にするか
3. **モバイル対応**: 3D シミュレーターはモバイルでパフォーマンス厳しい。「PC 推奨」表示で割り切るか、簡易版 fallback を作るか
4. **wrangler 導入**: 別ファイル fetch 前提なら sim ファイルを `/sim-templates/` に置く必要あり、Vercel 静的ホスティングで対応可能 (現状 OK)

---

## 8. リスク評価

- **Three.js バンドルサイズ**: ~600KB (gzip 後 ~150KB)。lazy load 必須 (既存 ch7 で実装済)
- **モバイル GPU 負荷**: 低スペック端末でフレーム落ち。frame budget 16ms 内維持に必要なポリゴン数管理
- **iframe 通信**: メインアプリから「シミュレーターを閉じる」イベントを送る場合、postMessage が必要
- **Three.js 0.161+ UMD 廃止** (peer kaze-ux 指摘): 0.160.1 固定が安全、ESM への移行は別タスク
- **保守負担**: シミュレーター 3 個になると総計 5000+ 行、index.html では限界。**`/sim-templates/*.html` 別ファイル化必須**

---

_次回見直し: owner が Phase 3 着手判断をした時、または 3-β/γ 完了時_
