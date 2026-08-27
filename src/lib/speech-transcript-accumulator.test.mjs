/**
 * final断片の累積ロジックの純粋関数テスト。
 *
 * 実行: node --test src/lib/speech-transcript-accumulator.test.mjs
 * （既存の text-translation-core.test.mjs・speech-locales.test.mjs と同じ方式）
 *
 * iOS18の疑似final回避策により、`isFinal:true`のイベントが1回とは限らず
 * 複数回届く。Appleがtranscriptionを「累積して返す」場合と「新しい文として
 * リスタートする」場合のどちらでも全文を失わずに再構成できることを確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { EMPTY_TRANSCRIPT_ACCUMULATOR, accumulateFinalTranscript, joinTranscript } = await import(
  './speech-transcript-accumulator.ts'
);

test('accumulateFinalTranscript: 最初の断片はそのままcurrentになる', () => {
  const state = accumulateFinalTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR, 'こんにちは');
  assert.deepEqual(state, { committed: [], current: 'こんにちは' });
});

test('accumulateFinalTranscript: 延長（Appleが累積的に返すケース）はcurrentを置き換える', () => {
  let state = accumulateFinalTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR, 'こんにちは');
  // native側が区切り後に付ける先頭スペースを含めて渡ってくる想定
  state = accumulateFinalTranscript(state, ' こんにちは元気ですか');
  assert.deepEqual(state, { committed: [], current: 'こんにちは元気ですか' });

  state = accumulateFinalTranscript(state, ' こんにちは元気ですか今日はいい天気ですね');
  assert.deepEqual(state, { committed: [], current: 'こんにちは元気ですか今日はいい天気ですね' });

  assert.equal(joinTranscript(state), 'こんにちは元気ですか今日はいい天気ですね');
});

test('accumulateFinalTranscript: 区切り（Appleが新しい文としてリスタートするケース）は確定済みへ積む', () => {
  let state = accumulateFinalTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR, 'こんにちは元気ですか');
  // 新しい文の断片（前の内容を含まない）が届く
  state = accumulateFinalTranscript(state, ' 今日はいい天気ですね');
  assert.deepEqual(state, {
    committed: ['こんにちは元気ですか'],
    current: '今日はいい天気ですね',
  });

  state = accumulateFinalTranscript(state, ' 散歩に行きましょう');
  assert.deepEqual(state, {
    committed: ['こんにちは元気ですか', '今日はいい天気ですね'],
    current: '散歩に行きましょう',
  });

  assert.equal(joinTranscript(state), 'こんにちは元気ですか 今日はいい天気ですね 散歩に行きましょう');
});

test('accumulateFinalTranscript: 延長と区切りが混在しても全文を失わない', () => {
  let state = EMPTY_TRANSCRIPT_ACCUMULATOR;
  state = accumulateFinalTranscript(state, 'これは'); // 開始
  state = accumulateFinalTranscript(state, ' これはテストです'); // 延長
  state = accumulateFinalTranscript(state, ' 次の文章です'); // 区切り
  state = accumulateFinalTranscript(state, ' 次の文章ですね'); // 延長

  assert.deepEqual(state, {
    committed: ['これはテストです'],
    current: '次の文章ですね',
  });
  assert.equal(joinTranscript(state), 'これはテストです 次の文章ですね');
});

test('accumulateFinalTranscript: 空文字列の断片は無視する', () => {
  let state = accumulateFinalTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR, 'こんにちは');
  state = accumulateFinalTranscript(state, '');
  state = accumulateFinalTranscript(state, '   ');
  assert.deepEqual(state, { committed: [], current: 'こんにちは' });
});

test('accumulateFinalTranscript: 前後の空白差だけでは区切りと誤判定しない', () => {
  const state = accumulateFinalTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR, '  こんにちは  ');
  assert.deepEqual(state, { committed: [], current: 'こんにちは' });
});

test('joinTranscript: 空状態は空文字列を返す', () => {
  assert.equal(joinTranscript(EMPTY_TRANSCRIPT_ACCUMULATOR), '');
});

test('joinTranscript: 全体を書き換えない純粋関数である', () => {
  const initial = EMPTY_TRANSCRIPT_ACCUMULATOR;
  const next = accumulateFinalTranscript(initial, 'こんにちは');
  assert.deepEqual(initial, EMPTY_TRANSCRIPT_ACCUMULATOR, '入力stateを破壊していない');
  assert.notEqual(next, initial, '新しいstateを返している');
});
