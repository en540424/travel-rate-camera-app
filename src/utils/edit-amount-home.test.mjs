/**
 * GX-06 段階 c-1：記録の編集の基準通貨対応（設計書 `design/gx05-home-currency-design.md` §4・§12-1 B2・§13 SF3）。
 * 1. 基準通貨が円の記録（既存のすべて）では、初期値・判定・プレビューが切り出す前（0b040a7 の `item-edit.tsx:156,308-319`・
 *    `edit-amount-core.ts`）と `Object.is` で同じ
 * 2. SF3：初期値の関数の出力をそのまま `resolveEditedAmount` に渡すと `changed:false`（全49組・小数・逆換算の値）
 * 3. 基準通貨が円以外：訪日客の記録を国内として上書きしない・丸めは基準通貨／記録の通貨の桁
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const E = await import('./edit-amount-core.ts');
const HC = await import('./home-currency-core.ts');
const { roundMoney } = await import('./money-core.ts');
const { CURRENCY_CODES } = await import('../constants/currencies.ts');

// ── 切り出す前の式の写し（0b040a7 の item-edit.tsx の初期値・プレビューと、edit-amount-core.ts の resolveEditedAmount）
const oldInitial = (item) => (item.currency === 'JPY' ? String(Math.round(item.jpy_amount)) : String(item.foreign_amount));
function oldPreview(item, amount) {
  const isForeign = item.currency !== 'JPY';
  if (isForeign) {
    const f = parseFloat(amount);
    return isFinite(f) && f > 0 ? Math.round(f * item.rate_used) : null;
  }
  const parsed = parseFloat(amount);
  const n = isFinite(parsed) ? Math.round(parsed) : NaN;
  return isFinite(n) && n > 0 ? n : null;
}
// 0b040a7 の edit-amount-core.ts の resolveEditedAmount の写し（作業ツリーの関数を呼ぶと、円の分岐を変えた時に両側が
// 同じに変わって比較の意味が無くなるため。Fable 5.2 の監査 SF-2）
function frozenResolveEditedAmount(input) {
  const text = input.text.trim();
  if (input.currency === 'JPY') {
    const parsed = parseFloat(text);
    if (!isFinite(parsed)) return { ok: false };
    const n = Math.round(parsed);
    if (n <= 0) return { ok: false };
    if (n === Math.round(input.currentJpyAmount)) return { ok: true, changed: false };
    return { ok: true, changed: true, foreignAmount: n, jpyAmount: n };
  }
  const f = parseFloat(text);
  if (!isFinite(f) || f <= 0) return { ok: false };
  if (f === input.currentForeignAmount) return { ok: true, changed: false };
  return { ok: true, changed: true, foreignAmount: f, jpyAmount: Math.round(f * input.rateUsed) };
}
const oldResolve = (item, text) =>
  frozenResolveEditedAmount({
    currency: item.currency, text, currentForeignAmount: item.foreign_amount, currentJpyAmount: item.jpy_amount, rateUsed: item.rate_used,
  });

// ── 画面と同じ呼び方（item-edit.tsx）
const home = (item) => HC.editHomeContextFor(item);
const newInitial = (item) =>
  E.initialAmountText({ currency: item.currency, foreignAmount: item.foreign_amount, jpyAmount: item.jpy_amount, home: home(item) });
const newArgs = (item, text) => ({
  currency: item.currency, text, currentForeignAmount: item.foreign_amount, currentJpyAmount: item.jpy_amount, rateUsed: item.rate_used, home: home(item),
});
const newResolve = (item, text) => E.resolveEditedAmount(newArgs(item, text));
const newPreview = (item, text) => E.previewHomeAmount(newArgs(item, text));

const AMOUNTS = [0, -0, 0.004, 0.0038, 0.5, 1, 1.005, 2.675, 6.666666666666667, 10, 12.345, 38, 1200.4, 1200.5, 1e21, -5, NaN, Infinity];
const RATES = [0, 0.0067, 0.11, 1, 4.8, 150, 152.3, 1370.25, NaN, -1];
const TEXTS = ['', ' ', '0', '0.4', '0.5', '1', '1.005', '6.67', '6.666666666666667', '10', '10.0', '12.345', '1200', '1200.5', '01200', 'abc', '-3', 'Infinity', '1e400', ' 38 '];

function* jpyHomeItems() {
  for (const currency of CURRENCY_CODES) {
    for (const f of AMOUNTS) for (const j of AMOUNTS) for (const r of RATES) {
      for (const h of ['JPY', undefined, null, '', 'jpy', 'XYZ']) {
        yield { currency, foreign_amount: f, jpy_amount: j, rate_used: r, home_currency: h };
      }
    }
  }
}

test('基準通貨が円の記録：初期値・判定・プレビューが切り出す前と同じ（Object.is・全通貨×額×レート×入力）', () => {
  let n = 0;
  for (const item of jpyHomeItems()) {
    ok(Object.is(newInitial(item), oldInitial(item)), `初期値 ${JSON.stringify(item)}`);
    for (const text of [...TEXTS, oldInitial(item)]) {
      deepEqual(newResolve(item, text), oldResolve(item, text), `判定 ${JSON.stringify(item)} "${text}"`);
      ok(Object.is(newPreview(item, text), oldPreview(item, text)), `プレビュー ${JSON.stringify(item)} "${text}"`);
      n++;
    }
  }
  ok(n > 100000, `比べた組 ${n}`);
});

test('SF3：初期値をそのまま判定に渡すと changed:false（全49組・小数・逆換算の値・小さな額）', () => {
  const cases = [];
  for (const homeC of CURRENCY_CODES) {
    for (const local of CURRENCY_CODES) {
      for (const f of [0.0038, 0.5, 1.005, 6.666666666666667, 10, 12.345, 1200.5, 28000]) {
        for (const r of [0.0067, 0.11, 1, 4.8, 150, 1370.25]) {
          const domestic = local === homeC;
          // 円の国内の記録は整数円（>0）でしか保存されない（normalizeJpyInput）。丸めて0になる円の国内の額は
          // 今の規則（基準通貨が円の分岐＝変更していない）でも欄が「0」で不正になるので、ここでは除く
          if (homeC === 'JPY' && domestic && Math.round(f) <= 0) continue;
          const item = { currency: local, foreign_amount: f, jpy_amount: domestic ? f : f * r, rate_used: domestic ? 1 : r, home_currency: homeC };
          cases.push(item);
        }
      }
    }
  }
  // 設計書に挙がっている例（円の記録・小数の円・順方向・逆換算）
  cases.push(
    { currency: 'JPY', foreign_amount: 1200, jpy_amount: 1200, rate_used: 1, home_currency: 'JPY' },
    { currency: 'JPY', foreign_amount: 1200.5, jpy_amount: 1200.5, rate_used: 1, home_currency: 'JPY' },
    { currency: 'USD', foreign_amount: 0.41, jpy_amount: 61.49999999999999, rate_used: 150, home_currency: 'JPY' },
    { currency: 'USD', foreign_amount: 6.666666666666667, jpy_amount: 1000, rate_used: 150, home_currency: 'JPY' },
  );
  for (const item of cases) {
    const text = newInitial(item);
    const r = newResolve(item, text);
    // 丸めると 0 になる国内の額（例：0.0038 THB の国内）も、触らなければ書かない
    deepEqual(r, { ok: true, changed: false }, `${JSON.stringify(item)} 欄="${text}"`);
  }
});

test('B2：基準通貨が円以外の外貨の記録は欄を記録の通貨の桁で出す（6.666666666666667 を出さない）。円の記録は今のまま', () => {
  const rev = { currency: 'USD', foreign_amount: 6.666666666666667, jpy_amount: 1000, rate_used: 150 };
  equal(newInitial({ ...rev, home_currency: 'KRW' }), '6.67');
  equal(newInitial({ ...rev, home_currency: 'JPY' }), '6.666666666666667');
  equal(newInitial({ currency: 'KRW', foreign_amount: 1000.4, jpy_amount: 0.7, rate_used: 0.0007, home_currency: 'USD' }), '1000');
  equal(newInitial({ currency: 'USD', foreign_amount: 12.345, jpy_amount: 12.345, rate_used: 1, home_currency: 'USD' }), '12.35');
});

test('訪日客の記録（記録の通貨 JPY・基準通貨が円以外）を国内として上書きしない', () => {
  const item = { currency: 'JPY', foreign_amount: 1000, jpy_amount: 6.67, rate_used: 0.00667, home_currency: 'USD' };
  equal(newInitial(item), '1000');
  deepEqual(newResolve(item, '1000'), { ok: true, changed: false });
  // 金額を変えると、外貨（円）の額は入力のまま・基準通貨（USD）の額は記録のレートで換算して USD の桁へ
  deepEqual(newResolve(item, '1500'), { ok: true, changed: true, foreignAmount: 1500, jpyAmount: roundMoney(1500 * 0.00667, 'USD') });
  ok(newResolve(item, '1500').jpyAmount !== 1500);
  equal(newPreview(item, '1500'), roundMoney(1500 * 0.00667, 'USD')); // 浮動小数で 10.004999… → 10
  equal(newPreview(item, '1000'), 6.67);
});

test('基準通貨が円以外の国内の記録：基準通貨の桁で丸めて比べる・変更は丸めた値で foreign=jpy', () => {
  const item = { currency: 'USD', foreign_amount: 12.5, jpy_amount: 12.5, rate_used: 1, home_currency: 'USD' };
  deepEqual(newResolve(item, '12.50'), { ok: true, changed: false });
  deepEqual(newResolve(item, '12.504'), { ok: true, changed: false });
  deepEqual(newResolve(item, '12.345'), { ok: true, changed: true, foreignAmount: 12.35, jpyAmount: 12.35 });
  deepEqual(newResolve(item, '0'), { ok: false });
  deepEqual(newResolve(item, '0.004'), { ok: false });
  deepEqual(newResolve(item, ''), { ok: false });
  deepEqual(newResolve(item, 'abc'), { ok: false });
  equal(newPreview(item, '12.50'), 12.5);
  equal(newPreview(item, '13'), 13);
  equal(newPreview(item, ''), null);
  // 0桁の基準通貨（KRW）
  const krw = { currency: 'KRW', foreign_amount: 15000, jpy_amount: 15000, rate_used: 1, home_currency: 'KRW' };
  deepEqual(newResolve(krw, '15000.4'), { ok: true, changed: false });
  deepEqual(newResolve(krw, '15000.5'), { ok: true, changed: true, foreignAmount: 15001, jpyAmount: 15001 });
});

test('基準通貨が円以外の外貨の記録：不正な入力・0以下は ok:false、変更の基準通貨の額は基準通貨の桁', () => {
  const item = { currency: 'KRW', foreign_amount: 28000, jpy_amount: 20.44, rate_used: 0.00073, home_currency: 'USD' };
  for (const t of ['', ' ', 'abc', '-5', '0', 'Infinity', '1e400']) deepEqual(newResolve(item, t), { ok: false }, t);
  deepEqual(newResolve(item, '28000.4'), { ok: true, changed: false }); // KRW の桁（0桁）で同じ
  deepEqual(newResolve(item, '30000'), { ok: true, changed: true, foreignAmount: 30000, jpyAmount: roundMoney(30000 * 0.00073, 'USD') });
  equal(newPreview(item, '28000'), 20.44);
  equal(newPreview(item, 'abc'), null);
});

test('editHomeContextFor：基準通貨を正規化し、記録の通貨が壊れていても例外にしない', () => {
  equal(HC.editHomeContextFor({ currency: 'USD', home_currency: '' }).homeCurrency, 'JPY');
  equal(HC.editHomeContextFor({ currency: 'USD', home_currency: 'KRW' }).homeCurrency, 'KRW');
  const broken = HC.editHomeContextFor({ currency: 'XYZ', home_currency: 'USD' });
  equal(broken.roundLocal(1.23456), 1.23456);
  equal(broken.roundHome(1.234), 1.23);
});

test("円の基準通貨の外貨の記録：1セント未満の差も変更（丸めずに比べる・0b040a7 と同じ）", () => {
  // 外貨の未変更の判定は丸めずに比べる（円の基準通貨の記録）。38.001 は 38 と違うので変更
  deepEqual(newResolve({ currency: 'USD', foreign_amount: 38, jpy_amount: 5700, rate_used: 150, home_currency: 'JPY' }, '38.001'),
    { ok: true, changed: true, foreignAmount: 38.001, jpyAmount: Math.round(38.001 * 150) });
});

test('SF-3：変更時の外貨の額は入力のまま・基準通貨の額は入力×レートを基準通貨の桁で／未変更のプレビューは保存値を丸める', () => {
  const item = { currency: 'KRW', foreign_amount: 28000, jpy_amount: 20.4444, rate_used: 0.00073, home_currency: 'USD' };
  deepEqual(newResolve(item, '30000.4'), { ok: true, changed: true, foreignAmount: 30000.4, jpyAmount: roundMoney(30000.4 * 0.00073, 'USD') });
  equal(newPreview(item, '28000'), 20.44);
  equal(newPreview(item, '30000.4'), roundMoney(30000.4 * 0.00073, 'USD'));
  // 換算は丸める前の入力で行う（記録の通貨が2桁・基準通貨が0桁・レートが大きい組で、丸めた額で換算すると差が出る）
  const usd = { currency: 'USD', foreign_amount: 5, jpy_amount: 7500, rate_used: 1500, home_currency: 'KRW' };
  deepEqual(newResolve(usd, '6.674'), { ok: true, changed: true, foreignAmount: 6.674, jpyAmount: 10011 });
});

test('SF-1：画面（item-edit.tsx）は3か所すべてで記録の基準通貨を渡し、初期値・プレビューの式を直書きしない', () => {
  const src = readFileSync(new URL('../app/(tabs)/history/item-edit.tsx', import.meta.url), 'utf8');
  equal(src.match(/home: editHomeContextFor\(/g)?.length, 3);
  // 初期値・プレビューは画面の記録（item）、保存は保存する記録（current）をそのまま渡す
  for (const [call, row] of [['initialAmountText({', 'item'], ['previewHomeAmount({', 'item'], ['resolveEditedAmount({', 'current']]) {
    const at = src.indexOf(call);
    ok(at >= 0, call);
    const body = src.slice(at, src.indexOf('});', at));
    ok(body.includes(`home: editHomeContextFor(${row}),`), `${call} に home: editHomeContextFor(${row}) が無い`);
  }
  ok(!src.includes('String(item.foreign_amount)'), '初期値の直書き');
  ok(!/Math\.round\(f \* item\.rate_used\)/.test(src), 'プレビューの直書き');
  ok(!src.includes("item.currency === 'JPY' ? String("), '初期値の直書き');
});
