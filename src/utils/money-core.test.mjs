/**
 * `utils/money-core.ts` の検証（GX-04・2026-11-28）。
 * 1. 基準通貨が円の時、既存の表示・丸め（`formatJpy`・`formatForeign`・`toRecordJpy`＝Math.round）と同じ値
 * 2. 7通貨の方向付き42組すべてで、換算・逆換算・クロスレート・丸め・書式の性質が成り立つ
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const M = await import('./money-core.ts');
const F = await import('./format.ts');
const { CURRENCY_CODES, CURRENCIES } = await import('../constants/currencies.ts');
const B = await import('./budget-core.ts');
const A = await import('./analytics-core.ts');

// 既存の換算の値と同じ作り方の格子：額 i/100（0.01〜200.00）× 代表のレート（1現地通貨あたりの円）
const GRID_RATES = [150, 152.5, 175, 110, 200, 0.11, 0.0915, 4.8, 4.5, 4.37, 147.83, 161.2, 0.105, 198.7];
function* gridJpy() {
  for (const r of GRID_RATES) for (let i = 1; i <= 10000; i++) yield (i / 100) * r;
}

// 桁感だけを合わせた例（実勢レートではない。`RATE_INPUT_EXAMPLE` と同じ考え方）
const JPY_PER_UNIT = { USD: 150, KRW: 0.11, TWD: 4.8, THB: 4.5, EUR: 175, GBP: 200 };
const PAIRS = CURRENCY_CODES.flatMap((l) => CURRENCY_CODES.filter((h) => h !== l).map((h) => [l, h]));

test('方向付きの組は42', () => {
  equal(CURRENCY_CODES.length, 7);
  equal(PAIRS.length, 42);
});

test('基準通貨が円：formatMoney は既存の formatJpy と同じ表示', () => {
  for (const x of [0, 1, 1980, 1200.5, 1200.49, 999999, 0.4, 12345678.9]) {
    equal(M.formatMoney(x, 'JPY'), F.formatJpy(x), String(x));
  }
});

test('外貨：formatMoney は既存の formatForeign と同じ表示', () => {
  for (const code of CURRENCY_CODES.filter((c) => c !== 'JPY')) {
    for (const x of [0, 1, 12.99, 1250, 15000, 0.5, 1234567.891]) {
      equal(M.formatMoney(x, code), F.formatForeign(x, code), `${code} ${x}`);
    }
  }
});

test('基準通貨が円：1件の丸め・表示は既存の toRecordJpy（budget・analytics）・formatJpy と全格子で同じ', () => {
  // 監査 B1 の実例：$0.41 × 150 = 61.49999999999999 → 既存は ¥61
  equal(M.roundMoney(0.41 * 150, 'JPY'), 61);
  equal(M.formatMoney(0.41 * 150, 'JPY'), '¥61');
  let n = 0;
  for (const x of gridJpy()) {
    const a = M.roundMoney(x, 'JPY');
    if (a !== B.toRecordJpy(x) || a !== A.toRecordJpy(x) || M.formatMoney(x, 'JPY') !== F.formatJpy(x)) {
      throw new Error(`不一致 ${x}: money=${a} budget=${B.toRecordJpy(x)} format=${M.formatMoney(x, 'JPY')}/${F.formatJpy(x)}`);
    }
    n++;
  }
  equal(n, GRID_RATES.length * 10000);
  for (const x of [0, 0.4, 0.5, 1.5, 2.5, 1952.74, 1200.5, 0.49999999999999994]) equal(M.roundMoney(x, 'JPY'), Math.round(x), String(x));
});

test('基準通貨が円：合計は既存の sumBudgetTotals と同じ（監査 B1 の4件の実例を含む）', () => {
  const amounts = [0.41, 0.57, 0.69, 1.13].map((a) => a * 150);
  const rows = amounts.map((jpy_amount) => ({ jpy_amount, is_purchased: 1 }));
  equal(B.sumBudgetTotals(rows).purchasedTotalJpy, 418);
  equal(M.sumMoney(amounts, 'JPY'), 418);
  // 格子をまとめて足しても同じ
  const many = [...gridJpy()].slice(0, 50000);
  equal(M.sumMoney(many, 'JPY'), B.sumBudgetTotals(many.map((jpy_amount) => ({ jpy_amount, is_purchased: 0 }))).candidateTotalJpy);
});

test('外貨の表示は既存の formatForeign と格子で同じ（逆換算の小数を含む）', () => {
  for (const code of CURRENCY_CODES.filter((c) => c !== 'JPY')) {
    for (let i = 0; i <= 12000; i++) {
      const x = i / 1000;
      if (M.formatMoney(x, code) !== F.formatForeign(x, code)) throw new Error(`${code} ${x}`);
    }
    for (const x of [6.85 * (1 / 1370), 6.85 / 1370, 1.005, 2.675, 1.115, 1000 / 150, 1234.565]) {
      equal(M.formatMoney(x, code), F.formatForeign(x, code), `${code} ${x}`);
    }
  }
});

test('表示した各額の和＝合計（全7通貨・格子）', () => {
  for (const code of CURRENCY_CODES) {
    const xs = [];
    for (let i = 1; i <= 3000; i++) xs.push((i / 100) * GRID_RATES[i % GRID_RATES.length]);
    const shownSum = xs.reduce((s, x) => s + M.toMinorUnits(x, code), 0);
    equal(M.toMinorUnits(M.sumMoney(xs, code), code), shownSum, code);
    for (const x of xs.slice(0, 500)) equal(M.formatMoney(x, code), M.formatMoney(M.roundMoney(x, code), code));
  }
});

test('小数の通貨の丸めは最短の10進表記で四捨五入（既存の toLocaleString と同じ規則）', () => {
  equal(M.roundMoney(6.85 * (1 / 1370), 'USD'), 0); // 0.004999999999999999 → $0.00（既存の表示と同じ）
  equal(M.roundMoney(1.005, 'USD'), 1.01);
  equal(M.roundMoney(2.675, 'EUR'), 2.68);
  equal(M.roundMoney(0.125, 'GBP'), 0.13);
  equal(M.roundMoney(12.344, 'THB'), 12.34);
  equal(M.roundMoney(1499.5, 'KRW'), 1500);
  equal(M.toMinorUnits(19.99, 'USD'), 1999);
  equal(M.toMinorUnits(Number.NaN, 'USD'), 0);
  equal(M.toMinorUnits(Infinity, 'JPY'), 0);
});

test('合計は1件ずつ丸めて足す（一覧の各額の和＝合計。円は既存の規則と同じ）', () => {
  // 既存の実例：¥1,628（1627.6）＋¥324（324.14）＝¥1,952（丸めた後の和）
  equal(M.sumMoney([1627.6, 324.14], 'JPY'), 1952);
  // ドルでもセントを落とさない（0.1+0.2 の誤差を出さない）
  equal(M.sumMoney([0.1, 0.2], 'USD'), 0.3);
  equal(M.sumMoney([1.005, 1.005], 'USD'), 2.02);
  equal(M.sumMoney([], 'EUR'), 0);
});

test('通貨の違う額は足さずに通貨ごとに分ける', () => {
  deepEqual(
    M.sumByCurrency([
      { amount: 1000, currency: 'JPY' },
      { amount: 12.5, currency: 'USD' },
      { amount: 500.4, currency: 'JPY' },
      { amount: 0.255, currency: 'USD' },
    ]),
    [
      { currency: 'JPY', total: 1500 },
      { currency: 'USD', total: 12.76 },
    ],
  );
});

test('国内の判定は「現地通貨＝基準通貨」。円の旅行で基準通貨が円なら既存の国内モードと同じ', () => {
  equal(M.isDomestic('JPY', 'JPY'), true);
  equal(M.isDomestic('JPY', 'KRW'), false); // 訪日客：円の値札をウォンで見る（国内ではない）
  equal(M.isDomestic('USD', 'USD'), true);
  for (const [l, h] of PAIRS) equal(M.isDomestic(l, h), false);
});

test('42組：クロスレート・換算・逆換算の性質', () => {
  for (const [l, h] of PAIRS) {
    const r = M.crossRateFromJpyTable(l, h, JPY_PER_UNIT);
    const back = M.crossRateFromJpyTable(h, l, JPY_PER_UNIT);
    ok(M.isValidRate(r), `${l}->${h}`);
    // 逆向きのレートは逆数
    ok(Math.abs(r * back - 1) < 1e-12, `${l}->${h} 逆数`);
    ok(Math.abs(M.invertRate(r) - back) < 1e-12 * Math.max(1, back), `${l}->${h} invertRate`);
    // 往復で元の額へ戻る（丸める前の値）
    for (const a of [1, 12.34, 15000]) {
      const home = M.localToHome(a, r);
      ok(Math.abs(M.homeToLocal(home, r) - a) < 1e-9 * Math.max(1, a), `${l}->${h} 往復 ${a}`);
    }
    // 円を軸にした値と一致：1 L を H にした額 × 1 H の円 ＝ 1 L の円
    const lJpy = l === 'JPY' ? 1 : JPY_PER_UNIT[l];
    const hJpy = h === 'JPY' ? 1 : JPY_PER_UNIT[h];
    ok(Math.abs(M.localToHome(1, r) * hJpy - lJpy) < 1e-9 * Math.max(1, lJpy), `${l}->${h} 円の軸`);
    // 表示は基準通貨の桁で出る
    const shown = M.formatMoney(M.localToHome(100, r), h);
    ok(shown.startsWith(CURRENCIES[h].symbol), `${l}->${h} 記号 ${shown}`);
    const decimals = (shown.split('.')[1] ?? '').length;
    equal(decimals, CURRENCIES[h].decimals, `${l}->${h} 桁 ${shown}`);
    // 読みやすい向きのレートの数は1以上
    const d = M.describeRate(l, h, r);
    ok(d && d.value >= 1, `${l}->${h} 向き`);
  }
});

test('クロスレート：同じ通貨は1、表に無い・不正なら0（円は表に無くても1）', () => {
  equal(M.crossRateFromJpyTable('USD', 'USD', {}), 1);
  equal(M.crossRateFromJpyTable('USD', 'JPY', { USD: 150 }), 150);
  equal(M.crossRateFromJpyTable('JPY', 'USD', { USD: 150 }), 1 / 150);
  equal(M.crossRateFromJpyTable('USD', 'KRW', { USD: 150 }), 0);
  equal(M.crossRateFromJpyTable('USD', 'KRW', { USD: 150, KRW: 0 }), 0);
  equal(M.crossRateFromJpyTable('USD', 'KRW', { USD: -1, KRW: 0.11 }), 0);
});

test('レートが不正なら換算は0（既存の toJpy・fromJpy と同じ）', () => {
  for (const r of [0, -1, Number.NaN, Infinity]) {
    equal(M.localToHome(100, r), 0);
    equal(M.homeToLocal(100, r), 0);
    equal(M.invertRate(r), 0);
    equal(M.describeRate('USD', 'JPY', r), null);
  }
  equal(M.describeRate('USD', 'USD', 1), null);
});

test('レートの数値の表示：小さいレートを0や0.01にしない', () => {
  equal(M.formatRateNumber(1370.256), '1,370.26');
  equal(M.formatRateNumber(152.5), '152.5');
  equal(M.formatRateNumber(4.8), '4.8');
  equal(M.formatRateNumber(1 / 150), '0.006667');
  equal(M.formatRateNumber(0.00072993), '0.0007299');
  equal(M.formatRateNumber(0), '0');
  equal(M.formatRateNumber(0.1), '0.1');
  equal(M.formatRateNumber(0.01), '0.01');
  equal(M.formatRateNumber(1e-7), '0'); // 人が入れる値ではない
  equal(M.describeRate('USD', 'JPY', 1e-320, 'local_first'), null);
});

test('レートの向きの説明：入力した向きのまま（local_first）', () => {
  equal(M.describeRate('KRW', 'JPY', 0.11, 'local_first').text, '1 KRW = 0.11 JPY');
  equal(M.describeRate('USD', 'JPY', 152.5, 'local_first').text, '1 USD = 152.5 JPY');
});

test('極端なレートで Infinity・0 の表示を出さない', () => {
  equal(M.invertRate(5e-324), 0);
  equal(M.normalizeRateInput(5e-324, 'local_per_home'), 0);
  equal(M.crossRateFromJpyTable('USD', 'KRW', { USD: 1e308, KRW: 1e-308 }), 0);
  equal(M.describeRate('USD', 'JPY', 1e-320), null);
  ok(Number.isFinite(M.toMinorUnits(1e307, 'USD')));
  equal(M.toMinorUnits(1e-9, 'USD'), 0);
});

test('具体値：円以外どうしのクロスレート', () => {
  equal(M.crossRateFromJpyTable('USD', 'KRW', JPY_PER_UNIT), 150 / 0.11);
  equal(M.crossRateFromJpyTable('TWD', 'THB', JPY_PER_UNIT), 4.8 / 4.5);
  equal(M.formatMoney(M.localToHome(10, 150 / 0.11), 'KRW'), '₩13,636');
});

test('レートの数値の表示の境界', () => {
  equal(M.formatRateNumber(0.99995), '1'); // 有効数字4桁で 1.000
  equal(M.formatRateNumber(99.99995), '100');
  equal(M.formatRateNumber(100.005), '100.01');
  equal(M.formatRateNumber(1), '1');
  equal(M.formatRateNumber(100), '100');
});

test('レートの向きの説明：数が1以上になる向き', () => {
  equal(M.describeRate('USD', 'JPY', 150).text, '1 USD = 150 JPY');
  equal(M.describeRate('JPY', 'USD', 1 / 150).text, '1 USD = 150 JPY');
  equal(M.describeRate('KRW', 'USD', 1 / 1370).text, '1 USD = 1,370 KRW');
  equal(M.describeRate('USD', 'KRW', 1370).text, '1 USD = 1,370 KRW');
});

test('入力の向きからレートを直す（1 H = x L の入力は逆数）', () => {
  equal(M.normalizeRateInput(150, 'home_per_local'), 150);
  equal(M.normalizeRateInput(150, 'local_per_home'), 1 / 150);
  equal(M.normalizeRateInput(0, 'local_per_home'), 0);
  equal(M.normalizeRateInput(Number.NaN, 'home_per_local'), 0);
});

test('桁は通貨の定義から（JPY・KRW・TWD は0、他は2）', () => {
  deepEqual(
    Object.fromEntries(CURRENCY_CODES.map((c) => [c, M.decimalsOf(c)])),
    { USD: 2, KRW: 0, TWD: 0, THB: 2, EUR: 2, GBP: 2, JPY: 0 },
  );
});
