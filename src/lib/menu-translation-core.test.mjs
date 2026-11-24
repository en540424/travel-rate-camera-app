/**
 * メニューの言い回しの訳直し（menu-translation-core）のテスト。
 * 入力の訳は、実機（Build 5・Apple Translation）で表示された直訳（ライブカメラ翻訳素材のスクリーンショット）。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { polishMenuTranslation } = await import('./menu-translation-core.ts');

const enJa = (source, translated) => polishMenuTranslation(source, translated, 'en', 'ja');

test('実機で出た直訳を、メニューの言い方へ直す', async (t) => {
  const cases = [
    ['Rich and bold coffee', '濃厚で大胆なコーヒー', '濃厚でしっかりした味わいのコーヒー'],
    ['Squeezed daily', '毎日絞る', '毎日搾りたて'],
    ['Espresso with hot water', 'ホットウォーターでエスプレッソ', 'エスプレッソのお湯割り'],
    ['Espresso with steamed milk', '蒸しミルク入りエスプレッソ', 'スチームミルク入りエスプレッソ'],
    ['Espresso with steamed milk foam', '蒸しミルクフォーム入りエスプレッソ', 'スチームミルクフォーム入りエスプレッソ'],
    ['Espresso with steamed milk and foam', '蒸しミルクと泡入りのエスプレッソ', 'スチームミルクと泡入りのエスプレッソ'],
    ['Smooth espresso with milk', 'ミルク入りクリーミーエスプレッソ', 'ミルク入りまろやかなエスプレッソ'],
    ['Flaky French pastry', 'カリカリしたフランス菓子', 'サクサクのフランス菓子'],
    ['Strong black coffee', '強い黒いコーヒー', '濃いブラックコーヒー'],
  ];
  for (const [source, translated, expected] of cases) {
    await t.test(source, () => assert.equal(enJa(source, translated), expected));
  }
});

test('自然な訳・関係のない訳はそのまま', () => {
  assert.equal(enJa('Classic black tea', 'クラシックな紅茶'), 'クラシックな紅茶');
  assert.equal(enJa('Black tea with lemon and ice', 'レモンと氷入りの紅茶'), 'レモンと氷入りの紅茶');
  assert.equal(enJa('Carbonated mineral water', '炭酸ミネラルウォーター'), '炭酸ミネラルウォーター');
  assert.equal(enJa('Chilled orange juice', '冷やしたオレンジジュース'), '冷やしたオレンジジュース');
});

test('原文にその英語が無ければ直さない（原文に無い意味を足さない）', () => {
  // bold でも飲み物の文脈が無ければ「大胆」のまま（Bold design 等）
  assert.equal(enJa('Bold new design', '大胆な新デザイン'), '大胆な新デザイン');
  // 「強い」でも strong + 飲み物の文脈が無ければそのまま
  assert.equal(enJa('Strong wind warning', '強風注意報'), '強風注意報');
  assert.equal(enJa('Strong password', '強いパスワード'), '強いパスワード');
  // 訳に直訳が無ければ何もしない
  assert.equal(enJa('Rich and bold coffee', 'コクのある力強いコーヒー'), 'コクのある力強いコーヒー');
  // creamy と書いてあればクリーミーのまま
  assert.equal(enJa('Smooth and creamy latte', 'なめらかでクリーミーなラテ'), 'なめらかでクリーミーなラテ');
});

test('英語→日本語の短い行だけ（他の言語・長い段落には使わない）', () => {
  assert.equal(polishMenuTranslation('Rich and bold coffee', '濃厚で大胆なコーヒー', 'en', 'ko'), '濃厚で大胆なコーヒー');
  assert.equal(polishMenuTranslation('Rich and bold coffee', '濃厚で大胆なコーヒー', 'fr', 'ja'), '濃厚で大胆なコーヒー');
  assert.equal(polishMenuTranslation('Rich and bold coffee', '濃厚で大胆なコーヒー', 'en-US', 'ja-JP'), '濃厚でしっかりした味わいのコーヒー');
  const paragraph = `${'Our coffee is rich and bold. '.repeat(4)}`;
  assert.equal(enJa(paragraph, '私たちのコーヒーは濃厚で大胆です。'), '私たちのコーヒーは濃厚で大胆です。');
});
