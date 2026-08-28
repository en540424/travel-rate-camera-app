/**
 * `utils/budget-core.ts`の検証（`node --test src/utils/budget-core.test.mjs`）。
 *
 * 最重要：残り予算は「予算 − 購入済み合計」であり、**候補は差し引かない**。
 * Human実機（2026-08-28）で、候補も差し引いていたため残り0円になった不具合の再発防止。
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeBudgetStats,
  remainingSaveSlots,
  shouldShowNearSaveLimit,
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
