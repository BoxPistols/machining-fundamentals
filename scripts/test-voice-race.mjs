// 音声 TTS の race-condition 修正に対する regression テスト。
//
// 前提バグ: モバイルで xAI 利用中、複数箇所を素早くタップすると、in-flight な
// fetch が並行して走り、両方の completion で voice.currentAudio が次々上書き
// され、両方の audio.play() が呼ばれて重複読み上げが起きていた。
// (commit 99bb98b で修正)
//
// 修正の中身:
//   1. grok.synthesize() の fetch に opts.signal を転送 (実 fetch をキャンセル)
//   2. voice.synthGeneration による generation guard
//      - jumpToChunk / stopSpeech で incr
//      - playSynthesized は開始時に myGen を捕捉、各 await 後に
//        myGen !== voice.synthGeneration なら早期 return
//
// このテストでは:
//   - generation guard の振る舞いを mock で検証 (#1〜#4)
//   - index.html に修正キーワードが残っていることを文字列検査 (#5)
//
// 実装が drift して #5 が落ちたら #1〜#4 は invalidated と疑うべし。

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// =============================================================================
// playSynthesized / jumpToChunk / stopSpeech の generation-guard 部分の抽出版。
// 本物 (index.html) と guard 順序が一致していることが必要。
// =============================================================================

function createVoice() {
  return {
    synthGeneration: 0,
    currentAudio: null,
    currentSynthAbort: null,
    playing: true,
    audiosPlayed: [], // テスト用: 実際に再生に到達した item を記録
  };
}

// jumpToChunk / stopSpeech 共通: 古い in-flight な合成を outdate させる
function bumpGeneration(voice) {
  voice.synthGeneration++;
  if (voice.currentSynthAbort) {
    try { voice.currentSynthAbort.abort(); } catch {}
    voice.currentSynthAbort = null;
  }
}

async function playSynthesized(voice, item, fakeFetch) {
  const myGen = voice.synthGeneration;
  const isStale = () => myGen !== voice.synthGeneration;

  // cacheGet 相当: ここでは常に miss
  await Promise.resolve();
  if (isStale()) return 'stale-after-cache';

  // synthesize
  const myAbort = new AbortController();
  voice.currentSynthAbort = myAbort;
  let blob;
  try {
    blob = await fakeFetch(item.text, myAbort.signal);
    if (voice.currentSynthAbort === myAbort) voice.currentSynthAbort = null;
    if (isStale()) return 'stale-after-fetch';
  } catch (e) {
    if (voice.currentSynthAbort === myAbort) voice.currentSynthAbort = null;
    if (e.name === 'AbortError' || isStale()) return 'aborted-or-stale';
    throw e;
  }

  if (isStale() || !voice.playing) return 'stale-or-stopped';

  // 実 audio の代わりに記録
  const audio = { id: item.text, blob };
  voice.currentAudio = audio;
  voice.audiosPlayed.push(audio.id);
  return 'played';
}

// =============================================================================
// テストランナー
// =============================================================================

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const tick = () => new Promise((r) => setImmediate(r));
const deferred = () => {
  let resolve, reject;
  const p = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { p, resolve, reject };
};

// ---- #1: signal が abort されれば古い fetch は AbortError で stale 終了 ----
test('signal abort で古い fetch は AbortError → 再生されない', async () => {
  const voice = createVoice();
  const dA = deferred(), dB = deferred();

  const fakeFetch = (text, signal) => {
    if (text === 'A') {
      signal.addEventListener('abort', () => {
        const e = new Error('aborted'); e.name = 'AbortError';
        dA.reject(e);
      });
      return dA.p;
    }
    return dB.p;
  };

  const pA = playSynthesized(voice, { text: 'A' }, fakeFetch);
  await tick();

  bumpGeneration(voice);
  const pB = playSynthesized(voice, { text: 'B' }, fakeFetch);

  await tick();
  dB.resolve('blob-B');

  const [resA, resB] = await Promise.all([pA, pB]);
  assert.equal(resA, 'aborted-or-stale');
  assert.equal(resB, 'played');
  assert.deepEqual(voice.audiosPlayed, ['B']);
});

