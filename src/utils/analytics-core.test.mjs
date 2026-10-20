/**
 * `utils/analytics-core.ts`の検証（`node --test src/utils/analytics-core.test.mjs`）。
 *
 * 最重要の観点は2つ。
 *   (1) 分析画面の数字（購入済み合計・候補合計・件数・棒グラフ・カテゴリー別）が、2026-10-20の
 *       再設計前に`analytics.tsx`内で計算していた値と**1円も変わらない**こと（下の`legacy*`が旧実装の写し）
 *   (2) 同じ期間の「購入済み合計＝棒グラフの合計＝カテゴリー別の合計」が常に成り立つこと
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateByCategory } from '../config/categories.ts';
import {
  barHeightPx,
  buildShareLabels,
  findPeakBucket,
  formatAxisLabels,
  formatCompactYen,
  niceAxisMax,
  summarizePeriodSpending,
  toDisplayPercents,
} from './analytics-core.ts';
import { matchesPeriod, rowToDateKey } from './history-date-core.ts';

// ─── fixture ───────────────────────────────────────────────────
// 日付は`entry_date`で与える（`created_at`だけだと端末TZで日付がずれ、テストが環境依存になるため）

function row(entryDate, isPurchased, jpyAmount, category = null) {
  return {
    entry_date: entryDate,
    created_at: '2000-01-01 00:00:00',
    is_purchased: isPurchased ? 1 : 0,
    jpy_amount: jpyAmount,
    category,
  };
}

function toEntries(rows) {
  return rows.map((r) => ({
    dateKey: rowToDateKey(r),
    isPurchased: r.is_purchased === 1,
    jpyAmount: r.jpy_amount,
    category: r.category,
  }));
}

/** analytics.tsxと同じ組み立て（期間判定は`matchesPeriod`、棒は今日表示なら無し） */
function summarize(rows, period, year, month, todayKey) {
  return summarizePeriodSpending(
    toEntries(rows),
    (key) => matchesPeriod(key, period, year, month, todayKey),
    period === 'today' ? 'none' : period,
    year,
    month,
  );
}

const sum = (values) => values.reduce((s, v) => s + v, 0);

const ROWS = [
  row('2026-09-01', true, 1200, 'food'),
  row('2026-09-01', false, 3000, 'souvenir'),
  row('2026-09-14', true, 4719, 'clothing'),
  row('2026-09-14', true, 38.5 * 155.3, 'food'), // 外貨：小数の円換算（5979.15）
  row('2026-09-14', true, 900, null), // 未分類
  row('2026-09-30', true, 1650, 'transport'),
  row('2026-08-31', true, 9999, 'food'), // 前月
  row('2026-10-01', true, 7777, 'food'), // 翌月
  row('2025-09-14', true, 5555, 'food'), // 前年
  row('2026-02-10', false, 800, 'other'),
  row('2026-12-31', true, 2400, 'entertainment'),
];

// ─── (1) 旧実装と同じ値 ───────────────────────────────────────

/** 2026-10-20以前の`analytics.tsx`の`periodStats`をそのまま写したもの */
function legacyPeriodStats(history, period, anchorYear, anchorMonth, todayKey) {
  let purchasedTotal = 0, candidateTotal = 0, totalCount = 0, purchasedCount = 0;
  for (const r of history) {
    if (!matchesPeriod(rowToDateKey(r), period, anchorYear, anchorMonth, todayKey)) continue;
    totalCount++;
    if (r.is_purchased === 1) { purchasedTotal += r.jpy_amount; purchasedCount++; }
    else { candidateTotal += r.jpy_amount; }
  }
  return { purchasedTotal, candidateTotal, totalCount, purchasedCount };
}

/** 同`chartData`（棒1本ごとに全件を走査していた旧実装） */
function legacyChartAmounts(history, period, anchorYear, anchorMonth) {
  if (period === 'year') {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
      let amount = 0;
      for (const r of history) {
        const [ry, rm] = rowToDateKey(r).split('-').map(Number);
        if (ry === anchorYear && rm === m && r.is_purchased === 1) amount += r.jpy_amount;
      }
      return amount;
    });
  }
  if (period === 'month') {
    const days = new Date(anchorYear, anchorMonth, 0).getDate();
    return Array.from({ length: days }, (_, i) => i + 1).map((day) => {
      let amount = 0;
      for (const r of history) {
        const [ry, rm, rd] = rowToDateKey(r).split('-').map(Number);
        if (ry === anchorYear && rm === anchorMonth && rd === day && r.is_purchased === 1) amount += r.jpy_amount;
      }
      return amount;
    });
  }
  return [];
}

