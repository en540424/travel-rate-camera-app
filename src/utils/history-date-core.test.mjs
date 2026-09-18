/**
 * `utils/history-date-core.ts`の検証（`node --test src/utils/history-date-core.test.mjs`）。
 *
 * 最重要：分析・カレンダーは旧実装で「最新2000件（`created_at`順）」をJS側で集計しており、
 * 2001件目以降が合計・グラフ・カレンダーから黙って落ちていた（2026-09-18・既知不具合 候補C）。
 * 期間で取得する新実装が、
 *   (1) 期間内の行を1件も取りこぼさない（SQL側の広め条件が、日付キーが期間内の行を必ず含む）
 *   (2) 日付キーの割り当て規則そのものは変えない
 * ことをここで固定する。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { test } from 'node:test';

import {
  createdAtBoundsForRange,
  dateKeyRangeForPeriod,
  daysInMonth,
  HISTORY_DATE_KEY_RANGE_WHERE_SQL,
  historyDateKeyRangeParams,
  isDateKeyInRange,
  matchesPeriod,
  monthDateKeyRange,
  rowToDateKey,
  shiftDateKey,
  toDateKey,
  yearDateKeyRange,
} from './history-date-core.ts';

// ─── 日付キー ───────────────────────────────────────────────────

test('rowToDateKey: entry_dateがあればそのまま。空文字・nullはcreated_atへフォールバック', () => {
  equal(rowToDateKey({ entry_date: '2024-03-15', created_at: '2026-09-18 03:00:00' }), '2024-03-15');
  const viaCreated = rowToDateKey({ entry_date: null, created_at: '2026-09-18 03:00:00' });
  equal(rowToDateKey({ entry_date: '', created_at: '2026-09-18 03:00:00' }), viaCreated);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(viaCreated));
});

test('rowToDateKey: created_atは「YYYY-MM-DD HH:MM:SS」（UTC）とISO「T…Z」を同じ時刻として扱う', () => {
  equal(
    rowToDateKey({ entry_date: null, created_at: '2026-09-18 03:00:00' }),
    rowToDateKey({ entry_date: null, created_at: '2026-09-18T03:00:00.000Z' }),
  );
});

test('rowToDateKey: created_atは端末ローカル日付になる（UTC日付と前後1日ずれ得る）', () => {
  // 2026-09-18 23:30 UTC は東京（+9）では 09-19、ロサンゼルス（-7）では 09-18
  const key = rowToDateKey({ entry_date: null, created_at: '2026-09-18 23:30:00' });
  const expected = toDateKey(new Date('2026-09-18T23:30:00Z'));
  equal(key, expected);
  ok(['2026-09-17', '2026-09-18', '2026-09-19'].includes(key));
});

// ─── 期間 ───────────────────────────────────────────────────────

test('monthDateKeyRange / yearDateKeyRange / daysInMonth', () => {
  deepEqual(monthDateKeyRange(2026, 2), { from: '2026-02-01', to: '2026-02-28' });
  deepEqual(monthDateKeyRange(2024, 2), { from: '2024-02-01', to: '2024-02-29' });
  deepEqual(monthDateKeyRange(2026, 12), { from: '2026-12-01', to: '2026-12-31' });
  deepEqual(yearDateKeyRange(2026), { from: '2026-01-01', to: '2026-12-31' });
  equal(daysInMonth(2026, 9), 30);
});

test('dateKeyRangeForPeriod: matchesPeriodが真になる日付キーを必ず含む', () => {
  const todayKey = '2026-09-18';
  const cases = [
    ['today', 2026, 9],
    ['month', 2026, 9],
    ['month', 2025, 2],
    ['year', 2026, 9],
    ['year', 2023, 1],
  ];
  const keys = ['2023-01-01', '2023-12-31', '2025-02-01', '2025-02-28', '2025-03-01', '2026-01-01', '2026-09-17', '2026-09-18', '2026-09-19', '2026-12-31', '2027-01-01'];
  for (const [period, y, m] of cases) {
    const range = dateKeyRangeForPeriod(period, y, m, todayKey);
    for (const key of keys) {
      if (matchesPeriod(key, period, y, m, todayKey)) ok(isDateKeyInRange(key, range), `${period} ${y}-${m} should include ${key}`);
      else ok(!isDateKeyInRange(key, range), `${period} ${y}-${m} should exclude ${key}`);
    }
  }
});

test('matchesPeriod（analytics.tsxから移動。挙動不変）', () => {
  equal(matchesPeriod('2026-09-18', 'today', 2026, 9, '2026-09-18'), true);
  equal(matchesPeriod('2026-09-17', 'today', 2026, 9, '2026-09-18'), false);
  equal(matchesPeriod('2026-09-01', 'month', 2026, 9, '2026-09-18'), true);
  equal(matchesPeriod('2026-08-31', 'month', 2026, 9, '2026-09-18'), false);
  equal(matchesPeriod('2026-01-01', 'year', 2026, 9, '2026-09-18'), true);
  equal(matchesPeriod('2025-12-31', 'year', 2026, 9, '2026-09-18'), false);
});

// ─── SQL側の広め条件 ───────────────────────────────────────────

test('shiftDateKey: 月末・年末・うるう日をまたぐ', () => {
  equal(shiftDateKey('2026-09-01', -1), '2026-08-31');
  equal(shiftDateKey('2026-12-31', 2), '2027-01-02');
  equal(shiftDateKey('2024-02-28', 1), '2024-02-29');
  equal(shiftDateKey('2026-01-01', -1), '2025-12-31');
});

test('createdAtBoundsForRange: from−1日 ≦ created_at ＜ to+2日（前後1日の余裕）', () => {
  deepEqual(createdAtBoundsForRange({ from: '2026-09-01', to: '2026-09-30' }), {
    from: '2026-08-31',
    toExclusive: '2026-10-02',
  });
  deepEqual(historyDateKeyRangeParams({ from: '2026-09-18', to: '2026-09-18' }), [
    '2026-09-18',
    '2026-09-18',
    '2026-09-17',
    '2026-09-20',
  ]);
  equal((HISTORY_DATE_KEY_RANGE_WHERE_SQL.match(/\?/g) ?? []).length, 4);
});

/**
 * SQLのWHERE句と同じ判定をJSで再現（文字列比較・bind順も同じ）。
 * 本物のSQLiteでの確認は開発ログ（2026-09-18）の`node:sqlite`再現に記録。
 */
