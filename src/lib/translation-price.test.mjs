/**
 * 翻訳ページ（カメラ翻訳・写真翻訳）の価格・円換算のテスト（`live-text-core.ts`の該当節）。
 *
 * 実行: npm test（node --test "src/**\/*.test.mjs"）
 * 価格抽出は本物の`extractPriceCandidates`を渡して検証する（モックで仕様をずらさないため）。
 * 守ること（2026-10-24）:
 *   1. 既存の対応通貨（USD・EUR・KRW・THB・TWD・GBP）の価格に、旅行のレートで円換算を添える
 *   2. 日付・時刻・割合・量・他の通貨の金額・数字の一部だけの読み取りでは、誤った円換算を出さない
 *   3. 商品名と価格の対応が位置から一意に決まる時だけ結び付ける
 *   4. カメラを動かして見えなくなった価格は残さない
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

// extract-prices.ts の dbg() が __DEV__ を参照するため、読み込み前に定義する
globalThis.__DEV__ = false;

const { extractPriceCandidates, extractConfidentPriceCandidates } = await import('../utils/extract-prices.ts');
const { convert } = await import('../utils/currency.ts');
const core = await import('./live-text-core.ts');

const {
  DEFAULT_TRACKER_OPTIONS,
  annotatePhotoBlockPrices,
  buildTranslationPriceEntries,
  extractTranslationPrices,
  groupLinesIntoBlocks,
  resolveTripPriceConversion,
  updateTrackedLines,
} = core;

/** 翻訳ページと同じ組み合わせ（旅行の通貨で既存の価格抽出を部分適用） */
// アプリ（LiveTranslationCamera・PhotoTranslationPanel）と同じく、確かな候補だけを渡す
const prices = (text, currency) =>
  extractTranslationPrices(text, currency, (value) => extractConfidentPriceCandidates(value, currency));
const extractorFor = (currency) => (text) => prices(text, currency);

/** 円換算の丸め（`formatJpy`と同じ`Math.round`） */
const jpy = (amount, rate) => Math.round(convert(amount, rate, 'TO_JPY'));

const line = (text, x, y, width = 0.3, height = 0.04, confidence = 1) => ({
  text,
  confidence,
  box: { x, y, width, height },
});

function trackTwice(lines, start = 1000) {
  const first = updateTrackedLines([], lines, start);
  return updateTrackedLines(first, lines, start + 900);
}

const FULL = { x: 0, y: 0, width: 1, height: 1 };
const LIVE_OPTIONS = { maxEntries: 6, maxTextLength: 80, minHits: 2, visibleRegion: FULL };

test('旅行の通貨・レート', async (t) => {
  await t.test('外貨の旅行は通貨とレートを使う', () => {
    assert.deepEqual(resolveTripPriceConversion({ base_currency: 'USD', manual_rate: 163 }), {
      currency: 'USD',
      rate: 163,
    });
  });
  await t.test('レート未設定（0・null・NaN）は0（円換算を出さず「レート未設定」）', () => {
    for (const manual_rate of [0, null, undefined, Number.NaN, -1]) {
      assert.equal(resolveTripPriceConversion({ base_currency: 'EUR', manual_rate })?.rate, 0, String(manual_rate));
    }
  });
  await t.test('国内（JPY）の旅行・旅行なしは円換算しない', () => {
    assert.equal(resolveTripPriceConversion({ base_currency: 'JPY', manual_rate: 1 }), null);
    assert.equal(resolveTripPriceConversion(null), null);
    assert.equal(resolveTripPriceConversion(undefined), null);
  });
});

test('円換算の金額（1 USD = ¥163.00の例）', () => {
  assert.equal(jpy(prices('Classic Burger $12.50', 'USD')[0], 163), 2038);
  assert.equal(jpy(prices('Caesar Salad $9.00', 'USD')[0], 163), 1467);
  assert.equal(jpy(prices('Tomato Pasta $11.80', 'USD')[0], 163), 1923);
});

