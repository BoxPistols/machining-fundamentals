#!/usr/bin/env node
// 章ごとの音声 (mp3 / wav) を VOICEVOX または Grok TTS で事前生成し、
// audio/<provider>/<voiceId>/<chapterId>-<mode>.<ext> に保存する。
// 公開サイトでは index.html がこのファイルを読み、ライブ TTS より優先して再生する。
//
// 使い方の例:
//   # VOICEVOX (要 engine 起動: http://localhost:50021)
//   node scripts/generate-audio.mjs --provider voicevox --speaker 3 --chapter all
//   node scripts/generate-audio.mjs --provider voicevox --speaker 126 --chapter a1 --mode summary
//   node scripts/generate-audio.mjs --provider voicevox --speaker 3 --chapter 1 --mode full --source out/ch1.txt
//
//   # Grok (Cloudflare Worker 経由)
//   GROK_API_KEY=xai-... node scripts/generate-audio.mjs \
//     --provider grok --voice ara --proxy-url https://xxx.workers.dev --chapter all
//
// 引数:
//   --provider voicevox|grok        TTS エンジン (必須)
//   --chapter <id>|all              章 ID (a1, 1, c1, ...) または all
//   --mode summary|full             summary は voiceSummary を使用 (既定)。
//                                   full は --source <file> が必要
//   --speaker <id>                  VOICEVOX speaker id (既定 3 = ずんだもんノーマル)
//   --voice <id>                    Grok voice id (ara/eve/leo/rex/sal、既定 ara)
//   --engine-url <url>              VOICEVOX engine URL (既定 http://localhost:50021)
//   --proxy-url <url>               Grok プロキシ URL (env GROK_PROXY_URL も可)
//   --api-key <key>                 Grok API key (env GROK_API_KEY も可)
//   --proxy-secret <s>              Grok プロキシ合言葉 (env GROK_PROXY_SECRET も可)
//   --source <file>                 任意のテキストファイル (full モードでは必須)
//   --out <dir>                     出力先ルート (既定 audio/)
//   --no-mp3                        ffmpeg があっても WAV のままにする (VOICEVOX のみ)
//   --bitrate <kbps>                MP3 ビットレート (既定 64)
//   --force                         既存ファイルを上書き (既定はスキップ)
//
// 生成後、audio/manifest.json に登録される。

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = path.join(ROOT, 'index.html');

// SPEAKER_PRESETS は index.html を Single Source of Truth として動的に読み出す。
// 以前は本ファイルにも複製を持っていたが、index.html 側を更新し忘れる drift 事故が
// 起きやすかったため、parse 経由で 1 ヶ所管理に集約した。
let SPEAKER_PRESETS = {};

async function loadSpeakerPresets() {
  const src = await fs.readFile(INDEX_HTML, 'utf8');
  const start = src.indexOf('const SPEAKER_PRESETS = {');
  if (start < 0) {
    console.warn('[warn] index.html: const SPEAKER_PRESETS が見つかりません。プリセット未適用で続行');
    return {};
  }
  // 対応する閉じ } を見つける (素朴な depth 解析)
  let depth = 0;
  let i = start + 'const SPEAKER_PRESETS = '.length;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const literal = src.slice(start + 'const SPEAKER_PRESETS = '.length, i + 1);
  // Function constructor で安全に評価 (closure 不可、純粋なオブジェクトリテラルのみ想定)
  try {
    return Function('"use strict"; return ' + literal)();
  } catch (e) {
    console.warn('[warn] SPEAKER_PRESETS の parse 失敗:', e.message, '— プリセット未適用で続行');
    return {};
  }
}

// ---- arg parsing -----------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  process.stdout.write(await fs.readFile(fileURLToPath(import.meta.url), 'utf8')
    .then(s => s.split('\n').slice(1, 35).map(l => l.replace(/^\/\/ ?/, '')).join('\n')));
  process.exit(0);
}

const provider = args.provider;
if (!provider || (provider !== 'voicevox' && provider !== 'grok')) {
  console.error('--provider voicevox|grok を指定してください');
  process.exit(1);
}

const mode = args.mode || 'summary';
if (mode !== 'summary' && mode !== 'full') {
  console.error('--mode は summary または full');
  process.exit(1);
}

const chapterArg = args.chapter || 'all';
const speaker = String(args.speaker || '3');
const grokVoice = String(args.voice || 'ara');
const engineUrl = (args['engine-url'] || 'http://localhost:50021').replace(/\/+$/, '');
const proxyUrl = (args['proxy-url'] || process.env.GROK_PROXY_URL || '').replace(/\/+$/, '');
const apiKey = args['api-key'] || process.env.GROK_API_KEY || '';
const proxySecret = args['proxy-secret'] || process.env.GROK_PROXY_SECRET || '';
const outRoot = args.out || 'audio';
const force = !!args.force;
const noMp3 = !!args['no-mp3'];
const bitrate = String(args.bitrate || '64');

