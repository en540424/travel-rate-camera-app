/**
 * extractPriceCandidates のKRW/JPY回帰テスト。
 *
 * 実行: node --test src/utils/extract-prices.test.mjs
 * （このプロジェクトにはjest等のテスト基盤が未導入のため、Node組み込みのtest runner
 *  （node:test）で追加依存なしに実行できるようにしている。.mjs拡張子はtsconfig.jsonの
 *  include対象外のため、`tsc --noEmit`のスコープにも影響しない）
 *
 * 背景1: commit 50c92c7 でKRW P4.5 / JPY P5.5（カンマ区切り整数フォールバック）に
 * HAS_ALPHA（行内に英字があれば除外）ガードが追加された結果、₩/¥記号がOCRで欠落し、
 * 同じ行に英字の商品名・キャプション（例: "PORK BAKE"）が同居するケースで、
 * 本物の価格まで誤って除外される回帰が生じていた。本テストはその回帰の固定と、
 * 元のcommitが意図した誤検出防止（kcal・SKU等）が壊れていないことの両方を確認する。
 *
 * 背景2: Release実機のOCR raw診断で、Vision OCRが桁区切りカンマをピリオドと誤認する
 * ケースが実測された（例: 4,500 → raw "4.500"）。KRW/JPY P4.7・P5.7で
 * 「1〜3桁.3桁」だけを桁区切り誤認として救済する（$3.99等の本物の小数は小数部が2桁の
 * ため区別される）。この回帰の固定と、USD/EUR/GBPの本物の小数・kcal/SKU/version番号等の
 * 誤検出防止が壊れていないことを確認する。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// dbg() が __DEV__ を参照するため、モジュール読み込み前に定義しておく
globalThis.__DEV__ = false;

const { extractPriceCandidates } = await import('./extract-prices.ts');

test('KRW: 正常価格を拾う', async (t) => {
  await t.test('₩5,000 単独', () => {
    assert.deepEqual(extractPriceCandidates('₩5,000', 'KRW'), ['5000']);
  });
  await t.test('₩4,900 単独', () => {
    assert.deepEqual(extractPriceCandidates('₩4,900', 'KRW'), ['4900']);
  });
  await t.test('₩5,000 と ₩4,900 の両方', () => {
    assert.deepEqual(extractPriceCandidates('₩5,000\n₩4,900', 'KRW'), ['5000', '4900']);
  });
  await t.test('₩記号なしの裸カンマ整数', () => {
    assert.deepEqual(extractPriceCandidates('4,900', 'KRW'), ['4900']);
  });
  await t.test('回帰ケース: 数字→英字キャプション（₩欠落）', () => {
    assert.deepEqual(extractPriceCandidates('4,900 PORK BAKE', 'KRW'), ['4900']);
  });
  await t.test('回帰ケース: 英字キャプション→数字（₩欠落）', () => {
    assert.deepEqual(extractPriceCandidates('PORK BAKE 4,900', 'KRW'), ['4900']);
  });
  await t.test('韓国語商品名→数字（₩欠落）', () => {
    assert.deepEqual(extractPriceCandidates('포크베이크 4,900', 'KRW'), ['4900']);
  });
  await t.test('数字→韓国語商品名（₩欠落）', () => {
    assert.deepEqual(extractPriceCandidates('4,900 포크베이크', 'KRW'), ['4900']);
  });
  await t.test('원 サフィックス', () => {
    assert.deepEqual(extractPriceCandidates('4,900원', 'KRW'), ['4900']);
  });
  await t.test('KRW プレフィックス', () => {
    assert.deepEqual(extractPriceCandidates('KRW 4,900', 'KRW'), ['4900']);
  });
});

test('KRW: 誤検出を拾わない（50c92c7が防いだケースを維持）', async (t) => {
  await t.test('kcal単体', () => {
    assert.deepEqual(extractPriceCandidates('2,000 kcal', 'KRW'), []);
  });
  await t.test('kcal＋韓国語文脈語', () => {
    assert.deepEqual(extractPriceCandidates('2,000 kcal 기준', 'KRW'), []);
  });
  await t.test('英字ラベル＋kcal', () => {
    assert.deepEqual(extractPriceCandidates('Protein 2,000 kcal', 'KRW'), []);
  });
  await t.test('mg単位', () => {
    assert.deepEqual(extractPriceCandidates('200 mg', 'KRW'), []);
  });
  await t.test('g単位', () => {
    assert.deepEqual(extractPriceCandidates('500 g', 'KRW'), []);
  });
  await t.test('ml単位', () => {
    assert.deepEqual(extractPriceCandidates('250 ml', 'KRW'), []);
  });
  await t.test('SKUラベル', () => {
    assert.deepEqual(extractPriceCandidates('SKU 123,456', 'KRW'), []);
  });
  await t.test('ITEM NO.ラベル', () => {
    assert.deepEqual(extractPriceCandidates('ITEM NO. 123,456', 'KRW'), []);
  });
  await t.test('時刻', () => {
    assert.deepEqual(extractPriceCandidates('12:30', 'KRW'), []);
  });
  await t.test('パーセント', () => {
    assert.deepEqual(extractPriceCandidates('20%', 'KRW'), []);
  });
  await t.test('画像サイズ表記', () => {
    assert.deepEqual(extractPriceCandidates('1920x1080', 'KRW'), []);
  });
  await t.test('ファイル名＋画像サイズ', () => {
    assert.deepEqual(extractPriceCandidates('image_1,920x1,080.jpg', 'KRW'), []);
  });
});

test('JPY: KRWと同じ回帰パターン・同じ安全ガードを共有する', async (t) => {
  await t.test('回帰ケース: 数字→英字キャプション（¥欠落）', () => {
    assert.deepEqual(extractPriceCandidates('1,980 PORK BAKE', 'JPY'), ['1980']);
  });
  await t.test('回帰ケース: 英字キャプション→数字（¥欠落）', () => {
    assert.deepEqual(extractPriceCandidates('PORK BAKE 1,980', 'JPY'), ['1980']);
  });
  await t.test('SKUラベルは引き続き拾わない', () => {
    assert.deepEqual(extractPriceCandidates('SKU 123,456', 'JPY'), []);
  });
  await t.test('ITEM NO.ラベルは引き続き拾わない', () => {
    assert.deepEqual(extractPriceCandidates('ITEM NO. 123,456', 'JPY'), []);
  });
  await t.test('kcalは引き続き拾わない', () => {
    assert.deepEqual(extractPriceCandidates('2,000 kcal', 'JPY'), []);
  });
  await t.test('通常の¥価格は維持', () => {
    assert.deepEqual(extractPriceCandidates('¥1,980', 'JPY'), ['1980']);
  });
});

test('KRW: 実機に近い複数行の組み合わせ', async (t) => {
  await t.test('商品名(別行)＋₩価格が2件、栄養情報混在', () => {
    const text = '칼조네 ₩5,000\nCALZONE\n포크베이크 ₩4,900\nPORK BAKE\n2,000 kcal 기준';
    assert.deepEqual(extractPriceCandidates(text, 'KRW').sort(), ['4900', '5000']);
  });
  await t.test('2件目の₩記号がOCRで欠落し英字キャプションと同居', () => {
    const text = '칼조네 ₩5,000\nCALZONE\n포크베이크\nPORK BAKE 4,900';
    assert.deepEqual(extractPriceCandidates(text, 'KRW').sort(), ['4900', '5000']);
  });
});

test('KRW/JPY: 桁区切りカンマのピリオド誤認を救済する（実機raw確認済み）', async (t) => {
  await t.test('KRW: 4.500 → 4500', () => {
    assert.deepEqual(extractPriceCandidates('4.500', 'KRW'), ['4500']);
  });
  await t.test('KRW: 3.200 → 3200', () => {
    assert.deepEqual(extractPriceCandidates('3.200', 'KRW'), ['3200']);
  });
  await t.test('KRW: 12.500 → 12500', () => {
    assert.deepEqual(extractPriceCandidates('12.500', 'KRW'), ['12500']);
  });
  await t.test('KRW: 桁区切り誤認＋通常カンマ整数の両方を維持', () => {
    assert.deepEqual(extractPriceCandidates('4.500\n3,500', 'KRW').sort(), ['3500', '4500']);
  });
  await t.test('KRW: 英字キャプション→桁区切り誤認（PORK BAKE 4.500）', () => {
    assert.deepEqual(extractPriceCandidates('PORK BAKE 4.500', 'KRW'), ['4500']);
  });
  await t.test('KRW: 桁区切り誤認→英字キャプション（4.500 PORK BAKE）', () => {
    assert.deepEqual(extractPriceCandidates('4.500 PORK BAKE', 'KRW'), ['4500']);
  });
  await t.test('KRW: 既存の正常経路（₩4,500）は維持', () => {
    assert.deepEqual(extractPriceCandidates('₩4,500', 'KRW'), ['4500']);
  });
  await t.test('KRW: 既存の正常経路（4,500원）は維持', () => {
    assert.deepEqual(extractPriceCandidates('4,500원', 'KRW'), ['4500']);
  });
  await t.test('KRW: 既存の正常経路（KRW 4,500）は維持', () => {
    assert.deepEqual(extractPriceCandidates('KRW 4,500', 'KRW'), ['4500']);
  });
  await t.test('JPY: 4.500 → 4500', () => {
    assert.deepEqual(extractPriceCandidates('4.500', 'JPY'), ['4500']);
  });
  await t.test('JPY: 12.500 → 12500', () => {
    assert.deepEqual(extractPriceCandidates('12.500', 'JPY'), ['12500']);
  });
  await t.test('KRW: 本物の小数(3.99)を桁区切りとして誤変換しない', () => {
    assert.deepEqual(extractPriceCandidates('3.99', 'KRW'), []);
  });
  await t.test('KRW: 本物の小数(12.50)を桁区切りとして誤変換しない', () => {
    assert.deepEqual(extractPriceCandidates('12.50', 'KRW'), []);
  });
  await t.test('KRW: 小数部1桁(1.5)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('1.5', 'KRW'), []);
  });
  await t.test('KRW: kcal(2.000 kcal)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('2.000 kcal', 'KRW'), []);
  });
  await t.test('KRW: 英字ラベル＋kcal(Protein 2.000 kcal)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('Protein 2.000 kcal', 'KRW'), []);
  });
  await t.test('KRW: 画像サイズ崩れ(1920.1080)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('1920.1080', 'KRW'), []);
  });
  await t.test('KRW: バージョン番号(version 1.234)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('version 1.234', 'KRW'), []);
  });
  await t.test('KRW: SKUラベル(SKU 12.500)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('SKU 12.500', 'KRW'), []);
  });
  await t.test('KRW: ITEM NO.ラベル(ITEM NO. 12.500)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('ITEM NO. 12.500', 'KRW'), []);
  });
  await t.test('KRW: ファイル名(image_4.500.jpg)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('image_4.500.jpg', 'KRW'), []);
  });
  await t.test('KRW: ドメイン(example.com)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('example.com', 'KRW'), []);
  });
  await t.test('KRW: 時刻(12:30)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('12:30', 'KRW'), []);
  });
  await t.test('KRW: パーセント(20%)は拾わない', () => {
    assert.deepEqual(extractPriceCandidates('20%', 'KRW'), []);
  });
  await t.test('USD: $3.99は従来どおり3.99のまま（399に誤変換しない）', () => {
    assert.deepEqual(extractPriceCandidates('$3.99', 'USD'), ['3.99']);
  });
  await t.test('EUR: €12.50は従来どおり12.50のまま（1250に誤変換しない）', () => {
    assert.deepEqual(extractPriceCandidates('€12.50', 'EUR'), ['12.50']);
  });
  await t.test('GBP: £4.99は従来どおり4.99のまま（499に誤変換しない）', () => {
    assert.deepEqual(extractPriceCandidates('£4.99', 'GBP'), ['4.99']);
  });
});

test('他通貨（THB/TWD/EUR/GBP/USD）は今回の変更対象外であること', async (t) => {
  await t.test('THB', () => {
    assert.deepEqual(extractPriceCandidates('฿120\n1,200 บาท', 'THB'), ['120', '1200']);
  });
  await t.test('TWD', () => {
    assert.deepEqual(extractPriceCandidates('NT$120\nTWD 1,200', 'TWD'), ['120', '1200']);
  });
  await t.test('EUR', () => {
    assert.deepEqual(extractPriceCandidates('€4.99\n1.234,56€', 'EUR'), ['4.99', '1234.56']);
  });
  await t.test('GBP', () => {
    assert.deepEqual(extractPriceCandidates('£4.99\n£1,299', 'GBP'), ['4.99', '1299.00']);
  });
  await t.test('USD', () => {
    assert.deepEqual(extractPriceCandidates('$4.99', 'USD'), ['4.99']);
  });
});

// 背景3（2026-10-24）: 正規表現が数字のまとまりの途中から・途中までを拾い、
// USD `$1,250.00` → 1.25 と 250.00／`$12,000` → 12.00／日付 `2026.10.24` → 10.24 と読んでいた。
// 一致の前後に桁・桁区切り・小数点が続く時はまとまり全体で読み、読めない（日付等）なら候補にしない。
test('USD: 桁区切りの金額をまとまり全体で読む（1.25・12.00に分割しない）', async (t) => {
  const cases = [
    ['$1,250.00', ['1250.00']],
    ['Total $1,250.00', ['1250.00']],
    ['$ 1,250.00', ['1250.00']],
    ['$12,000', ['12000.00']],
    ['$1,250', ['1250.00']],
    ['Tour $2,500', ['2500.00']],
    ['$9,999.99', ['9999.99']],
    ['$10,000.00', ['10000.00']],
    ['1,250.00', ['1250.00']],
  ];
  for (const [text, expected] of cases) {
    await t.test(text, () => assert.deepEqual(extractPriceCandidates(text, 'USD'), expected));
  }
});

test('USD: 日付・%・量を価格にしない', async (t) => {
  const cases = [
    '2026.10.24',
    'Date 2026.10.24',
    'Exp 10.24.2026',
    '10.24.26',
    '10/24/2026',
    '2026-10-24',
    'Open 10:30-21:00',
    '11:45 AM',
    'Tax 4.99%',
    'Water 1.50 L',
    'Milk 1.89 l',
    'Soda 12.00 fl oz',
    '555-123-4567',
    '555.123.4567',
    'version 1.2.3',
  ];
  for (const text of cases) {
    await t.test(text, () => assert.deepEqual(extractPriceCandidates(text, 'USD'), []));
  }
});

test('USD: 従来どおり読める価格は変わらない', async (t) => {
  const cases = [
    ['$12.50', ['12.50']],
    ['$3.99', ['3.99']],
    ['$ 4.99', ['4.99']],
    ['$12', ['12.00']],
    ['$12.5', ['12.50']],
    ['$5,99', ['5.99']],
    ['12.50', ['12.50']],
    ['USD 12.50', ['12.50']],
    ['Burger $12.50\nFries $4.25', ['12.50', '4.25']],
    // 日付と同じ行の価格は価格だけ残る
    ['$12.50 2026.10.24', ['12.50']],
    ['2026.10.24 Lunch 18.75', ['18.75']],
    // サイズのL（後ろに数字が続く）は量として扱わない
    ['M $5.25 L $6.00', ['5.25', '6.00']],
    ['M 10.50 L 12.50', ['10.50', '12.50']],
    // 同じ金額は1件
    ['$1,250.00\n1,250.00', ['1250.00']],
  ];
  for (const [text, expected] of cases) {
    await t.test(text, () => assert.deepEqual(extractPriceCandidates(text, 'USD'), expected));
  }
});

test('EUR/GBP: 数字のまとまりの一部だけを拾わない（同じ原因）', async (t) => {
  const cases = [
    ['EUR', '€ 1,250.00', ['1250.00']],
    ['EUR', '1,250.00 EUR', ['1250.00']],
    // 1桁＋記号＋3桁はEURでは桁区切りとも小数とも書かれるため、従来どおり小数第2位まで（1.250 € は旧 250.00）
    ['EUR', '€1.250', ['1.25']],
    ['EUR', '1.250 €', ['1.25']],
    ['EUR', '12,000 EUR', ['12000.00']],
    ['EUR', '€12,000', ['12000.00']],
    ['EUR', '€ 250.000', ['250000.00']],
    ['EUR', '€ 12.000', ['12000.00']],
    ['EUR', '€1.250,00', ['1250.00']],
    ['EUR', '1.234,56€', ['1234.56']],
    ['EUR', 'Pasta 11,80 €', ['11.80']],
    ['EUR', '€4,99\n24.10.2026', ['4.99']],
    ['EUR', '2026.10.24', []],
    ['EUR', 'Wasser 1,50 l', []],
    ['GBP', '£1,250.00', ['1250.00']],
    ['GBP', '1,250.00', ['1250.00']],
    ['GBP', '£12,000', ['12000.00']],
    ['GBP', '2026.10.24 £4.99', ['4.99']],
    ['GBP', '2026.10.24', []],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('EUR/GBP: OCR崩れの救済（空白小数・行またぎ・スラッシュ）は従来どおり', async (t) => {
  const cases = [
    ['EUR', '€ 4, 99', ['4.99']],
    ['EUR', '1 99', ['1.99']],
    ['EUR', '4.\n15', ['4.15']],
    ['EUR', '1\n99', ['1.99']],
    ['GBP', '4/99', ['4.99']],
    ['GBP', '£1,299', ['1299.00']],
    ['GBP', '1.99 GBP', ['1.99']],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${JSON.stringify(text)}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('KRW/JPY/THB/TWD: 桁区切り・日付の読みは従来どおり', async (t) => {
  const cases = [
    ['KRW', '₩12,000', ['12000']],
    ['KRW', '12,000원', ['12000']],
    ['KRW', '2026.10.24', []],
    ['JPY', '¥1,250', ['1250']],
    ['JPY', '1,250円', ['1250']],
    ['JPY', '2026.10.24', []],
    ['THB', '฿1,250.00', ['1250']],
    ['THB', '1,250 บาท', ['1250']],
    ['THB', '2026.10.24', []],
    ['TWD', 'NT$1,250', ['1250']],
    ['TWD', '$1,250.00', ['1250']],
    ['TWD', '2026.10.24', []],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

// 独立監査（2026-10-24）で見つかった、最初の修正版の後退を防ぐ
test('USD/GBP/EUR: 小数点の後ろが3桁（燃料・単価）は桁区切りにせず従来どおり小数第2位まで', async (t) => {
  const cases = [
    ['USD', '$3.999', ['3.99']],
    ['USD', 'Regular $1.459 /gal', ['1.45']],
    ['GBP', '£1.459', ['1.45']],
    ['EUR', '€1,799', ['1.79']],
    ['EUR', '€ 1, 799', ['1.79']],
    ['EUR', 'Super E10 1,859 €/l', ['1.85']],
    ['EUR', '€1.799', ['1.79']],
    ['USD', '$1,799', ['1799.00']],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('重さ付きの単価（量り売り）は従来どおり価格として残す', async (t) => {
  const cases = [
    ['USD', '4.99 lb', ['4.99']],
    ['USD', 'Bananas 0.69 lb', ['0.69']],
    ['EUR', 'Tomaten 2,99 kg', ['2.99']],
    ['GBP', '1.50 kg', ['1.50']],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('空白の抜けた価格の連結は従来どおり両方残す（まとめて捨てない）', async (t) => {
  const cases = [
    ['USD', '$10.50,12.50', ['10.50', '12.50']],
    ['USD', '$5.00,6.00', ['5.00', '6.00']],
    ['GBP', '£1.99,2.99', ['1.99']],
    ['EUR', '1,25,2,50', ['1.25', '2.50']],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('記号の後ろの桁区切りの無い長い数字は、上限を広げない（電話番号・コードの恐れ）', async (t) => {
  for (const text of ['$12345', '$123456', '$ 555123', '$1234567890']) {
    await t.test(text, () => assert.deepEqual(extractPriceCandidates(text, 'USD'), []));
  }
  await t.test('€12345', () => assert.deepEqual(extractPriceCandidates('€12345', 'EUR'), []));
  await t.test('$1234 は従来どおり', () => assert.deepEqual(extractPriceCandidates('$1234', 'USD'), ['1234.00']));
});

// 統合候補の独立監査（Fable 5.1・2026-10-24）
test('「整数部2桁＋小数点の記号＋3桁」は000の時だけ桁区切り（$12.00 1 の空白落ちを12001にしない）', async (t) => {
  const cases = [
    ['USD', '$12.001', ['12.00']],
    ['GBP', '£12.001', ['12.00']],
    ['EUR', '€12,001', ['12.00']],
    ['EUR', '€12,500', ['12.50']],
    ['USD', '$12.000', ['12000.00']],
    ['EUR', '12,000 EUR', ['12000.00']],
    ['EUR', '€12,000', ['12000.00']],
    ['EUR', '€ 12.500', ['12500.00']],
    ['USD', '$12,500', ['12500.00']],
    ['USD', 'SUBTOTAL 1,245.00\nTAX 8.875% 110.49\nTOTAL 1,355.49', ['1245.00', '110.49', '1355.49']],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${JSON.stringify(text)}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});

test('既知の残り（Productionと同じか、誤った値を出さず候補が減るだけ）を固定する', async (t) => {
  const cases = [
    // EURの「1桁＋ピリオド＋3桁」は1250ユーロとも1.25ユーロとも書かれるため従来の読み
    ['EUR', '€1.250', ['1.25']],
    // 行末のL（サイズ）は容量と見分けられず候補にしない（誤った値は出さない）
    ['USD', 'Latte 4.50 L', []],
    // ピリオドだけで連結した崩れは読めないため候補にしない
    ['USD', '12.50.13.50', []],
  ];
  for (const [currency, text, expected] of cases) {
    await t.test(`${currency} ${text}`, () => assert.deepEqual(extractPriceCandidates(text, currency), expected));
  }
});
