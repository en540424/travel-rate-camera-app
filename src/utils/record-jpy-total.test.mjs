/**
 * 画面間の円の合計の一致（`node --test src/utils/record-jpy-total.test.mjs`）。
 *
 * 2026-10-25 TestFlight 1.0.0 (4)の実機（Human確認）：同じハワイ旅行・同じ購入済み2件
 * （ローストビーフ $9.99・ピザ チーズ $1.99、1 USD = ¥163）の購入済み合計が、
 * 履歴・旅行管理は¥1,952、カレンダー・分析は¥1,953と1円ずれていた。
 *
 * 原因：外貨記録の`jpy_amount`は丸めずに保存される（9.99×163＝1628.37、1.99×163＝324.37）。
 *   - 履歴・旅行管理・残り予算：1件ずつ丸めてから足す（`sumBudgetTotals`・SQL `SUM(ROUND(jpy_amount))`）→ 1628＋324＝1952
 *   - カレンダー・分析：生値を足してから表示時に1回だけ丸める → 1952.74 → 1953
 * 一覧・詳細に出る各記録の円額は`formatJpy`（`Math.round`）なので、利用者に見えている円額の合計は¥1,952。
 * 採用した規則：**どの画面も「1件ずつ円へ丸めてから足す」**（`toRecordJpy`）。保存済みの金額・レートは書き換えない。
 *
 * 各画面の合計の作り方（このテストはそれぞれの式を同じ材料で並べて比べる）
 *   - 履歴（ヘッダーの購入済み）・旅行管理：旅行ごとの`sumBudgetTotals`（nativeはSQL `SUM(ROUND())`。同じ結果）
 *   - カレンダー：表示月の行の`sumBudgetTotals`（月の合計）、選択日×旅行ごとの`sumBudgetTotals`
 *   - 分析：`summarizePeriodSpending`（まとめ・棒・カテゴリー別）、旅行別は購入済みの`toRecordJpy`の合計
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { aggregateByCategory } from '../config/categories.ts';
import { summarizePeriodSpending, toRecordJpy as analyticsToRecordJpy } from './analytics-core.ts';
import { sumBudgetTotals, toRecordJpy } from './budget-core.ts';
import { matchesPeriod, rowToDateKey } from './history-date-core.ts';

// ─── fixture ───────────────────────────────────────────────────

let nextId = 1;
/** 保存時と同じ形：外貨は`foreign_amount × rate_used`を丸めずに`jpy_amount`へ、JPYは整数円 */
function record({ tripId, currency, foreign, rate, purchased, date, category = null }) {
  return {
    id: nextId++,
    trip_id: tripId,
    currency,
    foreign_amount: foreign,
    rate_used: rate,
    jpy_amount: currency === 'JPY' ? foreign : foreign * rate,
    is_purchased: purchased ? 1 : 0,
    entry_date: date,
    created_at: '2000-01-01 00:00:00',
    category,
  };
}

const HAWAII = 1;
const SEOUL = 2;
const PARIS = 3;
const TOKYO = 4;

const ROWS = [
  // ハワイ（USD、1 USD = ¥163）。実機と同じ購入済み2件＋候補5件
  record({ tripId: HAWAII, currency: 'USD', foreign: 9.99, rate: 163, purchased: true, date: '2026-10-21', category: 'food' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 1.99, rate: 163, purchased: true, date: '2026-10-22', category: 'food' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 24.99, rate: 163, purchased: false, date: '2026-10-21' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 3.49, rate: 163, purchased: false, date: '2026-10-21' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 12.5, rate: 163, purchased: false, date: '2026-10-22' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 0.99, rate: 163, purchased: false, date: '2026-10-23' }),
  record({ tripId: HAWAII, currency: 'USD', foreign: 7.75, rate: 163, purchased: false, date: '2026-10-23' }),
  // 途中でレートを変えた旅行：保存時のレート（rate_used）は記録ごとに違う
  record({ tripId: HAWAII, currency: 'USD', foreign: 4.99, rate: 150.25, purchased: true, date: '2026-10-05', category: 'souvenir' }),
  // ソウル（KRW、小さい単位の通貨：1 KRW ≒ ¥0.11）。1件が1円未満になる記録も混ぜる
  record({ tripId: SEOUL, currency: 'KRW', foreign: 4500, rate: 0.1093, purchased: true, date: '2026-10-21', category: 'food' }),
  record({ tripId: SEOUL, currency: 'KRW', foreign: 1500, rate: 0.1093, purchased: true, date: '2026-10-21' }),
  record({ tripId: SEOUL, currency: 'KRW', foreign: 3, rate: 0.1093, purchased: true, date: '2026-10-22' }), // 0.3279円 → ¥0
  record({ tripId: SEOUL, currency: 'KRW', foreign: 12000, rate: 0.1093, purchased: false, date: '2026-10-22' }),
  // パリ（EUR、端数が.5ちょうどになる記録：1.5×161 = 241.5 → ¥242）
  record({ tripId: PARIS, currency: 'EUR', foreign: 1.5, rate: 161, purchased: true, date: '2026-10-21', category: 'transport' }),
  record({ tripId: PARIS, currency: 'EUR', foreign: 18.9, rate: 161.37, purchased: true, date: '2026-10-22' }),
  // 国内（JPY、整数円）
  record({ tripId: TOKYO, currency: 'JPY', foreign: 1280, rate: 1, purchased: true, date: '2026-10-21' }),
  record({ tripId: TOKYO, currency: 'JPY', foreign: 540, rate: 1, purchased: false, date: '2026-10-21' }),
  // 別の月（10月の合計に入らない）
  record({ tripId: HAWAII, currency: 'USD', foreign: 5.55, rate: 163, purchased: true, date: '2026-09-30' }),
];

