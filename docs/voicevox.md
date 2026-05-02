# VOICEVOX 音声読み上げ ガイド

最終更新: 2026-05-02

本ドキュメントは machining-fundamentals における **VOICEVOX 連携** (web 章再生 + Claude
Code セッション読み上げ) の実装と運用をまとめたもの。読者は「サイトに来た学習者」と
「ローカルで Claude Code を回す開発者」の両方を想定している。

---

## 1. 概要

`machining-fundamentals` は学習体験の一環として **章本文を音声で読み上げる** 機能を持つ。
読み上げは複数の TTS プロバイダから選択でき、現状サポートしているのは次の 3 系統:

| プロバイダ ID | ラベル | 配信形態 | コスト | 品質 |
|---|---|---|---|---|
| `browser` | ブラウザ内蔵（無料） | Web Speech API (OS 内蔵) | 無料 | 低〜中 (OS 依存) |
| `voicevox` | VOICEVOX（ローカル・無料） | ローカル engine (`localhost:50021`) | 無料 | 高 (キャラ音声) |
| `grok` | xAI Grok TTS（$4.20/1M文字） | Cloudflare Worker 経由の xAI API | $4.20 / 1M chars | 高 (英寄り) |

過去に存在した **TTS Quest プロバイダは削除済み** (`~1 req/sec` のレート制限が章
丸ごと再生に向かないため。詳細は §10「不採用」参照)。

VOICEVOX は **「無料・無制限・オフライン・キャラ音声」** が同時に成立する唯一の
選択肢として中心的に扱う。前提として **手元で VOICEVOX アプリ (またはエンジン
イメージ) が起動していること** が必要。

### 1.1 アーキテクチャ概要

```
                                +----------------------+
                                |  VOICEVOX engine     |
                                |  http://localhost    |
                                |       :50021         |
                                +----------+-----------+
                                           ^
                                           |  /audio_query
                                           |  /synthesis
                                           |  /speakers
                                           |  /version
                +--------------------------+--------------------------+
                |                                                     |
        +-------+--------+                                  +---------+--------+
        |  Web (index.   |                                  |  Claude Code     |
        |  html)         |                                  |  Stop hook       |
        |                |                                  |                  |
        |  - probe       |                                  |  voicevox-       |
        |  - dropdown    |                                  |  stop.sh         |
        |  - 起動ガイド  |                                  |  voicevox-       |
        |  - clip 再生   |                                  |  extract.py      |
        |  - クレジット  |                                  |  voicevox-       |
        |                |                                  |  apply-preset.py |
        +----------------+                                  +------------------+
                                                                     ^
                                                                     |
                                                            +--------+---------+
                                                            |  vv  CLI         |
                                                            |  statusline      |
                                                            +------------------+
```