/** 同`categorySummary`の入力 */
function legacyCategoryInputs(history, period, anchorYear, anchorMonth, todayKey) {
  return history
    .filter((r) => r.is_purchased === 1 && matchesPeriod(rowToDateKey(r), period, anchorYear, anchorMonth, todayKey))
    .map((r) => ({ category: r.category, jpyAmount: r.jpy_amount }));
}

const CASES = [
  ['month', 2026, 9, '2026-09-14'],
  ['month', 2026, 8, '2026-09-14'],
  ['month', 2026, 2, '2026-09-14'],
  ['year', 2026, 9, '2026-09-14'],
  ['year', 2025, 9, '2026-09-14'],
  ['today', 2026, 9, '2026-09-14'],
  ['today', 2026, 9, '2026-09-15'],
];

for (const [period, year, month, todayKey] of CASES) {
  test(`summarizePeriodSpending: 旧実装と同じ値（${period} ${year}-${month} today=${todayKey}）`, () => {
    const s = summarize(ROWS, period, year, month, todayKey);
    const legacy = legacyPeriodStats(ROWS, period, year, month, todayKey);
    equal(s.purchasedTotal, legacy.purchasedTotal);
    equal(s.candidateTotal, legacy.candidateTotal);
    equal(s.totalCount, legacy.totalCount);
    equal(s.purchasedCount, legacy.purchasedCount);
    deepEqual(s.buckets.map((b) => b.amount), legacyChartAmounts(ROWS, period, year, month));
    deepEqual(
      aggregateByCategory(s.categoryInputs),
      aggregateByCategory(legacyCategoryInputs(ROWS, period, year, month, todayKey)),
    );
  });
}

// ─── (2) 合計の一致・期間変更 ─────────────────────────────────

for (const [period, year, month, todayKey] of CASES) {
  test(`合計一致：購入済み合計＝棒の合計＝カテゴリー別の合計（${period} ${year}-${month}）`, () => {
    const s = summarize(ROWS, period, year, month, todayKey);
    const categoryTotal = sum(aggregateByCategory(s.categoryInputs).map((c) => c.total));
    // 生値どうしで比べる（表示は1件ずつformatJpyで丸めるので、表示上は±1円ずれ得る）
    ok(Math.abs(categoryTotal - s.purchasedTotal) < 1e-9);
    if (period !== 'today') ok(Math.abs(sum(s.buckets.map((b) => b.amount)) - s.purchasedTotal) < 1e-9);
    const categoryCount = sum(aggregateByCategory(s.categoryInputs).map((c) => c.count));
    equal(categoryCount, s.purchasedCount);
  });
}

test('期間変更：2026年9月→8月→2026年→今日で、それぞれの期間の記録だけが数えられる', () => {
  const sep = summarize(ROWS, 'month', 2026, 9, '2026-09-14');
  equal(sep.purchasedTotal, 1200 + 4719 + 38.5 * 155.3 + 900 + 1650);
  equal(sep.candidateTotal, 3000);
  equal(sep.totalCount, 6);
  equal(sep.purchasedCount, 5);

  const aug = summarize(ROWS, 'month', 2026, 8, '2026-09-14');
  equal(aug.purchasedTotal, 9999);
  equal(aug.buckets.length, 31);
  equal(aug.buckets[30].amount, 9999);

  const y2026 = summarize(ROWS, 'year', 2026, 9, '2026-09-14');
  equal(y2026.buckets.length, 12);
  equal(y2026.buckets[8].amount, sep.purchasedTotal); // 9月の棒＝月表示の合計
  equal(y2026.buckets[7].amount, 9999);
  equal(y2026.buckets[9].amount, 7777);
  equal(y2026.buckets[11].amount, 2400);
  equal(y2026.buckets[1].amount, 0); // 2月は候補だけ
  equal(y2026.candidateTotal, 3000 + 800);

  const today = summarize(ROWS, 'today', 2026, 9, '2026-09-14');
  deepEqual(today.buckets, []);
  equal(today.purchasedTotal, 4719 + 38.5 * 155.3 + 900);
  equal(today.purchasedCount, 3);
});