const OCTOBER = (r) => rowToDateKey(r).startsWith('2026-10');

/** 一覧・詳細に出る各記録の円額（`formatJpy`と同じ`Math.round`）を足したもの＝利用者に見えている合計 */
function visibleSum(rows) {
  return rows.reduce((s, r) => s + Math.round(r.jpy_amount), 0);
}

function toEntries(rows) {
  return rows.map((r) => ({
    dateKey: rowToDateKey(r),
    isPurchased: r.is_purchased === 1,
    jpyAmount: r.jpy_amount,
    category: r.category,
  }));
}

/** 分析タブ（月表示）の数字。analytics.tsxと同じ組み立て */
function analyticsMonth(rows, year, month) {
  return summarizePeriodSpending(
    toEntries(rows),
    (key) => matchesPeriod(key, 'month', year, month, '2026-10-25'),
    'month',
    year,
    month,
  );
}

/** 分析タブの「旅行別」（analytics.tsxの`tripSummary`と同じ：期間内の購入済みの`toRecordJpy`を旅行ごとに足す） */
function analyticsTripPurchased(rows, tripId, period) {
  return rows
    .filter((r) => r.trip_id === tripId && r.is_purchased === 1 && period(r))
    .reduce((s, r) => s + toRecordJpy(r.jpy_amount), 0);
}

// ─── 実機の1円差の再現 ────────────────────────────────────────

test('再現：$9.99＋$1.99（¥163）は、旧カレンダー・分析の式だと¥1,953、各記録の円額の合計は¥1,952', () => {
  const two = ROWS.filter((r) => r.trip_id === HAWAII && r.is_purchased === 1 && OCTOBER(r) && r.rate_used === 163);
  equal(two.length, 2);
  // 保存されている値（丸めていない）
  ok(Math.abs(two[0].jpy_amount - 1628.37) < 1e-9);
  ok(Math.abs(two[1].jpy_amount - 324.37) < 1e-9);
  // 2026-10-25までのカレンダー・分析の式：生値を足してから表示時に1回丸める
  const legacyCalendarAnalytics = Math.round(two.reduce((s, r) => s + r.jpy_amount, 0));
  equal(legacyCalendarAnalytics, 1953);
  // 履歴・旅行管理の式（変更なし）と、修正後のカレンダー・分析の式
  equal(sumBudgetTotals(two).purchasedTotalJpy, 1952);
  equal(analyticsMonth(two, 2026, 10).purchasedTotal, 1952);
  // 一覧に並ぶ円額（¥1,628・¥324）の合計と一致する
  deepEqual(two.map((r) => Math.round(r.jpy_amount)), [1628, 324]);
  equal(visibleSum(two), 1952);
});

// ─── 4画面の一致 ──────────────────────────────────────────────