test('翻訳ページで円換算する価格（USD）', async (t) => {
  await t.test('記号付き・小数2桁の価格', () => {
    assert.deepEqual(prices('Classic Burger $12.50', 'USD'), [12.5]);
    assert.deepEqual(prices('$12.50', 'USD'), [12.5]);
    assert.deepEqual(prices('Caesar Salad 9.00', 'USD'), [9]);
    assert.deepEqual(prices('2 for $5', 'USD'), [5]);
    assert.deepEqual(prices('12 oz steak 24.95', 'USD'), [24.95]);
  });
  await t.test('1行に複数の価格は出現順に全て、同じ金額は1回', () => {
    assert.deepEqual(prices('Small $4.50 / Large $6.00', 'USD'), [4.5, 6]);
    assert.deepEqual(prices('$4.50 or 4.50 to go', 'USD'), [4.5]);
  });
  await t.test('日付・時刻・割合・量は価格にしない', () => {
    for (const text of [
      '2026.10.24',
      '10.24.2026',
      'Open 10:30 - 21:00',
      'Happy hour 4:30pm',
      'Tax 4.99%',
      'Water 1.50 L',
      'Soda 0.50 l',
      'Oct 24, 2026',
      'Serves 2',
    ]) {
      assert.deepEqual(prices(text, 'USD'), [], text);
    }
  });
  await t.test('他の通貨の金額はUSDのレートで換算しない', () => {
    for (const text of ['€12.00 Pasta', 'NT$180', '¥1,200', '₩18,000', 'Pasta 12.00 EUR', '£4.99']) {
      assert.deepEqual(prices(text, 'USD'), [], text);
    }
  });
  await t.test('数字の一部だけの読み取り（"$1,250.00"→1.25）は出さない（誤った円換算より出さない）', () => {
    const result = prices('$1,250.00', 'USD');
    assert.equal(result.includes(1.25), false);
    assert.equal(result.includes(250), false);
    assert.equal(result.some((amount) => jpy(amount, 163) === 204), false);
  });
  await t.test('小数の無い桁区切り（"$1,250"・"$12,000"）も一部だけを価格にしない', () => {
    for (const [text, fragment] of [
      ['$1,250', 1.25],
      ['$12,000', 12],
      ['Tour $2,500 per person', 2.5],
    ]) {
      const result = prices(text, 'USD');
      assert.equal(result.includes(fragment), false, `${text} → ${JSON.stringify(result)}`);
      assert.ok(result.every((amount) => amount >= 1000), `${text} → ${JSON.stringify(result)}`);
    }
    const eur = prices('1.250 €', 'EUR');
    assert.ok(eur.every((amount) => amount === 1250), `1.250 € → ${JSON.stringify(eur)}`);
  });
  await t.test('サイズ表記のL・Mは量にしない（通貨記号付きの金額）', () => {
    assert.deepEqual(prices('Latte S $4.50 M $5.25 L $6.00', 'USD'), [4.5, 5.25, 6]);
    assert.deepEqual(prices('$4.50 M $5.25 L $6.00', 'USD'), [4.5, 5.25, 6]);
    assert.deepEqual(prices('Water 1.50 L', 'USD'), []);
  });
  await t.test('数字の無い文章・空文字', () => {
    assert.deepEqual(prices('Fresh salad with seasonal vegetables', 'USD'), []);
    assert.deepEqual(prices('', 'USD'), []);
  });
});