test('月表示の棒：日数どおり（うるう年の2月=29本）・曜日付き', () => {
  const feb = summarizePeriodSpending([], () => false, 'month', 2028, 2);
  equal(feb.buckets.length, 29);
  const sep = summarizePeriodSpending([], () => false, 'month', 2026, 9);
  equal(sep.buckets.length, 30);
  equal(sep.buckets[0].key, 'd1');
  equal(sep.buckets[0].index, 1);
  equal(sep.buckets[0].weekday, 2); // 2026-09-01は火曜
  equal(sep.buckets[13].weekday, 1); // 2026-09-14は月曜
});

test('0件：合計0・棒は全て0・カテゴリー入力は空', () => {
  const s = summarize([], 'month', 2026, 9, '2026-09-14');
  equal(s.purchasedTotal, 0);
  equal(s.candidateTotal, 0);
  equal(s.totalCount, 0);
  equal(s.buckets.length, 30);
  ok(s.buckets.every((b) => b.amount === 0));
  deepEqual(aggregateByCategory(s.categoryInputs), []);
  equal(findPeakBucket(s.buckets), null);
});

test('候補だけの期間：購入済み合計0・カテゴリー別は空（候補はカテゴリー別に入れない）', () => {
  const s = summarize([row('2026-09-02', false, 5000, 'food')], 'month', 2026, 9, '2026-09-14');
  equal(s.purchasedTotal, 0);
  equal(s.candidateTotal, 5000);
  equal(s.totalCount, 1);
  deepEqual(s.categoryInputs, []);
});

// ─── カテゴリー別（期間の購入済みから） ───────────────────────

test('1カテゴリーだけ：100%・バー比1', () => {
  const s = summarize([row('2026-09-02', true, 3200, 'food'), row('2026-09-03', true, 800, 'food')], 'month', 2026, 9, '2026-09-14');
  const cats = aggregateByCategory(s.categoryInputs);
  equal(cats.length, 1);
  equal(cats[0].label, '食事');
  equal(cats[0].total, 4000);
  equal(cats[0].count, 2);
  deepEqual(buildShareLabels(cats.map((c) => c.total)), ['100%']);
});

test('複数カテゴリー＋未分類：金額の降順、未分類は独立した行で残る', () => {
  const s = summarize(ROWS, 'month', 2026, 9, '2026-09-14');
  const cats = aggregateByCategory(s.categoryInputs);
  deepEqual(cats.map((c) => c.label), ['食事', '衣類', '交通', '未分類']);
  equal(cats[0].total, 1200 + 38.5 * 155.3);
  const labels = buildShareLabels(cats.map((c) => c.total));
  equal(labels.length, 4);
  equal(sum(toDisplayPercents(cats.map((c) => c.total))), 100);
});

test('同額カテゴリー：定義順で並び、%も合計100（33/33/34ではなく前側が多い）', () => {
  const s = summarize(
    [row('2026-09-02', true, 1000, 'transport'), row('2026-09-02', true, 1000, 'food'), row('2026-09-02', true, 1000, 'souvenir')],
    'month', 2026, 9, '2026-09-14',
  );
  const cats = aggregateByCategory(s.categoryInputs);
  deepEqual(cats.map((c) => c.id), ['food', 'souvenir', 'transport']);
  deepEqual(toDisplayPercents(cats.map((c) => c.total)), [34, 33, 33]);
});

// ─── 表示用の%（最大剰余法） ───────────────────────────────────

test('toDisplayPercents：端数があっても合計はちょうど100', () => {
  for (const amounts of [
    [1, 1, 1],
    [32400, 18600, 8200, 3400],
    [5979.15, 4719, 1650, 1200, 900],
    [1, 2, 3, 4, 5, 6, 7],
    [999, 1],
    [0.3, 0.3, 0.4],
  ]) {
    equal(sum(toDisplayPercents(amounts)), 100, `合計が100にならない: ${amounts}`);
  }
  deepEqual(toDisplayPercents([32400, 18600, 8200, 3400]), [52, 30, 13, 5]);
});

test('toDisplayPercents：合計0・空・非数は0（NaNを出さない）', () => {
  deepEqual(toDisplayPercents([0, 0]), [0, 0]);
  deepEqual(toDisplayPercents([]), []);
  deepEqual(toDisplayPercents([Number.NaN, 100]), [0, 100]);
  deepEqual(toDisplayPercents([-50, 50]), [0, 100]);
});

