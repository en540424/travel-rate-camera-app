/**
 * GX-06 段階 c-3：CSV の基準通貨（設計書 `design/gx05-home-currency-design.md` §7・S8）。
 *   - 全記録の基準通貨が 'JPY'（未指定を含む）なら、今と同じ列・見出し・値（丸めと見出しの注入があっても同じ）
 *   - 'JPY' 以外を含む時だけ、見出しを注入した「換算金額」にし、右に「換算通貨」の列を足す
 *   - 国内の記録（記録の通貨＝基準通貨）は基準通貨の桁で丸め、外貨の記録は生値のまま（訪日客の JPY の記録を円として丸めない）
 */
import { deepEqual, equal, ok, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('./proplus/ts-resolve-hook.mjs', import.meta.url);
const CSV = await import('./csv-export-core.ts');
const C = await import('../utils/home-currency-core.ts');

const label = (slug) => (slug == null ? '' : `cat:${slug}`);
const HEADERS = { convertedAmount: 'H-AMOUNT', convertedCurrency: 'H-CUR' };
const FULL = { tripName: 'trip, "A"', categoryLabelOf: label, roundInHome: C.roundInHomeCurrency, multiCurrencyHeaders: HEADERS };

function row(over) {
  return {
    createdAt: '2026-11-28 10:00:00',
    entryDate: null,
    category: 'food',
    memo: '=SUM(A1)',
    isPurchased: false,
    currency: 'USD',
    foreignAmount: 10.005,
    jpyAmount: 1500.75,
    rateUsed: 150.05,
    ...over,
  };
}

const JPY_ROWS = [
  row({}),
  row({ currency: 'JPY', foreignAmount: 1200.5, jpyAmount: 1200.5, rateUsed: 1, isPurchased: true }),
  row({ currency: 'KRW', foreignAmount: 1000, jpyAmount: 110.123456, rateUsed: 0.110123456 }),
  row({ currency: 'JPY', foreignAmount: Number.NaN, jpyAmount: Infinity, rateUsed: 1 }),
  row({ currency: 'JPY', foreignAmount: -0.5, jpyAmount: 0.49999999999999994, rateUsed: 1 }),
];

test('全記録が JPY（未指定・明示）：今と同じ CSV（注入の有無にかかわらず1文字も同じ）', () => {
  const base = CSV.buildHistoryCsv(JPY_ROWS, { tripName: 'trip, "A"', categoryLabelOf: label });
  equal(CSV.buildHistoryCsv(JPY_ROWS.map((r) => ({ ...r, homeCurrency: 'JPY' })), FULL), base);
  equal(CSV.buildHistoryCsv(JPY_ROWS, FULL), base);
  ok(base.startsWith(CSV.CSV_HEADERS.join(',') + '\r\n'));
  equal(CSV.hasNonJpyHome(JPY_ROWS), false);
  equal(CSV.buildHistoryCsv([], FULL), CSV.CSV_HEADERS.join(',') + '\r\n');
});

test('CONVERTED_AMOUNT_COLUMN は見出しの「換算金額(円)」の位置', () => {
  equal(CSV.CSV_HEADERS[CSV.CONVERTED_AMOUNT_COLUMN], '換算金額(円)');
});

test("'JPY' 以外の基準通貨：見出しを置き換え・換算通貨の列を足し、国内の記録だけ基準通貨の桁で丸める", () => {
  const rows = [
    row({ homeCurrency: 'USD', currency: 'USD', foreignAmount: 12.345, jpyAmount: 12.345, rateUsed: 1 }),
    // 訪日客（基準通貨 USD・現地通貨 JPY）の記録：外貨なので生値のまま（円として丸めない）
    row({ homeCurrency: 'USD', currency: 'JPY', foreignAmount: 1500.5, jpyAmount: 10.003333333333334, rateUsed: 0.006666666666666667, isPurchased: true }),
    row({ homeCurrency: 'USD', currency: 'USD', foreignAmount: Number.NaN, jpyAmount: Infinity, rateUsed: 1 }),
    row({ homeCurrency: 'KRW', currency: 'KRW', foreignAmount: 1234.5, jpyAmount: 1234.5, rateUsed: 1 }),
    row({ homeCurrency: 'JPY', currency: 'JPY', foreignAmount: 1200.5, jpyAmount: 1200.5, rateUsed: 1 }),
    row({ homeCurrency: 'EUR', currency: 'USD', foreignAmount: 10.005, jpyAmount: 9.123456, rateUsed: 0.9118 }),
  ];
  equal(CSV.hasNonJpyHome(rows), true);
  const lines = CSV.buildHistoryCsv(rows, FULL).split('\r\n');
  const expectedHeaders = [...CSV.CSV_HEADERS];
  expectedHeaders.splice(CSV.CONVERTED_AMOUNT_COLUMN, 1, 'H-AMOUNT', 'H-CUR');
  equal(lines[0], expectedHeaders.join(','));
  const cells = lines.slice(1, -1).map((l) => l.split(',').slice(-5));
  deepEqual(cells, [
    ['USD', '12.35', '12.35', 'USD', '1'],
    ['JPY', '1500.5', '10.003333333333334', 'USD', '0.006666666666666667'],
    ['USD', '', '', 'USD', '1'],
    ['KRW', '1235', '1235', 'KRW', '1'],
    ['JPY', '1201', '1201', 'JPY', '1'],
    ['USD', '10.005', '9.123456', 'EUR', '0.9118'],
  ]);
  equal(lines.at(-1), '');
  // 文字列セルの保護（数式・区切り）は今と同じ
  ok(lines[1].includes(`"trip, ""A"""`));
  ok(lines[1].includes(`'=SUM(A1)`));
});

test("'JPY' 以外の基準通貨で丸めか見出しの注入が無い時は書き出さない（配線漏れを黙って通さない）", () => {
  const rows = [row({ homeCurrency: 'USD' })];
  const msg = /required for non-JPY home currencies/;
  throws(() => CSV.buildHistoryCsv(rows, { tripName: 't', categoryLabelOf: label }), msg);
  throws(() => CSV.buildHistoryCsv(rows, { tripName: 't', categoryLabelOf: label, roundInHome: C.roundInHomeCurrency }), msg);
  throws(() => CSV.buildHistoryCsv(rows, { tripName: 't', categoryLabelOf: label, multiCurrencyHeaders: HEADERS }), msg);
  // 円の記録が先頭で、後ろの行だけ円以外でも止める（先頭行だけ見る退行を拾う）
  throws(() => CSV.buildHistoryCsv([row({ homeCurrency: 'JPY' }), row({ homeCurrency: 'JPY' }), row({ homeCurrency: 'EUR' })], { tripName: 't', categoryLabelOf: label }), msg);
});

test('roundInHomeCurrency：基準通貨の桁で丸め、7通貨に無い値は JPY の桁', () => {
  equal(C.roundInHomeCurrency(12.345, 'USD'), 12.35);
  equal(C.roundInHomeCurrency(1.005, 'GBP'), 1.01);
  equal(C.roundInHomeCurrency(1234.5, 'TWD'), 1235);
  equal(C.roundInHomeCurrency(12.345, 'XYZ'), 12);
});

test('配線：データ管理は記録の基準通貨・丸め・辞書の見出しを渡す', () => {
  const src = readFileSync(new URL('../app/data-management.tsx', import.meta.url), 'utf8');
  ok(src.includes('homeCurrency: row.home_currency'));
  ok(src.includes('roundInHome: roundInHomeCurrency'));
  ok(src.includes("convertedAmount: t('csv.header.convertedAmount')"));
  ok(src.includes("convertedCurrency: t('csv.header.convertedCurrency')"));
});

/** RFC 4180 の1行を読む（引用符・"" のエスケープ・区切りを含むセル） */
function parseLine(line) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(cur); cur = ''; }
    else cur += ch;
  }
  cells.push(cur);
  return cells;
}