test('同じ旅行・同じ月なら、履歴・旅行管理・カレンダー・分析の購入済み合計／候補合計が一致する（旅行ごと）', () => {
  for (const tripId of [HAWAII, SEOUL, PARIS, TOKYO]) {
    const tripOctober = ROWS.filter((r) => r.trip_id === tripId && OCTOBER(r));
    const history = sumBudgetTotals(tripOctober); // 履歴・旅行管理（この旅行・この月の記録だけを材料にした場合）
    const calendar = sumBudgetTotals(tripOctober); // カレンダーの月の合計の式
    const analytics = analyticsMonth(tripOctober, 2026, 10);
    const analyticsTrip = analyticsTripPurchased(ROWS, tripId, OCTOBER);

    equal(calendar.purchasedTotalJpy, history.purchasedTotalJpy, `trip ${tripId}`);
    equal(analytics.purchasedTotal, history.purchasedTotalJpy, `trip ${tripId}`);
    equal(analyticsTrip, history.purchasedTotalJpy, `trip ${tripId}`);
    equal(analytics.candidateTotal, history.candidateTotalJpy, `trip ${tripId}`);
    equal(calendar.candidateTotalJpy, history.candidateTotalJpy, `trip ${tripId}`);
    // どれも利用者に見えている各記録の円額の合計
    equal(history.purchasedTotalJpy, visibleSum(tripOctober.filter((r) => r.is_purchased === 1)), `trip ${tripId}`);
    equal(history.candidateTotalJpy, visibleSum(tripOctober.filter((r) => r.is_purchased === 0)), `trip ${tripId}`);
  }
});

test('全旅行の月の合計：カレンダー（月）＝分析（月のまとめ・棒の合計・カテゴリー別の合計）＝旅行ごとの合計の和', () => {
  const october = ROWS.filter(OCTOBER);
  const calendar = sumBudgetTotals(october);
  const analytics = analyticsMonth(ROWS, 2026, 10);
  const perTrip = [HAWAII, SEOUL, PARIS, TOKYO].map((t) => sumBudgetTotals(october.filter((r) => r.trip_id === t)));

  equal(analytics.purchasedTotal, calendar.purchasedTotalJpy);
  equal(analytics.candidateTotal, calendar.candidateTotalJpy);
  equal(analytics.purchasedCount, calendar.purchasedCount);
  equal(analytics.totalCount, calendar.purchasedCount + calendar.candidateCount);
  equal(analytics.buckets.reduce((s, b) => s + b.amount, 0), calendar.purchasedTotalJpy);
  equal(aggregateByCategory(analytics.categoryInputs).reduce((s, c) => s + c.total, 0), calendar.purchasedTotalJpy);
  equal(perTrip.reduce((s, t) => s + t.purchasedTotalJpy, 0), calendar.purchasedTotalJpy);
  equal(perTrip.reduce((s, t) => s + t.candidateTotalJpy, 0), calendar.candidateTotalJpy);
});

test('カレンダーの選択日：旅行ごとの合計の和が、その日の記録の円額の合計と一致する（日の棒とも一致）', () => {
  const day = ROWS.filter((r) => rowToDateKey(r) === '2026-10-21');
  const groups = new Map();
  for (const r of day) groups.set(r.trip_id, [...(groups.get(r.trip_id) ?? []), r]);
  const purchased = [...groups.values()].reduce((s, rows) => s + sumBudgetTotals(rows).purchasedTotalJpy, 0);
  const candidate = [...groups.values()].reduce((s, rows) => s + sumBudgetTotals(rows).candidateTotalJpy, 0);
  equal(purchased, visibleSum(day.filter((r) => r.is_purchased === 1)));
  equal(candidate, visibleSum(day.filter((r) => r.is_purchased === 0)));
  const bar = analyticsMonth(ROWS, 2026, 10).buckets.find((b) => b.key === 'd21');
  equal(bar.amount, purchased);
});

test('候補と購入済みは混ざらない：候補を足しても購入済み合計は変わらない', () => {
  const purchasedOnly = ROWS.filter((r) => r.is_purchased === 1 && OCTOBER(r));
  const all = ROWS.filter(OCTOBER);
  equal(sumBudgetTotals(all).purchasedTotalJpy, sumBudgetTotals(purchasedOnly).purchasedTotalJpy);
  equal(analyticsMonth(all, 2026, 10).purchasedTotal, analyticsMonth(purchasedOnly, 2026, 10).purchasedTotal);
  equal(analyticsMonth(purchasedOnly, 2026, 10).candidateTotal, 0);
});