test('buildShareLabels：とても小さい金額は「<1%」、他があるのに100%なら「>99%」', () => {
  deepEqual(buildShareLabels([100000, 30]), ['>99%', '<1%']);
  deepEqual(buildShareLabels([1000, 0]), ['100%', '0%']);
  deepEqual(buildShareLabels([0, 0]), ['0%', '0%']);
  deepEqual(buildShareLabels([3, 1]), ['75%', '25%']);
});

// ─── 縦棒グラフの表示補助 ─────────────────────────────────────

test('niceAxisMax：きりのいい上端（1・1.5・2・3・4・5・6・8×10^n。2.5は使わない）', () => {
  equal(niceAxisMax(4719), 5000);
  equal(niceAxisMax(12760), 15000);
  equal(niceAxisMax(32400), 40000);
  equal(niceAxisMax(62000), 80000);
  equal(niceAxisMax(84320), 100000);
  equal(niceAxisMax(20000), 20000);
  equal(niceAxisMax(21000), 30000);
  equal(niceAxisMax(1), 1);
  equal(niceAxisMax(0.45), 0.5);
  equal(niceAxisMax(0), 0);
  equal(niceAxisMax(-5), 0);
  equal(niceAxisMax(Number.NaN), 0);
});

test('barHeightPx：0円は描かない・小さい金額も最低高さで見える・上端を超えない', () => {
  equal(barHeightPx(0, 5000, 140), 0);
  equal(barHeightPx(5000, 5000, 140), 140);
  equal(barHeightPx(2500, 5000, 140), 70);
  equal(barHeightPx(10, 100000, 140), 4); // 大きい金額と混在しても見える
  equal(barHeightPx(10, 0, 140), 0);
  equal(barHeightPx(6000, 5000, 140), 140);
});

test('findPeakBucket：最大の棒（同額は先の方）', () => {
  const peak = findPeakBucket([
    { key: 'd1', index: 1, amount: 100 },
    { key: 'd2', index: 2, amount: 300 },
    { key: 'd3', index: 3, amount: 300 },
  ]);
  equal(peak.key, 'd2');
});

test('formatAxisLabels：上端と半分は同じ単位・正確な値（万と桁区切りを混ぜない）', () => {
  deepEqual(formatAxisLabels(40000), { top: '¥4万', half: '¥2万' });
  deepEqual(formatAxisLabels(30000), { top: '¥3万', half: '¥1.5万' });
  deepEqual(formatAxisLabels(20000), { top: '¥2万', half: '¥1万' });
  deepEqual(formatAxisLabels(15000), { top: '¥15,000', half: '¥7,500' });
  deepEqual(formatAxisLabels(10000), { top: '¥10,000', half: '¥5,000' });
  deepEqual(formatAxisLabels(5000), { top: '¥5,000', half: '¥2,500' });
  deepEqual(formatAxisLabels(1000000), { top: '¥100万', half: '¥50万' });
  deepEqual(formatAxisLabels(300000000), { top: '¥3億', half: '¥1.5億' });
  // niceAxisMaxが返しうる上端なら、半分の目盛りは常に小数1桁以内で正確（丸めた表記にならない）
  for (const max of [3, 77, 640, 4719, 12760, 21000, 32400, 62000, 84320, 140000, 2600000, 51000000]) {
    const axisMax = niceAxisMax(max);
    const { half } = formatAxisLabels(axisMax);
    const value = Number(half.replace(/[¥,万億]/g, ''));
    const scale = half.endsWith('億') ? 1e8 : half.endsWith('万') ? 1e4 : 1;
    equal(value * scale, axisMax / 2, `半分の目盛りが不正確: max=${max} axisMax=${axisMax} half=${half}`);
  }
});

test('formatCompactYen：短い円表記', () => {
  equal(formatCompactYen(0), '¥0');
  equal(formatCompactYen(500), '¥500');
  equal(formatCompactYen(2500), '¥2,500');
  equal(formatCompactYen(5000), '¥5,000');
  equal(formatCompactYen(10000), '¥1万');
  equal(formatCompactYen(25000), '¥2.5万');
  equal(formatCompactYen(100000), '¥10万');
  equal(formatCompactYen(1250000), '¥125万');
  equal(formatCompactYen(150000000), '¥1.5億');
});