test('円以外の CSV の各行：先頭7列とレートは同じ行を円の経路で出した値と同じ（列の取り違え・escape 漏れを拾う）', () => {
  const variants = [
    { createdAt: '2026-11-01 09:00:00', entryDate: '2026-11-02', category: 'food', memo: '+cmd, "x"\nline', isPurchased: true },
    { createdAt: '2026-11-03 09:00:00', entryDate: null, category: null, memo: null, isPurchased: false },
    { createdAt: '@2026', entryDate: '-1', category: 'souvenir', memo: '\tTAB', isPurchased: true },
  ];
  const currencies = [['USD', 'USD', 3.3333], ['USD', 'JPY', 0.0066], ['EUR', 'EUR', 1], ['KRW', 'USD', 1384.25], ['JPY', 'JPY', 1]];
  const rows = [];
  for (const v of variants) {
    for (const [home, currency, rate] of currencies) {
      rows.push(row({ ...v, homeCurrency: home, currency, rateUsed: rate, foreignAmount: 12.345, jpyAmount: 41.150041 }));
    }
  }
  const opts = { ...FULL, tripName: '=trip, "B"', multiCurrencyHeaders: { convertedAmount: '=Amount, "x"', convertedCurrency: '+Cur' } };
  const multi = CSV.buildHistoryCsv(rows, opts).split('\r\n').slice(0, -1).map(parseLine);
  const single = CSV.buildHistoryCsv(rows.map((r) => ({ ...r, homeCurrency: 'JPY' })), opts).split('\r\n').slice(0, -1).map(parseLine);
  // 見出し：置き換えた2つも escape と数式の保護を通る
  deepEqual(multi[0], [...CSV.CSV_HEADERS.slice(0, 8), "'=Amount, \"x\"", "'+Cur", 'レート']);
  for (let i = 1; i < multi.length; i++) {
    equal(multi[i].length, 11);
    deepEqual(multi[i].slice(0, 7), single[i].slice(0, 7), `行 ${i}`);
    equal(multi[i][10], single[i][9], `行 ${i} のレート`);
    equal(multi[i][9], rows[i - 1].homeCurrency);
    equal(multi[i][2], "'=trip, \"B\"");
  }
  // 状態・日時・カテゴリーの具体値（円の経路と同じ値であることに加えて固定）
  deepEqual(multi[1].slice(0, 7), ['2026-11-01 09:00:00', '2026-11-02', "'=trip, \"B\"", 'cat:food', "'+cmd, \"x\"\nline", '購入済み', 'USD']);
  // 国内の記録：USD の 12.345 → 12.35（レート 3.3333 は丸めない）・外貨の記録は生値
  deepEqual(multi[1].slice(7, 11), ['12.35', '41.15', 'USD', '3.3333']);
  deepEqual(multi[2].slice(7, 11), ['12.345', '41.150041', 'USD', '0.0066']);
});