// ---- #2: signal が効かなくても generation guard で再生に進まない ----
test('signal 無視で A の fetch が後から resolve しても generation guard で stale 扱い', async () => {
  const voice = createVoice();
  const dA = deferred(), dB = deferred();
  // signal を見ない fakeFetch (xAI fetch が signal 未対応だった元バグ条件の再現)
  const fakeFetch = (text) => (text === 'A' ? dA.p : dB.p);

  const pA = playSynthesized(voice, { text: 'A' }, fakeFetch);
  await tick();

  bumpGeneration(voice);
  const pB = playSynthesized(voice, { text: 'B' }, fakeFetch);
  await tick();

  // A が後から resolve (バグ条件)
  dA.resolve('blob-A');
  dB.resolve('blob-B');

  const [resA, resB] = await Promise.all([pA, pB]);
  assert.equal(resA, 'stale-after-fetch'); // ← generation guard の効果
  assert.equal(resB, 'played');
  assert.deepEqual(voice.audiosPlayed, ['B']);
  assert.equal(voice.currentAudio.id, 'B');
});

// ---- #3: 3 連タップでも最新の 1 件のみ再生される ----
test('3 連続タップで最新のみ再生 (signal 無視シナリオ)', async () => {
  const voice = createVoice();
  const dA = deferred(), dB = deferred(), dC = deferred();
  const fakeFetch = (text) => ({ A: dA.p, B: dB.p, C: dC.p })[text];

  const pA = playSynthesized(voice, { text: 'A' }, fakeFetch);
  await tick();
  bumpGeneration(voice);
  const pB = playSynthesized(voice, { text: 'B' }, fakeFetch);
  await tick();
  bumpGeneration(voice);
  const pC = playSynthesized(voice, { text: 'C' }, fakeFetch);
  await tick();

  dA.resolve('blob-A');
  dB.resolve('blob-B');
  dC.resolve('blob-C');

  const [resA, resB, resC] = await Promise.all([pA, pB, pC]);
  assert.equal(resA, 'stale-after-fetch');
  assert.equal(resB, 'stale-after-fetch');
  assert.equal(resC, 'played');
  assert.deepEqual(voice.audiosPlayed, ['C']);
});

// ---- #4: stopSpeech 相当の bump でも in-flight が再生に進まない ----
test('stopSpeech (= generation incr) で in-flight な合成は再生されない', async () => {
  const voice = createVoice();
  const dA = deferred();
  const fakeFetch = () => dA.p;

  const pA = playSynthesized(voice, { text: 'A' }, fakeFetch);
  await tick();

  bumpGeneration(voice); // stopSpeech 相当

  dA.resolve('blob-A');
  const resA = await pA;

  assert.equal(resA, 'stale-after-fetch');
  assert.deepEqual(voice.audiosPlayed, []);
  assert.equal(voice.currentAudio, null);
});

// ---- #5: 実装側 (index.html) に修正キーワードが残っていることを確認 ----
test('index.html に generation guard 実装が残っていること (refactor 検知)', async () => {
  const html = await readFile(join(REPO_ROOT, 'index.html'), 'utf8');
  const checks = [
    // voice state
    [/synthGeneration:\s*0/, 'voice.synthGeneration の初期化'],
    // jumpToChunk / stopSpeech で incr
    [/voice\.synthGeneration\+\+/g, 'voice.synthGeneration++ の呼び出し (jumpToChunk + stopSpeech 想定で 2 箇所以上)'],
    // playSynthesized 内の myGen 捕捉
    [/const\s+myGen\s*=\s*voice\.synthGeneration/, 'playSynthesized 開始時の myGen 捕捉'],
    // isStale check
    [/myGen\s*!==\s*voice\.synthGeneration/, 'playSynthesized の isStale 判定'],
    // grok.synthesize の fetch に signal
    [/signal:\s*opts\.signal/, 'grok.synthesize の fetch に signal 転送'],
    // playSynthesized から synthesize に signal
    [/signal:\s*myAbort\.signal/, 'playSynthesized から synthesize に signal 引き渡し'],
  ];
  for (const [pattern, label] of checks) {
    if (pattern.flags.includes('g')) {
      const matches = html.match(pattern) || [];
      assert.ok(matches.length >= 2, `${label} (matched ${matches.length} times, expected >= 2)`);
    } else {
      assert.match(html, pattern, label);
    }
  }
});

// =============================================================================
// 実行
// =============================================================================

let pass = 0, fail = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`✓ ${t.name}`);
    pass++;
  } catch (e) {
    console.error(`✗ ${t.name}`);
    console.error(`  ${e.stack || e.message}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