// ---- chapter discovery -----------------------------------------------------
// index.html を読み、各章の id と voiceSummary を取り出す。
// 構造: const CHAPTERS = [ { id: '...', ..., voiceSummary: '...', ... }, ... ]
//   - id は string ('a1') または number (1)
//   - voiceSummary は **単一行のシングルクォート文字列**（複数行や template literal は非対応）
//   - 直前に出てきた id と次に出てくる voiceSummary をペアにする
//   - シングルクォート内に \' エスケープがあれば許容
//
// 制約: voiceSummary を複数行化したい場合は、本パーサもアップデート必要。
// 末尾の整合性チェックで id 件数と voiceSummary 件数の差を検出して警告する。
async function loadChapters() {
  const src = await fs.readFile(INDEX_HTML, 'utf8');
  const start = src.indexOf('const CHAPTERS = [');
  if (start < 0) throw new Error('index.html: const CHAPTERS = [ が見つかりません');
  // 対応する閉じ括弧を見つける (素朴にトップレベルの ]; を探す)
  let depth = 0;
  let i = start + 'const CHAPTERS = '.length;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
  }
  const block = src.slice(start, i + 1);
  const lines = block.split('\n');

  // 整合性チェック用: 4 スペースインデントの id: 出現数を先に数える (期待件数)
  const idLineRe = /^\s{4}id:\s+(?:'[^']+'|\d+),\s*$/;
  const expectedIdCount = lines.filter(l => idLineRe.test(l)).length;

  const chapters = [];
  let pendingId = null;
  let pendingNum = null;
  let pendingTitle = null;
  for (const line of lines) {
    const idMatch = line.match(/^\s{4}id:\s+(?:'([^']+)'|(\d+)),\s*$/);
    if (idMatch) {
      pendingId = idMatch[1] || idMatch[2];
      pendingNum = null;
      pendingTitle = null;
      continue;
    }
    const numMatch = line.match(/^\s{4}num:\s+'([^']+)',\s*$/);
    if (numMatch && pendingId !== null) {
      pendingNum = numMatch[1];
      continue;
    }
    const titleMatch = line.match(/^\s{4}title:\s+'([^']+)',\s*$/);
    if (titleMatch && pendingId !== null) {
      pendingTitle = titleMatch[1];
      continue;
    }
    // voiceSummary: '...'  ← \' エスケープ許容、複数行は非対応
    const summaryMatch = line.match(/^\s{4}voiceSummary:\s+'((?:\\.|[^'])*)',\s*$/);
    if (summaryMatch && pendingId !== null) {
      // エスケープ \' を ' に戻す
      const text = summaryMatch[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      chapters.push({
        id: pendingId,
        num: pendingNum || pendingId,
        title: pendingTitle || '',
        voiceSummary: text,
      });
      pendingId = null;
      pendingNum = null;
      pendingTitle = null;
    }
  }
  // 整合性チェック: 期待される章数と実際にパースできた件数を突合
  if (chapters.length !== expectedIdCount) {
    console.warn(
      `[warn] CHAPTERS パース不整合: id 件数 ${expectedIdCount} vs voiceSummary 取得済 ${chapters.length}。` +
      `voiceSummary が複数行化された章があるか、シングルクォート以外で書かれている可能性。` +
      `現状 voiceSummary が単一行・シングルクォート (\\' エスケープ可) のみサポート。`
    );
  }
  return chapters;
}

// ---- text normalization (matches index.html の normalizeForSpeech) --------
function normalizeForSpeech(text) {
  if (!text) return '';
  let t = text.replace(/<pre[\s\S]*?<\/pre>/gi, ' コード省略。 ');
  t = t.replace(/<code[^>]*>[\s\S]*?<\/code>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
       .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/・/g, '、');
  t = t.replace(/＝|=/g, 'イコール');
  t = t.replace(/→/g, '、');
  t = t.replace(/〜|～/g, 'から');
  t = t.replace(/★/g, '');
  return t;
}