ブラウザは `http://localhost:50021` を **secure context** として直接叩く (HTTPS の
ページから http://localhost への fetch は仕様上許可される)。Worker や中継サーバ
を通さない素直なフロー。

---

## 2. セットアップ

### 2.1 VOICEVOX エンジンのインストール

公式サイト: <https://voicevox.hiroshiba.jp/>

macOS (Apple Silicon / Intel) / Windows / Linux 用ビルドが配布されている。GPU 版と
CPU 版があるが、章再生程度なら CPU 版で十分 (~500 MB メモリ、初回モデル展開のみ
数秒)。

#### macOS Sequoia の Gatekeeper 警告

macOS では Gatekeeper が「開発元を確認できません」と警告するケースがある。

```bash
# 方法 1: Finder で右クリック → 開く (1 回だけ)
# 方法 2: コマンドラインで quarantine 属性を外す
xattr -d com.apple.quarantine /Applications/VOICEVOX.app
```

> macOS 14 以降ではシステム設定 > プライバシーとセキュリティ から「このまま開く」
> を押す手順に変わっている。

#### 起動確認

VOICEVOX アプリを起動するとローカルでエンジンが立ち上がる。次のコマンドが返って
くれば OK。

```bash
$ curl -sf http://localhost:50021/version
"0.21.1"
```

### 2.2 web 側 (このサイトで再生する)

1. 章ページ右下のフローティング音声パネル (または音声 UI) を開く
2. **プロバイダー** ドロップダウンを `VOICEVOX（ローカル・無料）` に切替
3. **音声** ドロップダウンから話者を選ぶ
   - VOICEVOX 起動中: ずんだもん 6 スタイル + 主要キャラ + 里石ユカ が出る
   - VOICEVOX 未起動: 項目に `(未起動)` が付き **disabled**。この時パネルに
     `VOICEVOX 起動ガイド` ボタンが現れ、押すと起動手順モーダルと **再検出**
     ボタンが表示される
4. ▶ 再生 → 章を順次合成しながら再生。`Powered by VOICEVOX:キャラ名` のクレジット
   が自動表示される (VOICEVOX 利用規約準拠、§7 参照)

エンジン URL を変えたい場合 (Docker で別ポートにした等) は **設定** ダイアログの
「VOICEVOX（ずんだもん等）」セクションで `http://localhost:50021` を上書きできる。
設定値は `localStorage` (`cfd-api`) に保存される。

### 2.3 Claude Code セッションの読み上げ (CLI)

Claude Code の **Stop hook** に `~/.claude/hooks/voicevox-stop.sh` を登録すると、
アシスタント応答が完了するたびに最後の発話が自動で読み上げられる。本リポジトリの
作者環境では既に登録済み (`~/.claude/settings.json` の `hooks.Stop` 配列)。

操作は `~/.claude/hooks/vv` ヘルパー CLI でまとめて行う。`.zshrc` に alias を入れて
おくのが推奨。

```bash
# .zshrc / .bashrc
alias vv=~/.claude/hooks/vv
```

主要サブコマンド:

```bash
vv                 # = vv status (現在の config + engine 到達性 + speaker 名)
vv on              # TTS 有効化
vv off             # TTS 無効化
vv toggle          # 有効/無効を反転
vv speaker zunda   # alias で話者切替 (id でも可: vv speaker 126)
vv test            # 既定文 "テストなのだ" を合成・再生
vv test "おはよう" # 任意文で合成・再生
vv list            # engine の /speakers を表形式で表示
vv help            # ヘルプ
```

#### statusline 表示

Claude Code の statusline に「現在の話者と engine 状態」を表示できる。
`~/.claude/settings.json` に次を追加。

```json
{
  "statusLine": {
    "type": "command",
    "command": "/Users/ai/.claude/hooks/voicevox-statusline.sh"
  }
}
```

出力例:

- 🔊 ずんだもん (ノーマル)
- 🔇 OFF                ← `vv off` 状態
- 🔊 speaker:126        ← engine 落ちで名前が引けない時のフォールバック

---

## 3. ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | web 側の TTS UI と provider 実装 |
| `~/.claude/hooks/voicevox-stop.sh` | Claude Code Stop hook 本体 |
| `~/.claude/hooks/voicevox-extract.py` | transcript JSONL から最後の assistant text を抽出 + Markdown 整形 |
| `~/.claude/hooks/voicevox-apply-preset.py` | audio_query 後に話者プリセットを適用 |
| `~/.claude/hooks/voicevox-config.json` | CLI 側設定 (enabled / speaker / max_chars / engine_url) |
| `~/.claude/hooks/vv` | ユーザ向け CLI |
| `~/.claude/hooks/voicevox-statusline.sh` | Claude Code statusline 表示 |
| `docs/voicevox.md` | 本ドキュメント |

`index.html` 内の関連シンボル (行番号は変動するので grep 推奨):

- `DEFAULT_VOICEVOX_URL`
- `apiConfig.voicevoxUrl`
- `SPEAKER_PRESETS`
- `providers.voicevox`
- `voicevoxEngineState`
- `probeVoicevoxEngine`
- `populateProviderSelect`
- `updateVoicevoxGuideTrigger`
- `openVoicevoxGuideModal` / `closeVoicevoxGuideModal`
- `updateVoiceCredit`
- 設定ダイアログ内 `voicevox-url-input` / `voicevox-test-btn` / `voicevox-save-btn`

`worker-proxy.js` は **VOICEVOX には関与しない** (Grok TTS 用の Cloudflare Worker)。

---

## 4. 動作フロー

### 4.1 web 側

```
User → ▶ 再生
  → providers.voicevox.synthesize(text, { voiceId, signal })
    → POST /audio_query?text=...&speaker=...   (text → AudioQuery JSON)
    → SPEAKER_PRESETS[speaker] があれば Object.assign で override
    → POST /synthesis?speaker=...              (AudioQuery → WAV blob)
  → Audio 要素で再生 + IndexedDB にキャッシュ
```

エンジン到達性は起動直後に `probeVoicevoxEngine()` (1 秒タイムアウトで `/version`
を叩く) で判定し、`voicevoxEngineState` を `'unknown' | 'reachable' | 'unreachable'`
に設定。dropdown 表示と起動ガイド出し分けに使う。

### 4.2 Claude Code Stop hook

`voicevox-stop.sh` の流れ:

```
1. env / config から enabled / engine / speaker / max_chars を解決
   優先度: env > config file > built-in default
2. enabled=false / disable 環境変数 / stop_hook_active=True なら無音 exit 0
3. /version で engine 到達性チェック (タイムアウト 1s)。失敗なら無音 exit 0
4. detach した子プロセスで:
     a. voicevox-extract.py で transcript の最後の assistant text を抽出
        - Markdown 整形 (fenced code → "コード省略", 表行を削除, etc.)
        - max_chars で切り詰め
     b. POST /audio_query?text=...&speaker=...
     c. voicevox-apply-preset.py で AudioQuery を speaker preset で上書き
        (preset 無しならそのまま流用)
     d. POST /synthesis?speaker=...
     e. 既存 afplay を pkill -x afplay → 新しい WAV を afplay
5. hook 自体は detach 後すぐ exit 0 (Claude セッションをブロックしない)
```

新しい応答が出るたび旧再生は `pkill -x afplay` で打ち切られる。連続応答時に音声が
重ならない設計。

---

## 5. 話者プリセット (SPEAKER_PRESETS)

VOICEVOX の `/audio_query` が返す **AudioQuery JSON** には合成パラメータが詰まっており、
synthesis に渡す前にユーザ側で書き換えることでキャラの素のデフォルトを微調整できる。

### 5.1 現在のプリセット

里石ユカ (id `126`, スタイル「つぼみ」) のみ定義。ずんだもん等は **preset 無し**
(素のデフォルトをそのまま使用)。

| パラメータ | 値 | 意味 |
|---|---|---|
| `speedScale` | 1.26 | 話速倍率 (1.0 が等速) |
| `pitchScale` | -0.08 | 全体のピッチシフト (半音単位、負で低く) |
| `intonationScale` | 0.79 | 抑揚の強さ (1.0 が素、低いほど棒読み寄り) |
| `volumeScale` | 1.0 | 音量倍率 |
| `pauseLengthScale` | 1.01 | 句読点での無音長倍率 |
| `prePhonemeLength` | 0.10 | 発話前の無音 (秒) |
| `postPhonemeLength` | 0.10 | 発話後の無音 (秒) |

里石ユカは素のままだと甲高くテンポが緩い印象になるため、**やや早めで抑揚を抑え、
ピッチを少し下げる** ことで章本文の読み上げに耐える落ち着いたバランスにしている。

### 5.2 プリセットを追加する

web と CLI で同じ話者 ID なら **同じ音になる** ことを保ちたいので、両側を更新する。

**web 側** (`index.html`):

```js
const SPEAKER_PRESETS = {
  '126': { /* 里石ユカ */ },
  '<NEW_ID>': {
    speedScale: 1.0,
    pitchScale: 0.0,
    intonationScale: 1.0,
    volumeScale: 1.0,
    pauseLengthScale: 1.0,
    prePhonemeLength: 0.1,
    postPhonemeLength: 0.1,
  },
};
```

**CLI 側** (`~/.claude/hooks/voicevox-apply-preset.py`):

```python
SPEAKER_PRESETS = {
    "126": { ... },
    "<NEW_ID>": {
        "speedScale": 1.0,
        # ...
    },
}
```

両方で同じキー名・値を入れる。片方だけだと web で再生した音と Claude Code で
聞こえる音が違う事態になる (再発しやすい罠なので §9「トラブルシュート」にも記載)。

`vv list` で engine が返す全話者 ID を確認できる。

---

## 6. 設定リファレンス

### 6.1 web 側 (apiConfig)

| キー | 既定値 | 保存先 | 用途 |
|---|---|---|---|
| `voicevoxUrl` | `http://localhost:50021` | `localStorage["cfd-api"]` | エンジン URL。Docker 等で別ポートに変えた人向け |

設定ダイアログから変更可。**接続テスト** ボタンが `/version` を叩いて疎通確認する。

### 6.2 CLI 側 (`~/.claude/hooks/voicevox-config.json`)

```json
{
  "enabled": true,
  "speaker": 3,
  "max_chars": 300,
  "engine_url": "http://localhost:50021"
}
```

| キー | 型 | 既定値 | 説明 |
|---|---|---|---|
| `enabled` | bool | `true` | Stop hook で読み上げを行うか |
| `speaker` | int | `3` (ずんだもん ノーマル) | VOICEVOX speaker ID |
| `max_chars` | int | `300` | 1 応答あたりの最大文字数 (それ以降は truncate) |
| `engine_url` | string | `http://localhost:50021` | エンジン URL |

### 6.3 環境変数 (CLI 側のみ)

`voicevox-stop.sh` は env > config file > built-in default の優先度で値を解決。

| 環境変数 | 対応する config キー | 例 |
|---|---|---|
| `VOICEVOX_TTS_DISABLE` | `enabled` (`=1` で完全無効化) | `VOICEVOX_TTS_DISABLE=1` |
| `VOICEVOX_URL` | `engine_url` | `VOICEVOX_URL=http://localhost:50121` |
| `VOICEVOX_SPEAKER` | `speaker` | `VOICEVOX_SPEAKER=126` |
| `VOICEVOX_MAX_CHARS` | `max_chars` | `VOICEVOX_MAX_CHARS=600` |

env で一時的に上書きしたい時は `VOICEVOX_SPEAKER=126 claude` のように prefix する。

### 6.4 `vv` CLI のエイリアス

| エイリアス | speaker ID | 名称 (style) |
|---|---|---|
| `zunda` | 3 | ずんだもん (ノーマル) |
| `zunda-ama` | 1 | ずんだもん (あまあま) |
| `zunda-tsun` | 7 | ずんだもん (ツンツン) |
| `zunda-sexy` | 5 | ずんだもん (セクシー) |
| `zunda-whisper` | 22 | ずんだもん (ささやき) |
| `yuka` | 126 | 里石ユカ (つぼみ) — preset 適用 |

数値 ID も直接指定可: `vv speaker 38` (ずんだもん ヒソヒソ) 等。

---

## 7. 上限・コスト

| 項目 | VOICEVOX (local) | xAI Grok TTS | ブラウザ内蔵 |
|---|---|---|---|
| 価格 | **無料** | $4.20 / 1M chars | 無料 |
| 上限 | 無制限 | Shared 30 req/日 / BYOK 無制限 | 無制限 |
| ネットワーク | localhost のみ | Cloudflare Worker 経由 | 不要 (OS 内蔵) |
| 起動条件 | アプリ常駐必須 | 鍵 or 招待コード or BYOK | OS 標準 |
| メモリ | ~500 MB (CPU 版) | 0 | OS 内蔵 |
| 品質 | 高 (キャラ音声) | 高 (英寄り) | 低〜中 |
| 商用 | キャラごとに規約確認 | xAI 規約 | OS 規約 |

VOICEVOX は **無料 / 無制限 / 高品質** だが「アプリを起動し続ける」というローカル
要件があり、サイト訪問者全員に届かない。サイトに来た不特定多数にはブラウザ内蔵
TTS にフォールバックさせ、自分の手元では VOICEVOX を起動しておくのが現実解。

---

## 8. 利用規約・ライセンス

- **VOICEVOX エンジン本体**: LGPL (ソースは <https://github.com/VOICEVOX/voicevox_engine>)
- **音声ライブラリ (キャラ別)**: 個別に利用規約あり。商用可否・改変条件・クレジット
  表記必須かどうかが **キャラごとに違う**
  - 公式まとめ: <https://voicevox.hiroshiba.jp/term/>
  - 各キャラの個別ページ (例: ずんだもんは <https://zunko.jp/con_ongen_kiyaku.html>)
- **クレジット表記**: 本サイトは VOICEVOX 選択時に `Powered by VOICEVOX:キャラ名` を
  自動表示 (`updateVoiceCredit()`)
- 動画化・収益化・商用配布する場合は **必ず各キャラの規約を読む**

---

## 9. トラブルシュート

### 9.1 web で音声が出ない

| 症状 | 原因 | 対処 |
|---|---|---|
| 音声 dropdown に `(未起動)` が出て disabled | engine 未起動 | VOICEVOX アプリを起動 → `VOICEVOX 起動ガイド` ボタン → 再検出 |
| 別 provider なら鳴るが voicevox だけ無音 | engine URL がデフォルトと違う | 設定ダイアログで URL を上書き → 接続テスト |
| 接続テストで `Failed to fetch` | CORS / ポート違い | localhost:50021 を直接 curl → 通れば URL 設定ミス、通らなければ engine 死亡 |
| エラー: `VOICEVOX synthesis エラー: 422` | `speaker` が engine に存在しない | `vv list` で実在 ID を確認、または別キャラへ |

### 9.2 Claude Code で読み上げがない

| 症状 | 原因 | 対処 |
|---|---|---|
| Stop しても何も鳴らない | hook 無効 | `vv status` で `enabled=true` か確認 → `vv on` |
| `vv test` も鳴らない | engine 落ち | `curl http://localhost:50021/version` で確認 → アプリ起動 |
| 鳴るが古いキャラのまま | `vv speaker` 未実行 / config 反映漏れ | `vv status` で `speaker` 確認、`vv speaker yuka` 等で更新 |
| 連続応答で古い音と新しい音が重なる | あり得ない (`pkill -x afplay` で抑制) | 重なるなら hook が二重登録されていないか確認 |

### 9.3 パラメータが効かない (preset の罠)

新キャラを追加した・preset の値を調整したのに **片側だけ古い音**、というのは
preset の **2 箇所更新を片方忘れている** 典型例。

- web 再生で古い音 → `index.html` の `SPEAKER_PRESETS` を確認
- Claude Code で古い音 → `voicevox-apply-preset.py` の `SPEAKER_PRESETS` を確認

両方を同期してデプロイ / 再起動する。

### 9.4 `afplay` が連続で重なる (Claude Code)

意図設計上 **新しい音声が来た時に旧音を `pkill -x afplay` で殺す**。完全に止まらず
最初の数 ms が漏れることはあるが、章再生のような連続流しではなく「Stop hook の
最後の応答だけ」を読むのでこの程度で十分。

止めたい場合は手動でも `pkill -x afplay` で OK。

---

## 10. なぜローカル engine 一択か (不採用 alternative)

過去に検討して採用しなかったプロバイダ:

- **TTS Quest (廃止済み)**: 無料の VOICEVOX SaaS。手軽だが **~1 req/sec** のレート
  制限が章丸ごと再生 (数十段落) と相性が悪く、また第三者サービスの稼働継続性に
  依存することを嫌って削除。現在 provider 一覧から消してある
- **VOICEVOX 公式の Web デモ**: ブラウザに直接 embed する API は無い (ローカル
  engine 前提の設計)。CORS 経由で公的な無料エンドポイントを誰かが立てている例も
  あるが、安定運用の保証が無いため採用見送り
- **完全 Web Audio 合成 (例: meSpeak.js)**: 容量と品質のトレードオフで実用に届かない

VOICEVOX エンジンを **「localhost で各自が起動する」** 構成は、配布側のコスト 0 と
キャラ音声品質の両立が取れる現状唯一の解。

---

## 11. FAQ

**Q. VOICEVOX を起動しっぱなしじゃないとダメ?**
A. はい、現状そうです。アプリを終了すると `localhost:50021` も止まり、web では
   `(未起動)` 扱い、Claude Code では Stop hook が無音 exit します。

**Q. サイト訪問者にもずんだもんで聞いてもらえる?**
A. いいえ。訪問者の手元で VOICEVOX が起動していない限り再生できません。訪問者は
   自動的に `(未起動)` 表示になり、ブラウザ内蔵 TTS や Grok TTS にフォールバック
   できます。「自分の手元の Claude Code 環境で章本文も再生できる」という位置付け。

**Q. Docker でヘッドレス常駐したい**
A. 公式に Docker イメージあり: `voicevox/voicevox_engine:cpu-latest` (GPU 版もあり)。

```bash
docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest
```

ポートを変える場合は web 側の設定ダイアログで `voicevoxUrl` を、CLI 側で
`engine_url` (または `VOICEVOX_URL` 環境変数) を上書きする。

**Q. 商用利用したい**
A. キャラごとに利用規約が違うので **必ず各キャラの公式ページで条件を確認**。
   ずんだもんは比較的緩い (クレジット表記必須・公序良俗範囲)、他キャラは商用 NG
   や有償ライセンス必要のものも。本サイトはクレジット自動表示まではやっているが
   それ以上の責任は負わない。
   - 公式まとめ: <https://voicevox.hiroshiba.jp/term/>

**Q. ずんだもん以外でもプリセット調整したい**
A. §5.2「プリセットを追加する」を参照。`index.html` と
   `voicevox-apply-preset.py` の両方に同じキーで追加するのが鉄則。

**Q. CLI で「あれ、何のキャラだっけ」と分からなくなる**
A. `vv status` で speaker ID + engine から取得した `名前 (style)` ラベルが出る。
   statusline を有効化していれば常に画面下に表示される。

**Q. 章再生中に話者を変えたら?**
A. web 側は再生中の章を停止して新しい音声で再開する (`restartCurrentIfPlaying`)。
   IndexedDB キャッシュは話者ごとに分かれるので過去のキャッシュも残る。

**Q. プロキシ経由 (Cloudflare Worker) で VOICEVOX を中継したい**
A. 現状 web 側は localhost 直接呼び。Worker 経由構成は実装していない。利用者が
   各自エンジンを起動する前提なのでメリットが薄いと判断 (帯域・レイテンシともに
   localhost が最良)。

---

## 12. 関連ドキュメント

- [`docs/chat-ai-plan.md`](./chat-ai-plan.md) — Chat AI と TTS のレイヤ分離方針
- [`docs/roadmap.md`](./roadmap.md) — 全体ロードマップ
- 公式: <https://voicevox.hiroshiba.jp/>
- エンジン API リファレンス (起動中なら): <http://localhost:50021/docs>