test('混在 CSV の中の基準通貨が JPY の行は今と同じ Math.round（負の .5 も 0。roundInHome で丸めない）', () => {
  const rows = [
    row({ homeCurrency: 'USD', currency: 'USD', foreignAmount: 1, jpyAmount: 1, rateUsed: 1 }),
    row({ homeCurrency: 'JPY', currency: 'JPY', foreignAmount: -0.5, jpyAmount: -2.5, rateUsed: 1 }),
  ];
  const cells = parseLine(CSV.buildHistoryCsv(rows, FULL).split('\r\n')[2]);
  deepEqual(cells.slice(7, 10), ['0', '-2', 'JPY']);
});

test('配線：CSV の組み立ての失敗は「書き出せませんでした」へ流す（未処理の Promise にしない）', () => {
  const src = readFileSync(new URL('../app/data-management.tsx', import.meta.url), 'utf8');
  ok(src.includes("result = { status: 'error' };"));
  ok(/try \{\s*const csv = withUtf8Bom\(/.test(src));
});

test('円以外の CSV でも元通貨・換算通貨のセルは escape と数式の保護を通る（壊れたコードの防御）', () => {
  const rows = [row({ homeCurrency: '=X,Y', currency: '+A"B' })];
  const cells = parseLine(CSV.buildHistoryCsv(rows, FULL).split('\r\n')[1]);
  equal(cells[6], "'+A\"B");
  equal(cells[9], "'=X,Y");
});
