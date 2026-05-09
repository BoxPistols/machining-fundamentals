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
- Safari は autoplay 制限があるため、最初の 1 回はユーザー操作で再生開始する必要あり
- iOS PWA では `volume=0` での無音再生で autoplay unlock してから本再生に入る (実装済み)

---

## 3. VOICEVOX (`voicevox`)

無料・キャラ音声・無制限を使いたい人向け。**ローカル engine の起動が必須**。

### 3.1 セットアップ (5 分)

1. [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) からアプリをダウンロード&インストール
2. アプリを起動 (起動するだけで内部 engine が `http://localhost:50021` で待ち受け開始)
3. machining-fundamentals を開く → 歯車 [⚙ 設定] → 音声タブ → プロバイダー: **VOICEVOX**
4. プロバイダ別設定の「VOICEVOX URL」が `http://localhost:50021` になっていることを確認 (既定値)
5. 接続テスト → ✓ 表示で完了

### 3.2 動作中の挙動

- VOICEVOX アプリを閉じると engine も停止する → 再度起動するまで音声不可
- 端末を再起動した場合は VOICEVOX アプリの再起動が必要
- iPhone から自宅 PC の VOICEVOX を使いたい場合は **Quest 公開 API** 構成が必要 (詳細は [docs/voicevox.md §6](./voicevox.md))

### 3.3 推奨音声プリセット

「里石ユカ」を既定として設定済み。他のキャラに切り替えたい場合は VOICEVOX アプリで対応キャラの利用規約を確認して選択。

---

## 4. xAI Grok TTS (`grok`)

クラウド経由で動作するため **iPhone・出先・複数端末** で同じ品質の音声が使える。Shared モード (proxy 運用者の枠を共有) と BYOK モード (自分の API キーを使用) の 2 段構え。

### 4.1 まずは Shared モード (一番簡単)

proxy 運用者が用意した URL を貼るだけ。

1. 歯車 [⚙ 設定] → 音声タブ → プロバイダー: **xAI Grok TTS**
2. 「プロキシ URL（必須）」に運用者から共有された Worker URL (例: `https://machining-tts.xxx.workers.dev`) を貼る
3. xAI API キー欄は **空のまま** にする (Shared モードのトリガー)
4. [接続テスト]
   - ✓ 接続成功 (Shared) → 1 日 70 件まで使用可
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
| 容量上限 | 100 MB (超過時に古い順で 80 MB まで自動削除) |
| キー構成 | `provider:voiceId:hash(text)` |
| hash アルゴリズム | SHA-256 16 bytes hex (Phase A0 で `simpleHash` から強化) |
| 速度変更 | キャッシュ済み音声を `playbackRate` で変速 (再生成不要) |

設定 → 音声タブ → 「音声キャッシュ」セクションから:

- 現在の使用容量 / エントリ件数を表示
- 手動で全削除可能 (削除後は再課金が発生する旨の警告ダイアログあり)

旧 `simpleHash` 時代のキャッシュエントリは新 key と一致しないため使われなくなるが、容量上限の LRU で自然に押し出される。即座に消したい場合は手動削除を推奨。

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