test('翻訳ページで円換算する価格（USD以外の対応通貨）', async (t) => {
  await t.test('EUR：小数カンマ・欧州の桁区切り', () => {
    assert.deepEqual(prices('Pasta 11,80 €', 'EUR'), [11.8]);
    assert.deepEqual(prices('€12.00', 'EUR'), [12]);
    assert.deepEqual(prices('1.234,56 €', 'EUR'), [1234.56]);
    assert.deepEqual(prices('Wasser 0,5 l 3,20', 'EUR'), [3.2]);
    assert.deepEqual(prices('24.10.2026', 'EUR'), []);
    assert.deepEqual(prices('$12.50', 'EUR'), []);
    assert.deepEqual(prices('£4.99', 'EUR'), []);
  });
  await t.test('KRW：整数ウォン・桁区切り', () => {
    assert.deepEqual(prices('불고기 18,000원', 'KRW'), [18000]);
    assert.deepEqual(prices('₩18,000', 'KRW'), [18000]);
    assert.deepEqual(prices('3인분 45,000', 'KRW'), [45000]);
    assert.deepEqual(prices('2026.10.24', 'KRW'), []);
    assert.deepEqual(prices('02-123-4567', 'KRW'), []);
    assert.deepEqual(prices('¥1,200', 'KRW'), []);
    assert.deepEqual(prices('$12.50', 'KRW'), []);
  });
  await t.test('THB：バーツ', () => {
    assert.deepEqual(prices('ข้าวผัด 120 บาท', 'THB'), [120]);
    assert.deepEqual(prices('฿120', 'THB'), [120]);
    // 容量（500 ml）は価格にせず、後ろの価格だけを採る
    assert.deepEqual(prices('500 ml 35', 'THB'), [35]);
    assert.deepEqual(prices('500 ml', 'THB'), []);
    assert.deepEqual(prices('$12.50', 'THB'), []);
  });
  await t.test('TWD：NT$・元・$（台湾ドルとして）', () => {
    assert.deepEqual(prices('牛肉麵 NT$180', 'TWD'), [180]);
    assert.deepEqual(prices('180元', 'TWD'), [180]);
    assert.deepEqual(prices('$180', 'TWD'), [180]);
    assert.deepEqual(prices('¥180', 'TWD'), []);
    assert.deepEqual(prices('US$12', 'TWD'), []);
  });
  await t.test('GBP：ポンド', () => {
    assert.deepEqual(prices('Fish & Chips £12.50', 'GBP'), [12.5]);
    assert.deepEqual(prices('$12.50', 'GBP'), []);
    assert.deepEqual(prices('€12.00', 'GBP'), []);
    assert.deepEqual(prices('24/10/2026', 'GBP'), []);
  });
  await t.test('円換算の金額（EUR 1 = ¥175・KRW 1 = ¥0.11）', () => {
    assert.equal(jpy(prices('Pasta 11,80 €', 'EUR')[0], 175), 2065);
    assert.equal(jpy(prices('불고기 18,000원', 'KRW')[0], 0.11), 1980);
  });
});

test('カメラ翻訳：見えている価格と商品名', async (t) => {
  await t.test('同じ行の商品名と価格（"Classic Burger $12.50"）', () => {
    const tracked = trackTwice([line('Classic Burger $12.50', 0.1, 0.4, 0.6)]);
    const entries = buildTranslationPriceEntries(tracked, extractorFor('USD'), LIVE_OPTIONS);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, 'Classic Burger');
    assert.deepEqual(entries[0].amounts, [12.5]);
  });
  await t.test('左隣の商品名（別の行として読まれたメニュー）', () => {
    const tracked = trackTwice([
      line('Classic Burger', 0.05, 0.3, 0.35),
      line('$12.50', 0.75, 0.3, 0.15),
      line('Caesar Salad', 0.05, 0.4, 0.33),
      line('$9.00', 0.75, 0.4, 0.13),
    ]);
    const entries = buildTranslationPriceEntries(tracked, extractorFor('USD'), LIVE_OPTIONS);
    const byLabel = Object.fromEntries(entries.map((entry) => [entry.label, entry.amounts]));
    assert.deepEqual(byLabel, { 'Classic Burger': [12.5], 'Caesar Salad': [9] });
  });
  await t.test('商品名が分からない価格は商品名なし（無理に結び付けない）', () => {
    const tracked = trackTwice([line('$12.50', 0.4, 0.5, 0.15)]);
    const entries = buildTranslationPriceEntries(tracked, extractorFor('USD'), LIVE_OPTIONS);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].label, null);
  });
  await t.test('日付・時刻・他の通貨の行は価格として出さない', () => {
    const tracked = trackTwice([
      line('Open 10:30 - 21:00', 0.1, 0.2, 0.5),
      line('2026.10.24', 0.1, 0.3, 0.3),
      line('Pasta €12.00', 0.1, 0.4, 0.4),
    ]);
    assert.deepEqual(buildTranslationPriceEntries(tracked, extractorFor('USD'), LIVE_OPTIONS), []);
  });
  await t.test('1フレームだけの読み取りは出さない', () => {
    const once = updateTrackedLines([], [line('Classic Burger $12.50', 0.1, 0.4, 0.6)], 1000);
    assert.deepEqual(buildTranslationPriceEntries(once, extractorFor('USD'), LIVE_OPTIONS), []);
  });
  await t.test('カメラを動かして見えなくなった価格は、追跡の保持時間を過ぎると消える', () => {
    const tracked = trackTwice([line('Classic Burger $12.50', 0.1, 0.4, 0.6)], 1000);
    // 別の場所へ向けた（前の行は見えない）
    const moved = updateTrackedLines(tracked, [line('Restroom', 0.3, 0.3)], 1900 + DEFAULT_TRACKER_OPTIONS.staleMs + 1);
    assert.deepEqual(buildTranslationPriceEntries(moved, extractorFor('USD'), LIVE_OPTIONS), []);
  });
  await t.test('プレビューに写っていない範囲の価格は出さない・件数の上限', () => {
    const lines = Array.from({ length: 10 }, (_, index) => line(`Item ${index} $${index + 1}.50`, 0.1, 0.05 + index * 0.09, 0.6));
    const tracked = trackTwice(lines);
    assert.equal(buildTranslationPriceEntries(tracked, extractorFor('USD'), LIVE_OPTIONS).length, 6);
    const region = { x: 0, y: 0, width: 1, height: 0.3 };
    const visible = buildTranslationPriceEntries(tracked, extractorFor('USD'), { ...LIVE_OPTIONS, visibleRegion: region });
    assert.ok(visible.every((entry) => entry.box.y + entry.box.height / 2 <= 0.3));
  });
});

