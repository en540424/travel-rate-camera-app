/**
 * GX-06 段階 c-2（Fable SF2）：`trip-stats.ts` の `getTripStatsForDisplay` を native・Web の両方で実際に実行する。
 * `react-native` は `Platform.OS` だけを持つ差し替えにし、Web の localStorage は Map で置き換える。
 *   - native：hook の合計をそのまま使い、第4引数（旅行の基準通貨）が小数なら残り予算を最小単位で引く
 *   - Web：localStorage の記録と旅行から、旅行の基準通貨の桁で合計し、残り予算も同じ桁で引く（渡された第4引数は使わない）
 *   - 基準通貨が0桁の旅行・旅行が選ばれていない時は変更前の式と Object.is で同じ
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

const RN_STUB = 'data:text/javascript,' + encodeURIComponent(
  'export const Platform = { get OS() { return globalThis.__TEST_PLATFORM_OS ?? "ios"; } };',
);
register(
  'data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, n) { if (s === 'react-native') return { url: ${JSON.stringify(RN_STUB)}, shortCircuit: true }; return n(s, c); }`,
  ),
);
register('../lib/proplus/ts-resolve-hook.mjs', import.meta.url);

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const S = await import('./trip-stats.ts');
const B = await import('./budget-core.ts');
const M = await import('./money-core.ts');

function setWeb(history, trips) {
  store.set('travelrate:history', JSON.stringify(history));
  store.set('travelrate:trips', JSON.stringify(trips));
}

const HISTORY = [
  { id: 1, trip_id: 1, currency: 'USD', jpy_amount: 1500.5, is_purchased: 1 },
  { id: 2, trip_id: 1, currency: 'USD', jpy_amount: 0.49999999999999994, is_purchased: 0 },
  { id: 3, trip_id: 2, currency: 'EUR', jpy_amount: 1.005, is_purchased: 1 },
  { id: 4, trip_id: 2, currency: 'EUR', jpy_amount: 2.675, is_purchased: 1 },
  { id: 5, trip_id: 2, currency: 'EUR', jpy_amount: 0.1, is_purchased: 0 },
  { id: 6, trip_id: 2, currency: 'EUR', jpy_amount: 0.2, is_purchased: 0 },
  { id: 7, trip_id: null, currency: 'USD', jpy_amount: 99.995, is_purchased: 1 },
];
const TRIPS = [
  { id: 1, target_currency: 'JPY' },
  { id: 2, target_currency: 'USD' },
];

test('native：第4引数が小数の基準通貨なら残り予算を最小単位で引く・円と未指定は今の式のまま', () => {
  globalThis.__TEST_PLATFORM_OS = 'ios';
  const totals = { candidateCount: 1, candidateTotalJpy: 0.3, purchasedCount: 2, purchasedTotalJpy: 333.05 };
  equal(S.getTripStatsForDisplay(totals, 1000.15, 2, 'USD').remainingBudget, 667.1);
  for (const home of ['JPY', 'KRW', undefined, 'usd']) {
    ok(Object.is(S.getTripStatsForDisplay(totals, 1000.15, 2, home).remainingBudget, Math.max(0, 1000.15 - 333.05)), String(home));
  }
  // hook の合計はそのまま通す（native は localStorage を読まない）
  setWeb([{ id: 9, trip_id: 2, jpy_amount: 5, is_purchased: 1 }], TRIPS);
  deepEqual(S.getTripStatsForDisplay(totals, 1000.15, 2, 'USD'), {
    candidateCount: 1, candidateTotalJpy: 0.3, purchasedTotalJpy: 333.05, remainingBudget: 667.1,
  });
});

test('Web：localStorage の旅行の基準通貨で合計し、残り予算も同じ桁で引く（渡された第4引数は使わない）', () => {
  globalThis.__TEST_PLATFORM_OS = 'web';
  setWeb(HISTORY, TRIPS);
  const ignoredHook = { ...B.EMPTY_BUDGET_TOTALS, purchasedTotalJpy: 12345 };
  const usd = S.getTripStatsForDisplay(ignoredHook, 10, 2, 'JPY');
  deepEqual(usd, {
    candidateCount: 2,
    candidateTotalJpy: M.sumMoney([0.1, 0.2], 'USD'),
    purchasedTotalJpy: M.sumMoney([1.005, 2.675], 'USD'),
    remainingBudget: 6.31,
  });
  equal(usd.candidateTotalJpy, 0.3);
  equal(usd.purchasedTotalJpy, 3.69);
  // 円の旅行：変更前の Web のコード（sumBudgetTotals → units なし）と同じ
  const jpyRows = HISTORY.filter((r) => r.trip_id === 1);
  deepEqual(S.getTripStatsForDisplay(ignoredHook, 5000, 1, 'USD'), B.computeBudgetStatsFromTotals(B.sumBudgetTotals(jpyRows), 5000));
  // 旅行が選ばれていない時：変更前と同じ（全行を sumBudgetTotals。金額は画面に出さない）
  deepEqual(S.getTripStatsForDisplay(ignoredHook, 0, null), B.computeBudgetStatsFromTotals(B.sumBudgetTotals(HISTORY), 0));
});

test('Web：旅行の保存先が壊れている・旅行が見つからない時は JPY と読む（変更前の値）', () => {
  globalThis.__TEST_PLATFORM_OS = 'web';
  store.set('travelrate:history', JSON.stringify(HISTORY));
  store.set('travelrate:trips', '{broken');
  const rows = HISTORY.filter((r) => r.trip_id === 2);
  deepEqual(S.getTripStatsForDisplay(B.EMPTY_BUDGET_TOTALS, 10, 2), B.computeBudgetStatsFromTotals(B.sumBudgetTotals(rows), 10));
  setWeb(HISTORY, [{ id: 1, target_currency: 'JPY' }]);
  deepEqual(S.getTripStatsForDisplay(B.EMPTY_BUDGET_TOTALS, 10, 2), B.computeBudgetStatsFromTotals(B.sumBudgetTotals(rows), 10));
});

test('tripStatsHomeCurrency（GX-06 段階 d）：Web は stats と同じ localStorage の旅行から旅行の id で引く・native は渡した値', () => {
  globalThis.__TEST_PLATFORM_OS = 'web';
  setWeb(HISTORY, TRIPS);
  // 渡された第2引数（store の activeTrip.target_currency）は使わない
  equal(S.tripStatsHomeCurrency(2, 'JPY'), 'USD');
  equal(S.tripStatsHomeCurrency(1, 'USD'), 'JPY');
  // 旅行が無い・見つからない・壊れた保存先は JPY（stats は単位なしで合計する）
  equal(S.tripStatsHomeCurrency(null, 'USD'), 'JPY');
  equal(S.tripStatsHomeCurrency(undefined, 'USD'), 'JPY');
  equal(S.tripStatsHomeCurrency(99, 'USD'), 'JPY');
  store.set('travelrate:trips', '{broken');
  equal(S.tripStatsHomeCurrency(2, 'USD'), 'JPY');
  // 記録の id（例：id 3 は旅行 2 の記録）を渡しても旅行の基準通貨にはならない（旅行の id で引く）
  setWeb(HISTORY, [{ id: 2, target_currency: 'USD' }]);
  equal(S.tripStatsHomeCurrency(3, 'JPY'), 'JPY');
  globalThis.__TEST_PLATFORM_OS = 'ios';
  equal(S.tripStatsHomeCurrency(2, 'EUR'), 'EUR');
  equal(S.tripStatsHomeCurrency(2, undefined), 'JPY');
  equal(S.tripStatsHomeCurrency(2, 'eur'), 'JPY');
});