// ---- VOICEVOX synthesis ---------------------------------------------------
async function synthVoicevox(text, speakerId) {
  const queryRes = await fetch(
    `${engineUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${encodeURIComponent(speakerId)}`,
    { method: 'POST' },
  );
  if (!queryRes.ok) throw new Error(`audio_query: HTTP ${queryRes.status}`);
  const query = await queryRes.json();
  const preset = SPEAKER_PRESETS[String(speakerId)];
  if (preset) Object.assign(query, preset);
  const synthRes = await fetch(
    `${engineUrl}/synthesis?speaker=${encodeURIComponent(speakerId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'audio/wav' },
      body: JSON.stringify(query),
    },
  );
  if (!synthRes.ok) throw new Error(`synthesis: HTTP ${synthRes.status}`);
  return Buffer.from(await synthRes.arrayBuffer());
}

// ---- Grok synthesis -------------------------------------------------------
async function synthGrok(text, voiceId) {
  if (!proxyUrl) throw new Error('--proxy-url または GROK_PROXY_URL が必要');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  if (proxySecret) headers['X-Proxy-Secret'] = proxySecret;
  const res = await fetch(`${proxyUrl}/v1/tts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      voice_id: voiceId,
      language: 'ja',
      output_format: { codec: 'mp3', sample_rate: 24000, bit_rate: 128000 },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Grok TTS: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---- ffmpeg WAV → MP3 -----------------------------------------------------
async function hasFfmpeg() {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
}

async function wavToMp3(wavPath, mp3Path) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', [
      '-y', '-i', wavPath,
      '-vn', '-ac', '1', '-b:a', `${bitrate}k`,
      mp3Path,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-300)}`));
    });
  });
}

// ---- manifest -------------------------------------------------------------
async function loadManifest() {
  const p = path.join(ROOT, outRoot, 'manifest.json');
  try {
    const s = await fs.readFile(p, 'utf8');
    const obj = JSON.parse(s);
    if (!obj.files) obj.files = {};
    return obj;
  } catch {
    return { version: 1, files: {} };
  }
}

async function saveManifest(m) {
  const p = path.join(ROOT, outRoot, 'manifest.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8');
}

// ---- main -----------------------------------------------------------------
async function main() {
  // SPEAKER_PRESETS を index.html から動的ロード (drift 防止のため SOT 化)
  SPEAKER_PRESETS = await loadSpeakerPresets();
  const allChapters = await loadChapters();
  const targets = chapterArg === 'all'
    ? allChapters
    : allChapters.filter(c => c.id === chapterArg);

  if (targets.length === 0) {
    console.error(`章 "${chapterArg}" が見つかりません。利用可能: ${allChapters.map(c => c.id).join(', ')}`);
    process.exit(1);
  }

  // full モードで --chapter all は --source の指定方法が無いので拒否
  if (mode === 'full' && chapterArg === 'all' && !args.source) {
    console.error('full モード + --chapter all は未対応 (章ごとに --source を渡す必要あり)。\n  個別に --chapter <id> --source <file> で実行してください。');
    process.exit(1);
  }

  let sourceText = null;
  if (args.source) {
    sourceText = await fs.readFile(args.source, 'utf8');
  }
  if (mode === 'full' && !sourceText) {
    console.error('--mode full は --source <file> が必要です (export ダイアログから保存した .txt 等)');
    process.exit(1);
  }

  const useFfmpeg = provider === 'voicevox' && !noMp3 && await hasFfmpeg();
  if (provider === 'voicevox' && !noMp3 && !useFfmpeg) {
    console.warn('[warn] ffmpeg が見つかりません。WAV のまま保存します (--no-mp3 で警告抑止)');
  }

  const manifest = await loadManifest();
  const voiceId = provider === 'voicevox' ? speaker : grokVoice;
  const ext = provider === 'voicevox' ? (useFfmpeg ? 'mp3' : 'wav') : 'mp3';

  for (const ch of targets) {
    const text = mode === 'full'
      ? sourceText.trim()
      : normalizeForSpeech(ch.voiceSummary);
    if (!text) {
      console.warn(`[skip] ${ch.id}: テキストが空`);
      continue;
    }

    const relDir = path.join(outRoot, provider, voiceId);
    const relFile = path.join(relDir, `${ch.id}-${mode}.${ext}`);
    const absFile = path.join(ROOT, relFile);
    const absDir = path.join(ROOT, relDir);

    if (!force) {
      try {
        await fs.access(absFile);
        console.log(`[skip] ${relFile} (既存。--force で上書き)`);
        continue;
      } catch {}
    }

    await fs.mkdir(absDir, { recursive: true });
    console.log(`[gen ] ${relFile} (${text.length} 文字)`);

    let buf;
    if (provider === 'voicevox') {
      buf = await synthVoicevox(text, speaker);
    } else {
      buf = await synthGrok(text, grokVoice);
    }

    if (provider === 'voicevox' && useFfmpeg) {
      const tmpWav = absFile.replace(/\.mp3$/, '.tmp.wav');
      await fs.writeFile(tmpWav, buf);
      try {
        await wavToMp3(tmpWav, absFile);
      } finally {
        await fs.unlink(tmpWav).catch(() => {});
      }
    } else {
      await fs.writeFile(absFile, buf);
    }

    const stat = await fs.stat(absFile);
    if (!manifest.files[ch.id]) manifest.files[ch.id] = {};
    if (!manifest.files[ch.id][mode]) manifest.files[ch.id][mode] = {};
    manifest.files[ch.id][mode][`${provider}:${voiceId}`] = {
      path: relFile.split(path.sep).join('/'),
      size: stat.size,
      ext,
      generated: new Date().toISOString(),
    };
    await saveManifest(manifest);
    console.log(`       → ${(stat.size / 1024).toFixed(1)} KB`);
  }

  console.log('done');
}

main().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