function sqlWhereMirror(row, params) {
  const [entryFrom, entryTo, createdFrom, createdToEx] = params;
  const entry = row.entry_date ?? '';
  if (entry !== '') return entry >= entryFrom && entry <= entryTo;
  return row.created_at >= createdFrom && row.created_at < createdToEx;
}

test('広め条件は、日付キーが期間内の行を（端末のタイムゾーンによらず）必ず含む', () => {
  const range = monthDateKeyRange(2026, 9);
  const params = historyDateKeyRangeParams(range);
  // UTCの月境界前後を30分刻みで総当たり。どのTZでもローカル日付が9月なら必ずSQL側にも入る
  const stamps = [];
  for (const day of ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-30', '2026-10-01', '2026-10-02']) {
    for (let h = 0; h < 24; h++) for (const mi of ['00', '30']) stamps.push(`${day} ${String(h).padStart(2, '0')}:${mi}:00`);
  }
  let inRange = 0;
  for (const created_at of stamps) {
    const row = { entry_date: null, created_at };
    if (isDateKeyInRange(rowToDateKey(row), range)) {
      inRange++;
      ok(sqlWhereMirror(row, params), `created_at=${created_at} は期間内なのにSQL条件から漏れる`);
    }
  }
  ok(inRange > 0);
  // entry_dateは厳密一致。created_atが期間外でもentry_dateで期間内なら含む／その逆は含まない
  ok(sqlWhereMirror({ entry_date: '2026-09-15', created_at: '2020-01-01 00:00:00' }, params));
  ok(!sqlWhereMirror({ entry_date: '2026-10-15', created_at: '2026-09-15 00:00:00' }, params));
  ok(!sqlWhereMirror({ entry_date: '2026-08-31', created_at: '2026-09-15 00:00:00' }, params));
});

// ─── 2000件窓の再現（純ロジック） ────────────────────────────────

/** `created_at`が新しい順のN件。i番目はi日前（12:00 UTC）。全件購入済み100円 */
function makeRows(n) {
  const base = Date.UTC(2026, 8, 18, 12);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base - i * 86_400_000);
    return {
      id: i + 1,
      entry_date: null,
      created_at: d.toISOString().replace('T', ' ').slice(0, 19),
      is_purchased: 1,
      jpy_amount: 100,
    };
  });
}
/** 旧実装：`ORDER BY created_at DESC LIMIT 2000` */
const oldWindow = (rows) => rows.slice(0, 2000);
/** 新実装：期間に入り得る行（SQL広め条件）→ 画面側で`rowToDateKey`厳密絞り込み */
const newFetch = (rows, range) => rows.filter((r) => sqlWhereMirror(r, historyDateKeyRangeParams(range)));
const sumInRange = (rows, range) => rows.filter((r) => isDateKeyInRange(rowToDateKey(r), range)).reduce((s, r) => s + r.jpy_amount, 0);

