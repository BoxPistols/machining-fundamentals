# 音声読み上げ 初期設定ガイド

最終更新: 2026-05-10

machining-fundamentals の **章本文音声読み上げ機能** を初めて使う人向けの手順書。3 つの TTS プロバイダ (browser / VOICEVOX / xAI Grok) のセットアップと、用途別のおすすめ選定をまとめる。

VOICEVOX 個別の運用詳細 (engine ポート変更 / Quest 公開 API / Docker 化等) は **[docs/voicevox.md](./voicevox.md)** に分離済み。本書はそれ以前の「最初の一歩」を扱う。

---

## 1. プロバイダ早見表

| ID | 名前 | 形態 | コスト | 品質 | 初期設定難度 | 主用途 |
|---|---|---|---|---|---|---|
| `browser` | ブラウザ内蔵 | OS の Web Speech API | 無料 | 低〜中 (OS 依存) | なし | お試し / オフライン |
| `voicevox` | VOICEVOX | ローカル engine (`localhost:50021`) | 無料 | 高 (キャラ音声) | 中 (アプリ起動が必要) | 自宅常用 |
| `grok` | xAI Grok TTS | Cloudflare Worker → xAI API | $4.20 / 1M chars (BYOK) もしくは Shared 70 件/日 | 高 (英寄り) | 高 (proxy 構築が必要) | モバイル / 共有環境 |

選定の目安:

| やりたいこと | 推奨 |
|---|---|
| 何も準備せず 1 章だけ聞きたい | `browser` |
| 自宅 PC で章をじっくり聞く | `voicevox` |
| 通勤・iPhone・出先で使う | `grok` (Shared か BYOK) |
| 開発時の声質確認 | `voicevox` (キャラ多くて評価しやすい) |

---

## 2. ブラウザ内蔵 (`browser`)

何も準備せず動く既定値。

1. 画面右上の歯車 [⚙ 設定] → 音声タブ → プロバイダー: **ブラウザ内蔵**
2. 音声リストから好きな声を選択 (OS 内蔵音声が並ぶ)
3. 速度・音量を調整して [▶︎ 再生]

OS 別おすすめ音声:

- **macOS**: Kyoko, Otoya (拡張音声をシステム設定で追加するとさらに自然)
- **iOS**: Kyoko Premium (設定 → アクセシビリティ → 読み上げコンテンツで追加)
- **Windows**: Microsoft Haruka / Sayaka (言語パック追加で出現)

特性:

- オフラインで完全動作、課金なし、登録なし
- Safari / iOS は autoplay 制限があるため、最初の 1 回はユーザー操作 (▶︎ ボタン押下) で再生開始する必要あり

---

## 3. VOICEVOX (`voicevox`)

無料・キャラ音声・無制限を使いたい人向け。**ローカル engine の起動が必須**。

### 3.1 セットアップ (5 分)

1. [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) からアプリをダウンロード&インストール
2. アプリを起動 (起動するだけで内部 engine が `http://localhost:50021` で待ち受け開始)
3. machining-fundamentals を開く → 歯車 [⚙ 設定] → 音声タブ → プロバイダー: **VOICEVOX**
4. プロバイダ別設定の「エンジン URL」が `http://localhost:50021` になっていることを確認 (既定値)
5. 接続テスト → ✓ 表示で完了

### 3.2 動作中の挙動

- VOICEVOX アプリを閉じると engine も停止する → 再度起動するまで音声不可
- 端末を再起動した場合は VOICEVOX アプリの再起動が必要
- iPhone・別端末から自宅 PC の VOICEVOX を叩きたい場合は、エンジンを LAN/HTTPS で公開する仕組み (リバースプロキシや SSH トンネル等) を別途用意し、エンジン URL にその公開先を入力する。本アプリ側は任意の URL を受け付けるので構成は運用者に委ねる

### 3.3 推奨音声プリセット

VOICEVOX プロバイダの既定話者は **里石ユカ（つぼみ）** (id `126`)。話速・音高・抑揚など audio_query パラメータをチューニング済みプリセットを内蔵しており、章の朗読向きに整えてある。Claude CLI 側の読み上げ (`~/.claude/hooks/voicevox-config.json`) もデフォルト話者は同じ 126 で揃えている。

選択は localStorage に保存されるので一度別キャラに切り替えれば次回以降はそちらが選ばれる。VOICEVOX アプリで対応キャラの利用規約を確認のうえ選択すること。

