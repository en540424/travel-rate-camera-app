/**
 * 専用翻訳ページの純粋ロジックのテスト。
 *
 * 実行: node --test src/lib/text-translation-core.test.mjs
 * （このプロジェクトにはjest等のテスト基盤が未導入のため、Node組み込みのtest runner
 *  （node:test）で追加依存なしに実行できるようにしている。既存の
 *  src/utils/extract-prices.test.mjs と同じ方式。.mjs拡張子はtsconfig.jsonの
 *  include対象外のため、`tsc --noEmit`のスコープにも影響しない）
 *
 * 対象モジュールがreact-native・`@/`エイリアスをimportしないことが前提。
 * import解決に失敗するようになったら、対象側に実行時importが混入した合図。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
  MAX_TRANSLATION_INPUT_LENGTH,
  clampInputLength,
  collectTranslatableLines,
  hasTranslatableInput,
  isSameLanguage,
  rejoinTranslatedLines,
  resolveInitialLanguages,
  splitTextForTranslation,
} = await import('./text-translation-core.ts');

const { getLanguageDisplayName, matchesLanguageQuery } = await import(
  '../config/translation-language-names.ts'
);

/** 実機のsupportedLanguagesを模した十分な一覧 */
const SUPPORTED = ['ar', 'de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'pt', 'ru', 'th', 'zh-Hans', 'zh-Hant'];

test('resolveInitialLanguages: 通貨hintがsupportedにあるとき採用する', async (t) => {
  await t.test('KRW由来 ko → ja', () => {
    assert.deepEqual(resolveInitialLanguages('ko', SUPPORTED), { source: 'ko', target: 'ja' });
  });
  await t.test('THB由来 th → ja', () => {
    assert.deepEqual(resolveInitialLanguages('th', SUPPORTED), { source: 'th', target: 'ja' });
  });
  await t.test('TWD由来 zh-Hant → ja', () => {
    assert.deepEqual(resolveInitialLanguages('zh-Hant', SUPPORTED), {
      source: 'zh-Hant',
      target: 'ja',
    });
  });
  await t.test('USD/GBP/EUR由来 en → ja', () => {
    assert.deepEqual(resolveInitialLanguages('en', SUPPORTED), { source: 'en', target: 'ja' });
  });
});

test('resolveInitialLanguages: hintが無い/使えないときenへフォールバックする', async (t) => {
  await t.test('JPY相当（mappingがnull）', () => {
    assert.deepEqual(resolveInitialLanguages(null, SUPPORTED), { source: 'en', target: 'ja' });
  });
  await t.test('旅行設定なし（undefined）', () => {
    assert.deepEqual(resolveInitialLanguages(undefined, SUPPORTED), { source: 'en', target: 'ja' });
  });
  await t.test('hintがsupportedに存在しない場合は採用せずenにする', () => {
    // 端末によってzh-Hantが解決されないケース。ピッカーのリストに無い値を初期値にしない
    assert.deepEqual(resolveInitialLanguages('zh-Hant', ['en', 'ja', 'ko']), {
      source: 'en',
      target: 'ja',
    });
  });
  await t.test('hintがtargetと同じ（ja）なら採用しない', () => {
    assert.deepEqual(resolveInitialLanguages('ja', SUPPORTED), { source: 'en', target: 'ja' });
  });
});

test('resolveInitialLanguages: 想定外のsupportedでも壊れない', async (t) => {
  await t.test('空配列（iOS18未満・取得失敗）でも既定値を返す', () => {
    assert.deepEqual(resolveInitialLanguages('ko', []), {
      source: DEFAULT_SOURCE_LANGUAGE,
      target: DEFAULT_TARGET_LANGUAGE,
    });
  });
  await t.test('jaが無い場合はtargetを先頭要素にする', () => {
    assert.deepEqual(resolveInitialLanguages(null, ['de', 'fr']), { source: 'fr', target: 'de' });
  });
  await t.test('enもjaも無く1言語しか無い場合でもsource!==targetを壊さずに返す', () => {
    const result = resolveInitialLanguages(null, ['de']);
    assert.equal(result.target, 'de');
    assert.equal(result.source, DEFAULT_SOURCE_LANGUAGE); // 候補が尽きたらen
  });
});

test('isSameLanguage', async (t) => {
  await t.test('同一ならtrue', () => assert.equal(isSameLanguage('ja', 'ja'), true));
  await t.test('異なればfalse', () => assert.equal(isSameLanguage('ko', 'ja'), false));
  await t.test('未初期化(null)はfalse', () => {
    assert.equal(isSameLanguage(null, 'ja'), false);
    assert.equal(isSameLanguage('ja', null), false);
  });
});

test('hasTranslatableInput', async (t) => {
  await t.test('空文字はfalse', () => assert.equal(hasTranslatableInput(''), false));
  await t.test('空白・改行のみはfalse', () => assert.equal(hasTranslatableInput('  \n\t '), false));
  await t.test('文字があればtrue', () => assert.equal(hasTranslatableInput(' 안녕 '), true));
});

test('MAX_TRANSLATION_INPUT_LENGTH 境界', async (t) => {
  await t.test('上限ちょうどは切り詰めない', () => {
    const text = 'あ'.repeat(MAX_TRANSLATION_INPUT_LENGTH);
    assert.equal(clampInputLength(text).length, MAX_TRANSLATION_INPUT_LENGTH);
    assert.equal(clampInputLength(text), text);
  });
  await t.test('上限+1は切り詰める', () => {
    const text = 'あ'.repeat(MAX_TRANSLATION_INPUT_LENGTH + 1);
    assert.equal(clampInputLength(text).length, MAX_TRANSLATION_INPUT_LENGTH);
  });
  await t.test('短い入力はそのまま', () => assert.equal(clampInputLength('abc'), 'abc'));
  await t.test('上限は安全側の値であること（未検証の5000を採用しない）', () => {
    assert.ok(MAX_TRANSLATION_INPUT_LENGTH <= 2000);
  });
});

test('行分割フォールバック: split/collect/rejoin', async (t) => {
  await t.test('空行の位置を保持する', () => {
    const lines = splitTextForTranslation('A\n\nB');
    assert.deepEqual(lines, ['A', '', 'B']);
    assert.deepEqual(collectTranslatableLines(lines), [
      { index: 0, text: 'A' },
      { index: 2, text: 'B' },
    ]);
  });
  await t.test('訳文を元の行構造へ戻す', () => {
    const lines = ['A', '', 'B'];
    const map = new Map([
      [0, 'えー'],
      [2, 'びー'],
    ]);
    assert.equal(rejoinTranslatedLines(lines, map), 'えー\n\nびー');
  });
  await t.test('訳が無い行は原文のまま残る', () => {
    const lines = ['A', 'B'];
    assert.equal(rejoinTranslatedLines(lines, new Map([[0, 'えー']])), 'えー\nB');
  });
  await t.test('連続改行・末尾改行を保持する', () => {
    const text = 'A\n\n\nB\n';
    const lines = splitTextForTranslation(text);
    assert.equal(rejoinTranslatedLines(lines, new Map()), text);
  });
  await t.test('単一行', () => {
    const lines = splitTextForTranslation('のみ');
    assert.deepEqual(lines, ['のみ']);
    assert.equal(rejoinTranslatedLines(lines, new Map([[0, 'only']])), 'only');
  });
  await t.test('全行が空白なら翻訳対象ゼロ', () => {
    assert.deepEqual(collectTranslatableLines(splitTextForTranslation('  \n\n \t')), []);
  });
});

test('getLanguageDisplayName', async (t) => {
  await t.test('既知コードは日本語名', () => {
    assert.equal(getLanguageDisplayName('ja'), '日本語');
    assert.equal(getLanguageDisplayName('ko'), '韓国語');
    assert.equal(getLanguageDisplayName('zh-Hant'), '中国語（繁体字）');
    assert.equal(getLanguageDisplayName('zh-Hans'), '中国語（簡体字）');
  });
  await t.test('Apple側の正規化後の識別子も引ける（zh-Hant→zh-TW）', () => {
    assert.equal(getLanguageDisplayName('zh-TW'), '中国語（繁体字）');
  });
  await t.test('未知コードはコードをそのまま返す（画面が壊れない）', () => {
    assert.equal(getLanguageDisplayName('xx-Unknown'), 'xx-Unknown');
    assert.equal(getLanguageDisplayName(''), '');
  });
});

test('matchesLanguageQuery: 日本語名とBCP-47コードの両方で検索できる', async (t) => {
  await t.test('空クエリは全件通す', () => assert.equal(matchesLanguageQuery('ko', '  '), true));
  await t.test('日本語名で一致', () => assert.equal(matchesLanguageQuery('ko', '韓国'), true));
  await t.test('コードで一致（大文字小文字を無視）', () => {
    assert.equal(matchesLanguageQuery('zh-Hant', 'hant'), true);
    assert.equal(matchesLanguageQuery('en', 'EN'), true);
  });
  await t.test('一致しない場合はfalse', () => assert.equal(matchesLanguageQuery('ko', 'タイ'), false));
  await t.test('未知コードでもコード自身では検索できる', () => {
    assert.equal(matchesLanguageQuery('xx-Unknown', 'unknown'), true);
  });
});