const block = (original, x, y, width = 0.3, height = 0.03) => ({ original, box: { x, y, width, height } });

test('写真翻訳：段落ごとの価格', async (t) => {
  await t.test('「商品名 …… 価格」のメニュー：価格だけの段落を左の商品名へ結び付ける', () => {
    const blocks = [
      block('Classic Burger', 0.05, 0.2, 0.35),
      block('$12.50', 0.75, 0.2, 0.15),
      block('Caesar Salad', 0.05, 0.3, 0.33),
      block('$9.00', 0.75, 0.3, 0.13),
      block('Tomato Pasta', 0.05, 0.4, 0.33),
      block('$11.80', 0.75, 0.4, 0.15),
    ];
    const result = annotatePhotoBlockPrices(blocks, extractorFor('USD'));
    assert.deepEqual(result.map((item) => item.amounts), [[12.5], [12.5], [9], [9], [11.8], [11.8]]);
    assert.deepEqual(result.map((item) => item.mergedInto), [null, 0, null, 2, null, 4]);
    assert.deepEqual(result.map((item) => item.priceOnly), [false, true, false, true, false, true]);
  });
  await t.test('同じ行に商品名と価格がある段落はその段落に添える', () => {
    const result = annotatePhotoBlockPrices([block('Classic Burger $12.50', 0.05, 0.2, 0.8)], extractorFor('USD'));
    assert.deepEqual(result, [{ amounts: [12.5], priceOnly: false, mergedInto: null }]);
  });
  await t.test('2列のメニュー：右の列の価格を左の列の商品名へ結び付けない', () => {
    const blocks = [
      block('Burger', 0.02, 0.2, 0.15),
      block('$12.50', 0.3, 0.2, 0.1),
      block('Pasta', 0.55, 0.2, 0.15),
      block('$11.80', 0.85, 0.2, 0.1),
    ];
    const result = annotatePhotoBlockPrices(blocks, extractorFor('USD'));
    assert.equal(result[1].mergedInto, 0);
    assert.equal(result[3].mergedInto, 2);
  });
  await t.test('「商品名／価格」の値札：すぐ上の商品名が1つだけなら結び付ける', () => {
    const blocks = [block('Organic Coffee Beans', 0.2, 0.3, 0.5, 0.04), block('$14.99', 0.2, 0.35, 0.2, 0.04)];
    const result = annotatePhotoBlockPrices(blocks, extractorFor('USD'));
    assert.equal(result[1].mergedInto, 0);
    assert.deepEqual(result[0].amounts, [14.99]);
  });
  await t.test('対応が分からない価格は単独の行のまま（無理に結び付けない）', () => {
    const blocks = [
      block('Today special', 0.05, 0.1, 0.4),
      block('$12.50', 0.4, 0.6, 0.15),
      // すぐ上に候補が2つ
      block('Soup', 0.1, 0.8, 0.2),
      block('Bread', 0.25, 0.8, 0.2),
      block('$4.00', 0.15, 0.84, 0.2),
    ];
    const result = annotatePhotoBlockPrices(blocks, extractorFor('USD'));
    assert.equal(result[1].mergedInto, null);
    assert.deepEqual(result[1].amounts, [12.5]);
    assert.equal(result[4].mergedInto, null);
    assert.deepEqual(result[4].amounts, [4]);
  });
  await t.test('位置が分からない段落は結び付けない', () => {
    const result = annotatePhotoBlockPrices(
      [{ original: 'Classic Burger' }, { original: '$12.50' }],
      extractorFor('USD'),
    );
    assert.equal(result[1].mergedInto, null);
    assert.deepEqual(result[1].amounts, [12.5]);
  });
  await t.test('S/Lの複数価格は全て・重複なし、価格の無い段落は空', () => {
    const result = annotatePhotoBlockPrices(
      [block('Latte S $4.50 / L $6.00', 0.05, 0.2, 0.8), block('All drinks include free refill', 0.05, 0.3, 0.8)],
      extractorFor('USD'),
    );
    assert.deepEqual(result[0].amounts, [4.5, 6]);
    assert.deepEqual(result[1].amounts, []);
  });
  await t.test('日付・営業時間の段落には価格を添えない', () => {
    const result = annotatePhotoBlockPrices(
      [block('Open daily 10:30 - 21:00', 0.05, 0.2, 0.8), block('Menu updated 2026.10.24', 0.05, 0.3, 0.8)],
      extractorFor('USD'),
    );
    assert.deepEqual(result.map((item) => item.amounts), [[], []]);
  });
});