> **備考**: VOICEVOX 公式アプリにある 7 軸 (話速・音高・抑揚・音量・間の長さ・開始/終了無音) のスライダ調整は、本サイト UI には**現時点で未実装**。再生速度のみ歯車 → 音声タブの速度スライダで `playbackRate` 経由で変えられる（音色は変わらない）。詳細パラメータの GUI 調整は別 PR で対応予定。

### 3.4 セキュリティ・データ取り扱い

ローカル engine への HTTP リクエストのみで完結する。

- **章のテキストはブラウザから `http://localhost:50021` の VOICEVOX engine に直接 POST される**。インターネット側のサーバーには一切送らない（本サイトの worker-proxy も経由しない）
- engine 側の `/audio_query` および `/synthesis` エンドポイントを叩くだけ。ログアウト・テレメトリ・統計送信はしない（VOICEVOX engine は OSS であり、ソースから挙動が確認できる: <https://github.com/VOICEVOX/voicevox_engine>）
- 生成された音声 blob は IndexedDB (`cfd-tts-cache`) に同一オリジン下で保存され、再利用される
- iPhone 等から自宅 PC の engine を公開する構成にする場合は **HTTPS 化と認証 (Basic 認証 / OAuth リバースプロキシ等) を必ずかけること**。素のままインターネット公開すると第三者が無制限に合成 API を叩ける状態になる

### 3.5 利用規約・ライセンス（再配布・公開・収益化する人向け）

VOICEVOX で生成した音声を **配布・公開・収益化する場合**、以下の条件を満たす必要がある。本サイトを単に閲覧・読み上げで使う分には個別チェック不要だが、ダウンロード/録音して別の場で公開する人は要確認。

- **クレジット表記が必須** — 形式は `VOICEVOX:キャラ名` (例: `VOICEVOX:ずんだもん` `VOICEVOX:里石ユカ`)
  - 本サイトは VOICEVOX 選択中、画面上に該当クレジットを自動表示する (`Powered by VOICEVOX:〇〇`)
  - 録音して二次利用する場合は **利用者側でクレジット併記の義務を負う**
- **キャラ別の利用規約が個別にある** — 商用可否・年齢制限作品での使用可否・改変可否・声真似可否などはキャラごとに違う
  - 公式まとめ: <https://voicevox.hiroshiba.jp/term/>
  - 例: ずんだもん公式規約 <https://zunko.jp/con_ongen_kiyaku.html>
  - 例: 里石ユカ等の規約は VOICEVOX 公式まとめページから各キャラページへ辿る
- **エンジン本体のライセンス** — VOICEVOX engine は LGPL。本サイトは engine を再配布せず、ローカル engine への HTTP クライアントとして振る舞うのみなので、本サイト側に LGPL 派生的義務は発生しない
- **動画化・配信・商用利用** — 各キャラ規約を個別に必ず読むこと。違反した場合の責任は利用者が負う（本サイト/リポジトリは保証しない）

詳細運用 (engine ポート変更 / Docker 化 / Claude CLI 連携 / Quest 等) は **[docs/voicevox.md](./voicevox.md)** に整理してある。

---

## 4. xAI Grok TTS (`grok`)

クラウド経由で動作するため **iPhone・出先・複数端末** で同じ品質の音声が使える。Shared モード (proxy 運用者の枠を共有) と BYOK モード (自分の API キーを使用) の 2 段構え。

### 4.1 まずは Shared モード (一番簡単)

proxy 運用者が用意した URL を貼るだけ。

1. 歯車 [⚙ 設定] → 音声タブ → プロバイダー: **xAI Grok TTS**
2. 「プロキシ URL（必須）」に運用者から共有された Worker URL (例: `https://machining-tts.xxx.workers.dev`) を貼る
3. xAI API キー欄は **空のまま** にする (Shared モードのトリガー)
4. [接続テスト]
   - ✓ 接続成功 (Shared) → 1 日の合成回数に上限あり (既定 70 件、proxy 運用者の `RATE_LIMIT_PER_DAY` 設定で変動)
   - ✗ 503 → proxy 側に共有キー未設定。BYOK にするか運用者に依頼
   - ✗ 429 → 1 日上限到達。UTC 翌 0 時にリセット
   - ✗ Load failed / Failed to fetch → CORS 未許可 or proxy URL 誤り

### 4.2 BYOK モード (無制限・自分の課金)

自分の xAI アカウントで上限なしに使いたい場合。

