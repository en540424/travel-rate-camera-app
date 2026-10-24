/**
 * photo-translation-core（写真翻訳の分割送信・結果反映・やり直し可否）のテスト。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  PHOTO_FIRST_CHUNK_SIZE,
  PHOTO_CHUNK_SIZE,
  PHOTO_TRANSLATION_STALL_HINT_MS,
  planPhotoTranslationChunks,
  applyPhotoChunkTranslations,
  finalizePhotoBlocks,
  countPhotoTranslationProgress,
  canRetryPhotoTranslation,
} = await import('./photo-translation-core.ts');

const block = (original, sourceLanguage = 'en') => ({
  original,
  translated: null,
  sourceLanguage,
  status: 'untranslated',
});

const phrases = (n) => Array.from({ length: n }, (_, i) => block(`Phrase ${i + 1}`));

test('既定値：最初のまとまりは小さく、2つ目以降は大きい。待機の目安は失敗扱いにしない長さ', () => {
  assert.equal(PHOTO_FIRST_CHUNK_SIZE, 2);
  assert.equal(PHOTO_CHUNK_SIZE, 6);
  assert.ok(PHOTO_TRANSLATION_STALL_HINT_MS >= 10000);
});

test('英文8件：最初の2件 → 残り6件の2回に分け、画面の上から順に送る', () => {
  const chunks = planPhotoTranslationChunks(phrases(8));
  assert.deepEqual(
    chunks.map((c) => c.texts),
    [
      ['Phrase 1', 'Phrase 2'],
      ['Phrase 3', 'Phrase 4', 'Phrase 5', 'Phrase 6', 'Phrase 7', 'Phrase 8'],
    ],
  );
  assert.ok(chunks.every((c) => c.sourceLanguage === 'en'));
});

test('多い時は6件ずつに分ける（20件 → 2 + 6 + 6 + 6）', () => {
  const sizes = planPhotoTranslationChunks(phrases(20)).map((c) => c.texts.length);
  assert.deepEqual(sizes, [2, 6, 6, 6]);
});

test('1件だけでも1回で送る／0件なら何も送らない', () => {
  assert.deepEqual(planPhotoTranslationChunks(phrases(1)).map((c) => c.texts), [['Phrase 1']]);
  assert.deepEqual(planPhotoTranslationChunks([]), []);
});

test('翻訳不要（翻訳元null）・空白だけの段落は送らない。同じ文は1回だけ送る', () => {
  const chunks = planPhotoTranslationChunks([
    block('1,200', null),
    block('Hello'),
    block('   '),
    block('Hello'),
    block('Thank you'),
    block('Exit'),
  ]);
  assert.deepEqual(chunks.map((c) => c.texts), [['Hello', 'Thank you'], ['Exit']]);
});

test('訳済み（cache由来）の段落は送らない。やり直し時は訳せなかった段落だけを送る', () => {
  const chunks = planPhotoTranslationChunks([
    { ...block('Hello'), translated: 'こんにちは', status: 'translated' },
    block('Exit'),
    block('Menu'),
  ]);
  assert.deepEqual(chunks.map((c) => c.texts), [['Exit', 'Menu']]);
});

test('翻訳元が混ざる時は、翻訳元ごとに別のまとまりにする（1回の要求は同じ翻訳元）', () => {
  const chunks = planPhotoTranslationChunks([block('Hello'), block('안녕하세요', 'ko'), block('Exit'), block('Menu')]);
  for (const chunk of chunks) {
    assert.ok(chunk.texts.length > 0);
  }
  assert.deepEqual(
    chunks.map((c) => [c.sourceLanguage, c.texts]),
    [
      ['en', ['Hello', 'Exit']],
      ['ko', ['안녕하세요']],
      ['en', ['Menu']],
    ],
  );
});

test('結果の反映：まとまりの訳文だけを入れ、他の段落・他の翻訳元・翻訳不要の段落は変えない', () => {
  const blocks = [block('Hello'), block('Exit'), block('안녕', 'ko'), block('1,200', null)];
  const next = applyPhotoChunkTranslations(blocks, 'en', new Map([['Hello', 'こんにちは']]));
  assert.deepEqual(next[0], { ...blocks[0], translated: 'こんにちは', status: 'translated' });
  assert.equal(next[1], blocks[1]);
  assert.equal(next[2], blocks[2]);
  assert.equal(next[3], blocks[3]);
  // 元の配列は変更しない
  assert.equal(blocks[0].translated, null);
});

test('結果の反映：同じ原文が2段落あれば両方に入る。訳済みの段落は上書きしない', () => {
  const blocks = [block('Hello'), { ...block('Exit'), translated: '出口', status: 'translated' }, block('Hello')];
  const next = applyPhotoChunkTranslations(blocks, 'en', new Map([['Hello', 'こんにちは'], ['Exit', '非常口']]));
  assert.equal(next[0].translated, 'こんにちは');
  assert.equal(next[1].translated, '出口');
  assert.equal(next[2].translated, 'こんにちは');
});

test('終了時：訳文の無い段落だけを失敗にする（翻訳不要の段落は失敗にしない）', () => {
  const blocks = [
    { ...block('Hello'), translated: 'こんにちは', status: 'translated' },
    block('Exit'),
    block('1,200', null),
  ];
  const done = finalizePhotoBlocks(blocks);
  assert.deepEqual(done.map((b) => b.status), ['translated', 'failed', 'untranslated']);
});

test('進捗：翻訳が必要な段落のうち訳せた数', () => {
  const blocks = [
    { ...block('Hello'), translated: 'こんにちは', status: 'translated' },
    block('Exit'),
    block('1,200', null),
  ];
  assert.deepEqual(countPhotoTranslationProgress(blocks), { translated: 1, total: 2 });
  assert.deepEqual(countPhotoTranslationProgress([]), { translated: 0, total: 0 });
});

test('やり直し：訳せなかった段落があれば出す（中断・ホスト不在・失敗・原因不明のいずれも）', () => {
  const failed = [{ ...block('Exit'), status: 'failed' }];
  for (const code of ['cancelled', 'host_unavailable', 'translation_failed', null]) {
    assert.equal(canRetryPhotoTranslation(code, failed), true, String(code));
  }
});

test('やり直し：iOS非対応・言語の組み合わせ非対応では出さない／全部訳せていれば出さない', () => {
  const failed = [{ ...block('Exit'), status: 'failed' }];
  assert.equal(canRetryPhotoTranslation('unsupported_os', failed), false);
  assert.equal(canRetryPhotoTranslation('unsupported_language', failed), false);
  const ok = [{ ...block('Exit'), translated: '出口', status: 'translated' }, block('1,200', null)];
  assert.equal(canRetryPhotoTranslation(null, ok), false);
});