test('2000件窓：1999／2000件は一致、2001／2500件で旧実装だけ古い側が欠ける（分析の合計・カレンダー）', () => {
  // 全期間（旧実装が「全件」のつもりで集計していた範囲）を年の集合として合計する
  const allYears = (rows) => {
    const years = new Set(rows.map((r) => rowToDateKey(r).slice(0, 4)));
    return [...years].reduce((s, y) => s + sumInRange(rows, yearDateKeyRange(Number(y))), 0);
  };
  const fetchAllYears = (rows) => {
    const years = new Set(rows.map((r) => rowToDateKey(r).slice(0, 4)));
    return [...years].reduce((s, y) => s + sumInRange(newFetch(rows, yearDateKeyRange(Number(y))), yearDateKeyRange(Number(y))), 0);
  };
  for (const n of [0, 1, 10, 1999, 2000]) {
    const rows = makeRows(n);
    equal(allYears(oldWindow(rows)), n * 100, `old n=${n}`);
    equal(fetchAllYears(rows), n * 100, `new n=${n}`);
  }
  for (const [n, missing] of [[2001, 1], [2500, 500]]) {
    const rows = makeRows(n);
    equal(allYears(oldWindow(rows)), (n - missing) * 100, `old n=${n} は${missing}件分欠ける`);
    equal(fetchAllYears(rows), n * 100, `new n=${n} は欠けない`);
  }
});

test('2000件窓：2500件中、最古の日（2001件目以降）はカレンダー（月範囲）で旧実装だけ見えない', () => {
  const rows = makeRows(2500);
  const oldest = rows[2499];
  const oldestKey = rowToDateKey(oldest);
  const [y, m] = oldestKey.split('-').map(Number);
  const range = monthDateKeyRange(y, m);
  const visibleOld = oldWindow(rows).filter((r) => rowToDateKey(r) === oldestKey);
  const visibleNew = newFetch(rows, range).filter((r) => rowToDateKey(r) === oldestKey);
  equal(visibleOld.length, 0);
  equal(visibleNew.length, 1);
  equal(visibleNew[0].id, oldest.id);
});

test('2000件窓：切り落としはcreated_at順・表示はentry_date優先なので、旧実装は「古い記録が消え、日付を古くした最近の記録は残る」', () => {
  const rows = makeRows(2001);
  // 最新の記録の日付を、最古の記録と同じ日に直した（entry_date）
  const backdated = { ...rows[0], entry_date: rowToDateKey(rows[2000]) };
  const all = [backdated, ...rows.slice(1)];
  const targetKey = backdated.entry_date;
  const [y, m] = targetKey.split('-').map(Number);
  const range = monthDateKeyRange(y, m);
  const oldIds = oldWindow(all).filter((r) => rowToDateKey(r) === targetKey).map((r) => r.id);
  const newIds = newFetch(all, range).filter((r) => rowToDateKey(r) === targetKey).map((r) => r.id).sort((a, b) => a - b);
  deepEqual(oldIds, [backdated.id]); // 旧：日付を直した最近の記録だけ残り、本当に古い記録は消える
  deepEqual(newIds, [backdated.id, rows[2000].id]); // 新：両方見える
});

test('sort順：新実装の取得はcreated_at降順のまま（SQLのORDER BYと同じ前提で、絞り込みは順序を変えない）', () => {
  const rows = makeRows(2500);
  const fetched = newFetch(rows, yearDateKeyRange(2026));
  for (let i = 1; i < fetched.length; i++) ok(fetched[i - 1].created_at >= fetched[i].created_at);
});

test('空・少量データ：期間外なら空、期間内の少量はそのまま', () => {
  deepEqual(newFetch([], monthDateKeyRange(2026, 9)), []);
  const rows = makeRows(3);
  equal(newFetch(rows, monthDateKeyRange(2026, 9)).length, 3);
  equal(newFetch(rows, monthDateKeyRange(2020, 1)).length, 0);
});