test('写真翻訳の段落分割：価格のある行を前後の文章とつながない', () => {
  // 横に長い行が続くメニュー（折り返しに見える配置）
  const lines = [
    line('Classic Burger with cheddar and lettuce $12.50', 0.05, 0.2, 0.8, 0.03),
    line('Caesar Salad with parmesan and croutons $9.00', 0.05, 0.235, 0.8, 0.03),
  ];
  const hasPrice = (text) => prices(text, 'USD').length > 0;
  assert.equal(groupLinesIntoBlocks(lines, hasPrice).length, 2);
});

test('曖昧な価格は、スマートカメラ・翻訳画面で円換算を出さない（アプリと同じ配線）', async (t) => {
  const { buildSmartCameraEntries } = core;
  const confident = (currency) => (text) => extractConfidentPriceCandidates(text, currency);
  for (const [currency, text] of [['EUR', '€1.250'], ['EUR', '€12,500'], ['USD', '$3.999'], ['USD', '$1,250,00'], ['EUR', '1 250,00 €']]) {
    await t.test(`${currency} ${text}`, () => {
      assert.deepEqual(prices(`Pasta ${text}`, currency), []);
      const tracked = trackTwice([line(`Pasta ${text}`, 0.2, 0.45, 0.6)]);
      assert.equal(buildSmartCameraEntries(tracked, confident(currency)).filter((e) => e.kind === 'price').length, 0);
      assert.deepEqual(buildTranslationPriceEntries(tracked, extractorFor(currency), LIVE_OPTIONS), []);
      // メインカメラ（全候補）には出る
      assert.ok(extractPriceCandidates(`Pasta ${text}`, currency).length > 0);
    });
  }
  await t.test('確かな価格は従来どおり円換算を出す', () => {
    const tracked = trackTwice([line('Pasta €12,50', 0.2, 0.45, 0.6)]);
    const entries = buildSmartCameraEntries(tracked, confident('EUR')).filter((e) => e.kind === 'price');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, 12.5);
    assert.deepEqual(prices('Pasta €12,50', 'EUR'), [12.5]);
  });
});
