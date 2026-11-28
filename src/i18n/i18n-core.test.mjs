/**
 * `i18n/i18n-core.ts` の検証（GX-01）。言語の解決・補間・複数形・欠けたキーの補い。
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_LANGUAGES,
  collectPreferredTags,
  createTranslator,
  decideInitialLanguage,
  formatLocaleOf,
  interpolate,
  isAppLanguage,
  placeholdersOf,
  pluralCategory,
  resolveAppLanguage,
  translate,
} from './i18n-core.ts';

test('登録表は ja・en・ko・zh-Hant の4言語', () => {
  deepEqual([...APP_LANGUAGES], ['ja', 'en', 'ko', 'zh-Hant']);
  equal(isAppLanguage('ko'), true);
  equal(isAppLanguage('th'), false);
  equal(isAppLanguage(undefined), false);
});

test('端末の言語から表示言語を決める（好みの順・地域付き・未対応は次へ）', () => {
  equal(resolveAppLanguage(['ja-JP']), 'ja');
  equal(resolveAppLanguage(['en-US', 'ja-JP']), 'en');
  equal(resolveAppLanguage(['ko-KR']), 'ko');
  equal(resolveAppLanguage(['fr-FR', 'ko-KR']), 'ko');
  equal(resolveAppLanguage(['fr-FR']), 'en'); // どれにも当たらなければ英語（海外の利用者に日本語を出さない）
  equal(resolveAppLanguage([]), 'en');
  equal(resolveAppLanguage([null, undefined, '', 'ja']), 'ja');
  equal(resolveAppLanguage(['ja_JP']), 'ja');
});

test('中国語は字体で分ける（繁体字だけ対応・簡体字は次の候補へ）', () => {
  equal(resolveAppLanguage(['zh-Hant-TW']), 'zh-Hant');
  equal(resolveAppLanguage(['zh-TW']), 'zh-Hant');
  equal(resolveAppLanguage(['zh-HK']), 'zh-Hant');
  equal(resolveAppLanguage(['zh-Hant']), 'zh-Hant');
  equal(resolveAppLanguage(['zh-Hans-CN', 'ja-JP']), 'ja');
  equal(resolveAppLanguage(['zh-CN']), 'en');
  equal(resolveAppLanguage(['zh']), 'en');
  equal(resolveAppLanguage(['zh-Hans-HK']), 'en');
});

test('書式のロケールは表示言語ごとに1つ', () => {
  deepEqual(APP_LANGUAGES.map(formatLocaleOf), ['ja-JP', 'en-US', 'ko-KR', 'zh-TW']);
});

test('補間：値で置き換え、無い名前はそのまま残す', () => {
  equal(interpolate('{a} と {b}', { a: 1, b: 'x' }), '1 と x');
  equal(interpolate('{a} と {missing}', { a: 1 }), '1 と {missing}');
  equal(interpolate('そのまま'), 'そのまま');
  equal(interpolate('{a}{a}', { a: 0 }), '00');
});

test('補間名の一覧（並べ替え・重複なし・複数形の両方を見る）', () => {
  deepEqual(placeholdersOf('{b} {a} {b}'), ['a', 'b']);
  deepEqual(placeholdersOf({ one: '{count} item', other: '{count} items for {name}' }), ['count', 'name']);
});

test('複数形：en だけ 1 が one。ja・ko・zh-Hant は常に other', () => {
  equal(pluralCategory('en', 1), 'one');
  equal(pluralCategory('en', -1), 'one');
  equal(pluralCategory('en', 0), 'other');
  equal(pluralCategory('en', 2), 'other');
  equal(pluralCategory('en', 1.5), 'other');
  for (const l of ['ja', 'ko', 'zh-Hant']) equal(pluralCategory(l, 1), 'other');
});

const DICTS = {
  ja: { a: 'あ', p: { other: '{count}件' }, onlyJa: '日本語だけ', both: 'ja' },
  en: { a: 'A', p: { one: '{count} item', other: '{count} items' }, both: 'en' },
  ko: { a: '가' },
  'zh-Hant': { a: '甲' },
};

test('訳を引く：表示言語 → 英語 → 日本語 → キー', () => {
  equal(translate(DICTS, 'ko', 'a'), '가');
  equal(translate(DICTS, 'ko', 'both'), 'en');
  equal(translate(DICTS, 'ko', 'onlyJa'), '日本語だけ');
  equal(translate(DICTS, 'ja', 'nope'), 'nope');
});

test('複数形の値は count で選ぶ（count が無ければ other）', () => {
  equal(translate(DICTS, 'en', 'p', { count: 1 }), '1 item');
  equal(translate(DICTS, 'en', 'p', { count: 3 }), '3 items');
  equal(translate(DICTS, 'en', 'p'), '{count} items');
  equal(translate(DICTS, 'ja', 'p', { count: 1 }), '1件');
  // 補った先（en）の言語の規則で語形を選ぶ
  equal(translate(DICTS, 'ko', 'p', { count: 1 }), '1 item');
});

test('createTranslator は言語を固定した関数', () => {
  const t = createTranslator(DICTS, 'zh-Hant');
  equal(t('a'), '甲');
  equal(t('both'), 'en');
});

test('起動時の言語：多言語が無効なら端末が英語でも日本語（本番の今の挙動）', () => {
  equal(decideInitialLanguage({ multilingual: false, isWeb: false, preferredTags: ['en-US'] }), 'ja');
  // Web は初回の描画を HTML と揃えて日本語（ブラウザの言語へはマウントの後）
  equal(decideInitialLanguage({ multilingual: true, isWeb: true, preferredTags: ['en-US'] }), 'ja');
  equal(decideInitialLanguage({ multilingual: true, isWeb: false, preferredTags: ['ko-KR'] }), 'ko');
});

test('端末の言語の一覧：navigator を優先し、Intl は navigator が空の時だけ', () => {
  deepEqual(collectPreferredTags({ languages: ['fr-FR'] }, 'ja-JP'), ['fr-FR']);
  equal(resolveAppLanguage(collectPreferredTags({ languages: ['zh-Hans-CN'] }, 'ja-JP')), 'en');
  deepEqual(collectPreferredTags({ language: 'ko-KR' }, 'ja-JP'), ['ko-KR']);
  deepEqual(collectPreferredTags({}, 'ja-JP'), ['ja-JP']);
  deepEqual(collectPreferredTags(undefined, undefined), []);
});

test('広東語（繁体字の地域）は繁体字', () => {
  equal(resolveAppLanguage(['yue-Hant-HK']), 'zh-Hant');
  equal(resolveAppLanguage(['yue-HK']), 'zh-Hant');
  equal(resolveAppLanguage(['yue-Hans-CN']), 'en');
});

test('辞書・補間は自分のキーだけを見る（Object の継承したプロパティを訳にしない）', () => {
  equal(interpolate('{toString}', {}), '{toString}');
  equal(translate(DICTS, 'ja', 'toString'), 'toString');
});

test('count が文字列でも数として複数形を選ぶ', () => {
  equal(translate(DICTS, 'en', 'p', { count: '1' }), '1 item');
});