test('別の月・別の旅行の記録は入らない', () => {
  const sep = ROWS.filter((r) => rowToDateKey(r).startsWith('2026-09'));
  equal(analyticsMonth(ROWS, 2026, 9).purchasedTotal, visibleSum(sep));
  equal(analyticsTripPurchased(ROWS, HAWAII, OCTOBER), 1628 + 324 + Math.round(4.99 * 150.25));
});

test('保存時のレートを尊重：合計は保存済みの`jpy_amount`から作り、今のレートで計算し直さない', () => {
  const changed = ROWS.find((r) => r.rate_used === 150.25);
  const stored = Math.round(changed.jpy_amount); // 4.99 × 150.25 = 749.7475 → ¥750
  equal(stored, 750);
  equal(sumBudgetTotals([changed]).purchasedTotalJpy, 750);
  equal(analyticsMonth([changed], 2026, 10).purchasedTotal, 750);
  // 今のレート（163）で計算し直すと別の値になる＝計算し直していないことの確認
  ok(Math.round(changed.foreign_amount * 163) !== 750);
});

test('集計は保存済みの記録を書き換えない（DBの値・記録の形はそのまま）', () => {
  const before = JSON.parse(JSON.stringify(ROWS));
  sumBudgetTotals(ROWS);
  analyticsMonth(ROWS, 2026, 10);
  analyticsTripPurchased(ROWS, HAWAII, OCTOBER);
  deepEqual(ROWS, before);
});

test('1円未満の記録（KRWの小額）・.5ちょうどの記録も、一覧の円額と同じに数える', () => {
  const tiny = ROWS.find((r) => r.currency === 'KRW' && r.foreign_amount === 3);
  equal(Math.round(tiny.jpy_amount), 0);
  equal(sumBudgetTotals([tiny]).purchasedTotalJpy, 0);
  equal(analyticsMonth([tiny], 2026, 10).purchasedTotal, 0);
  const half = ROWS.find((r) => r.currency === 'EUR' && r.foreign_amount === 1.5);
  equal(half.jpy_amount, 241.5);
  equal(sumBudgetTotals([half]).purchasedTotalJpy, 242);
  equal(analyticsMonth([half], 2026, 10).purchasedTotal, 242);
});

test('壊れた金額（NaN・Infinity）は0として数え、どの画面の合計もNaNにならない', () => {
  const broken = [
    { ...ROWS[0], id: 900, jpy_amount: Number.NaN },
    { ...ROWS[0], id: 901, jpy_amount: Number.POSITIVE_INFINITY },
    ROWS[1],
  ];
  equal(sumBudgetTotals(broken).purchasedTotalJpy, 324);
  equal(analyticsMonth(broken, 2026, 10).purchasedTotal, 324);
  equal(analyticsTripPurchased(broken, HAWAII, OCTOBER), 324);
});

test('`toRecordJpy`：分析（analytics-core）の写しは、履歴・予算（budget-core）と同じ値を返す', () => {
  const values = [
    0, 0.4, 0.5, 0.49999999999999994, 1.5, 2.5, 241.5, 324.37, 1628.37, 1952.74, 749.7475,
    38.5 * 155.3, 9.99 * 163, 1e12 + 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ];
  for (const v of values) equal(analyticsToRecordJpy(v), toRecordJpy(v), String(v));
});

// ─── 再発防止：画面のコードで生値の円を足していない ─────────────

const SRC = fileURLToPath(new URL('..', import.meta.url));

function listSources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

test('再発防止：画面・部品・hooks・集計関数で`jpy_amount`／`jpyAmount`の生値を合計していない（合計は`toRecordJpy`・`sumBudgetTotals`を通す）', () => {
  // 2026-10-25以前のcalendar.tsx（4か所）・analytics.tsxの旅行別・analytics-core.ts（4か所）はこの形で検出される
  // `s + r.jpy_amount`・`+= row.jpy_amount`・`+= entry.jpyAmount`のような生値の足し込み
  // `rows.map((r) => r.jpy_amount)`（金額だけの配列を作ってから足す形）も検出する
  const RAW_SUM =
    /(\+=\s*[\w.]*\.(jpy_amount|jpyAmount)\b)|(\+\s*[\w]+\.(jpy_amount|jpyAmount)\s*,\s*0\s*\))|(=>\s*\w+\.(jpy_amount|jpyAmount)\s*\))/;
  const offenders = [];
  for (const dir of ['app', 'components', 'hooks', 'utils', 'lib', 'config', 'db']) {
    for (const file of listSources(join(SRC, dir))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (RAW_SUM.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
  }
  deepEqual(offenders, []);
});