1. [xAI Console](https://console.x.ai/) でログイン → API Keys → 新規作成
   - キーは `xai-` で始まる 84 文字程度
   - ACL は TTS 用権限を含めて発行
2. 歯車 [⚙ 設定] → 音声タブ → プロバイダー: **xAI Grok TTS**
3. 「プロキシ URL（必須）」と「xAI API キー」両方を貼る
4. proxy 運用者が `PROXY_SHARED_SECRET` を設定している場合は「プロキシ合言葉」も貼る
5. [接続テスト] → ✓ で BYOK モードとして動作

セキュリティ:

- API キーは **ブラウザの localStorage のみ** に保存される
- proxy には Bearer ヘッダで渡されるが、proxy 側はそのまま xAI に転送する (proxy 側で永続化しない)
- 共有 PC で使う場合は使用後に「空欄にして保存」でブラウザから削除

### 4.3 自分で proxy を立てる (運用者向け)

自前の Cloudflare Worker を立てて、自分が運用者になるパターン。手順は **[README.md の Grok TTS セクション](../README.md#grok-tts高品質音声読み上げ)** を参照。要点だけ:

- Cloudflare Workers に [`worker-proxy.js`](../worker-proxy.js) をペースト&Deploy
- env 必須: `XAI_API_KEY` (Secret), `ALLOWED_ORIGIN` (Text)
- KV Binding 必須: `RATE_LIMIT_KV` (これがないと rate limit が効かない)
- env 任意: `PROXY_SHARED_SECRET` (BYOK 利用者の追加認証), `RATE_LIMIT_PER_DAY` (省略時 70)

---

## 5. キャッシュ動作

2 回目以降の同じ章は **IndexedDB に保存された音声 blob** からローカル再生される (API 課金なし、オフライン可)。

| 項目 | 値 |
|---|---|
| 保存先 | IndexedDB (DB 名 `cfd-tts-cache` / store 名 `audio`) |
| 容量上限 | ブラウザのストレージ quota に依存 (アプリ側での自動 trim や LRU 削除は未実装) |
| キー構成 | `provider:voiceId:hash(text)` |
| hash アルゴリズム | SHA-256 → 先頭 16 bytes を hex 化 (32 文字)。以前の `simpleHash` から強化済み |
| 速度変更 | キャッシュ済み音声を `playbackRate` で変速 (再生成不要) |

設定 → 音声タブ → 「音声キャッシュ」セクションから:

- 現在の使用容量 / エントリ件数を表示
- 手動で全削除可能 (削除後は再課金が発生する旨の警告ダイアログあり)

旧 hash 方式時代のキャッシュエントリは新 key と一致しないため再利用されなくなる。古いキャッシュを完全に消したい場合は上記の手動削除を推奨。

---

## 6. トラブルシュート

| 症状 | 想定原因 | 対処 |
|---|---|---|
| `browser` で声が出ない | autoplay 制限 (Safari/iOS) | 一度 [▶︎] を手動でクリック後に再試行 |
| `browser` の声リストが空 | OS 音声未インストール | OS 設定からアクセシビリティ音声を追加 |
| `voicevox` 接続テスト失敗 | engine 未起動 | VOICEVOX アプリ起動を確認 |
| `voicevox` 別ポートで使いたい | engine ポート変更 | 設定の URL を `http://localhost:NNNNN` に変更 |
| `grok` "Load failed" / "Failed to fetch" | CORS 未許可 or proxy URL typo | DevTools の Network/Console を確認 |
| `grok` 503 "Shared API key not configured" | proxy 側に `XAI_API_KEY` 未設定 | BYOK モードに切替 or 運用者に連絡 |
| `grok` 429 "Daily rate limit exceeded" | Shared 1 日上限到達 | UTC 翌 0 時まで待つ or BYOK 切替 |
| `grok` 401 "Bad credentials" | xAI API キーが無効 / 期限切れ / ACL 不足 | xAI Console でキー再発行 |
| `grok` 401 "Proxy secret mismatch" | プロキシ合言葉が不一致 | 運用者から正しい値を入手 |
| 全 provider で章再生途中で止まる | ブラウザバックグラウンドタブ抑制 | タブを前面に保つ or PWA インストール |

---

## 7. 関連ドキュメント

- **[docs/voicevox.md](./voicevox.md)** — VOICEVOX 詳細運用 (engine 起動方式、Quest 公開 API、Claude Code 連携)
- **[README.md](../README.md)** — リポジトリ全体、Grok proxy 構築の運用者向け手順
- **[worker-proxy.js](../worker-proxy.js)** — Cloudflare Worker 本体 (env 一覧コメント付き)
