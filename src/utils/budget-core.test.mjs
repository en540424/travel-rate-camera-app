/**
 * `utils/budget-core.ts`の検証（`node --test src/utils/budget-core.test.mjs`）。
 *
 * 最重要：残り予算は「予算 − 購入済み合計」であり、**候補は差し引かない**。
 * Human実機（2026-08-28）で、候補も差し引いていたため残り0円になった不具合の再発防止。
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  budgetTotalsByTripFromGroupRows,
  computeBudgetStats,
  computeBudgetStatsFromTotals,
  EMPTY_BUDGET_TOTALS,
  remainingSaveSlots,
  shouldShowNearSaveLimit,
  sumBudgetTotals,
} from './budget-core.ts';

const purchased = (amount) => ({ jpy_amount: amount, is_purchased: 1 });
const candidate = (amount) => ({ jpy_amount: amount, is_purchased: 0 });

// ── 残り予算 ────────────────────────────────────────────────

test('computeBudgetStats: Human実機ケース（予算50000/購入済み33407/候補18192）→ 残り16593', () => {
  const stats = computeBudgetStats([purchased(33407), candidate(18192)], 50000);
  equal(stats.purchasedTotalJpy, 33407);
  equal(stats.candidateTotalJpy, 18192);
  equal(stats.remainingBudget, 16593);
});

test('computeBudgetStats: 候補が増えても残り予算は減らない', () => {
  const base = computeBudgetStats([purchased(10000)], 50000);
  const withCandidates = computeBudgetStats(
    [purchased(10000), candidate(20000), candidate(15000)],
    50000,
  );
  equal(base.remainingBudget, 40000);
  equal(withCandidates.remainingBudget, 40000); // 候補を足しても不変
  equal(withCandidates.candidateTotalJpy, 35000); // 候補合計自体はちゃんと出る
});

test('computeBudgetStats: 購入済みが増えると残り予算が減る', () => {
  equal(computeBudgetStats([purchased(10000)], 50000).remainingBudget, 40000);
  equal(computeBudgetStats([purchased(10000), purchased(5000)], 50000).remainingBudget, 35000);
});

test('computeBudgetStats: 購入済みが予算を超えたら0にclampする（負値を出さない）', () => {
  const stats = computeBudgetStats([purchased(60000)], 50000);
  equal(stats.remainingBudget, 0);
  equal(stats.purchasedTotalJpy, 60000); // 合計自体はclampしない
});

test('computeBudgetStats: 候補だけなら残り予算は予算そのまま', () => {
  const stats = computeBudgetStats([candidate(30000), candidate(40000)], 50000);
  equal(stats.remainingBudget, 50000);
  equal(stats.purchasedTotalJpy, 0);
});

test('computeBudgetStats: 候補件数を数える（購入済みは数えない）', () => {
  const stats = computeBudgetStats([candidate(100), candidate(200), purchased(300)], 1000);
  equal(stats.candidateCount, 2);
});

test('computeBudgetStats: is_purchased未設定/nullは候補として扱う', () => {
  const stats = computeBudgetStats([{ jpy_amount: 500 }, { jpy_amount: 300, is_purchased: null }], 10000);
  equal(stats.candidateCount, 2);
  equal(stats.candidateTotalJpy, 800);
  equal(stats.remainingBudget, 10000);
});

test('computeBudgetStats: 金額は行ごとにroundする（合計後の丸めではない）', () => {
  const stats = computeBudgetStats([purchased(10.6), purchased(10.6)], 1000);
  equal(stats.purchasedTotalJpy, 22); // 11 + 11。21.2の丸め(21)ではない
});

test('computeBudgetStats: 有限でない金額は0として扱い集計を壊さない', () => {
  const stats = computeBudgetStats([purchased(Number.NaN), purchased(1000)], 5000);
  equal(stats.purchasedTotalJpy, 1000);
  equal(stats.remainingBudget, 4000);
});

test('computeBudgetStats: 空配列は全て0・残りは予算そのまま', () => {
  deepEqual(computeBudgetStats([], 50000), {
    candidateCount: 0,
    candidateTotalJpy: 0,
    purchasedTotalJpy: 0,
    remainingBudget: 50000,
  });
});

test('computeBudgetStats: 予算0なら残りも0', () => {
  equal(computeBudgetStats([purchased(100)], 0).remainingBudget, 0);
});

// ── 保存上限の接近判定 ──────────────────────────────────────

test('shouldShowNearSaveLimit: 上限10・offset3なら7件目から出る', () => {
  const near = (count) => shouldShowNearSaveLimit(count, 10, 3);
  equal(near(0), false);
  equal(near(5), false);
  equal(near(6), false); // 6件目までは出さない
  equal(near(7), true); // 7件目から
  equal(near(8), true);
  equal(near(9), true);
  equal(near(10), true);
});

test('shouldShowNearSaveLimit: 上限を超えて保存済みでもtrueのまま', () => {
  equal(shouldShowNearSaveLimit(25, 10, 3), true);
});

test('shouldShowNearSaveLimit: 上限0以下では常にfalse', () => {
  equal(shouldShowNearSaveLimit(5, 0, 3), false);
  equal(shouldShowNearSaveLimit(5, -1, 3), false);
});

test('remainingSaveSlots: 上限までの残り件数', () => {
  equal(remainingSaveSlots(0, 10), 10);
  equal(remainingSaveSlots(7, 10), 3);
  equal(remainingSaveSlots(9, 10), 1);
  equal(remainingSaveSlots(10, 10), 0);
});

test('remainingSaveSlots: 上限超過でも負値を出さない（既存超過ユーザー対策）', () => {
  equal(remainingSaveSlots(25, 10), 0);
});

// ── 合計層（SQL集計→残り予算）。表示上限（500/2000件）に依存しない集計の固定 ──────────
// Fable 5.1 / Codex独立監査（2026-09-11、HEAD dbd99ce）S2-5・S2-10の再発防止。

test('sumBudgetTotals: 候補/購入済みの件数と合計を分けて返す（行ごとに丸める）', () => {
  deepEqual(sumBudgetTotals([purchased(10.6), purchased(10.6), candidate(5.4)]), {
    candidateCount: 1,
    candidateTotalJpy: 5,
    purchasedCount: 2,
    purchasedTotalJpy: 22,
  });
});

test('computeBudgetStatsFromTotals: 残り予算 = 予算 − 購入済み合計（候補は差し引かない）', () => {
  const stats = computeBudgetStatsFromTotals(
    { candidateCount: 3, candidateTotalJpy: 18192, purchasedCount: 2, purchasedTotalJpy: 33407 },
    50000,
  );
  equal(stats.remainingBudget, 16593);
  equal(stats.candidateTotalJpy, 18192);
  equal(stats.purchasedTotalJpy, 33407);
});

test('computeBudgetStatsFromTotals: 空の合計は残り予算が予算そのまま、0未満にはならない', () => {
  equal(computeBudgetStatsFromTotals(EMPTY_BUDGET_TOTALS, 50000).remainingBudget, 50000);
  equal(computeBudgetStatsFromTotals({ ...EMPTY_BUDGET_TOTALS, purchasedTotalJpy: 60000 }, 50000).remainingBudget, 0);
});

test('computeBudgetStats は sumBudgetTotals→computeBudgetStatsFromTotals と同じ結果を返す', () => {
  const rows = [purchased(33407), candidate(18192), candidate(100.5)];
  deepEqual(computeBudgetStats(rows, 50000), computeBudgetStatsFromTotals(sumBudgetTotals(rows), 50000));
});

test('budgetTotalsByTripFromGroupRows: GROUP BY結果を旅行ごとの合計へ畳む', () => {
  const map = budgetTotalsByTripFromGroupRows([
    { trip_id: 1, is_purchased: 1, count: 501, total: 50100 },
    { trip_id: 1, is_purchased: 0, count: 2, total: 300 },
    { trip_id: 2, is_purchased: 0, count: 1, total: 1000 },
    { trip_id: null, is_purchased: 1, count: 9, total: 9999 }, // 未分類は旅行画面で使わない
  ]);
  deepEqual(map.get(1), { candidateCount: 2, candidateTotalJpy: 300, purchasedCount: 501, purchasedTotalJpy: 50100 });
  deepEqual(map.get(2), { candidateCount: 1, candidateTotalJpy: 1000, purchasedCount: 0, purchasedTotalJpy: 0 });
  equal(map.has(0), false);
  equal(map.size, 2);
});

test('budgetTotalsByTripFromGroupRows: 501件×100円／予算10万円 → 残り49,900円（500件で切ると50,000円になる不具合の固定）', () => {
  const map = budgetTotalsByTripFromGroupRows([{ trip_id: 7, is_purchased: 1, count: 501, total: 50100 }]);
  equal(computeBudgetStatsFromTotals(map.get(7), 100000).remainingBudget, 49900);
});

test('budgetTotalsByTripFromGroupRows: total=null（行なし相当）やis_purchased=nullは安全に扱う', () => {
  const map = budgetTotalsByTripFromGroupRows([{ trip_id: 3, is_purchased: null, count: 1, total: null }]);
  deepEqual(map.get(3), { candidateCount: 1, candidateTotalJpy: 0, purchasedCount: 0, purchasedTotalJpy: 0 });
});
