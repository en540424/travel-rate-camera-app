/**
 * GX-06 段階 c-2：旅行ごとの合計（設計書 `design/gx05-home-currency-design.md` §12-2 S7・S8・§13 の nit）。
 *
 * 本物の `migrateDatabase` と `history.ts` の `getBudgetTotalsByTrip`・`getBudgetTotalsForTrip` を node:sqlite の上で実行し、
 *   - 基準通貨が0桁の旅行（JPY・KRW・TWD・7通貨に無い値＝JPY と読む値・旅行が見つからない記録）は、
 *     変更前の SQL（`BUDGET_GROUP_SQL` の写し）＋`budgetTotalsByTripFromGroupRows` と同じ値
 *   - 小数の基準通貨（USD・EUR・GBP・THB）の旅行は、1件ずつ丸めて最小単位で足した `sumMoney` と同じ値
 *     （終了済みの旅行・600件の旅行も含む。件数は SQL の COUNT と同じ）
 *   - `trip_id` が NULL の記録はどの旅行にも入らない・読み出しは DB を書き換えない
 *   - Web の純粋関数（`budgetTotalsByTripFromRows`・`budgetTotalsForHome`）は native と同じ値
 * を確かめる。
 */
import { deepEqual, equal, notDeepEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { test } from 'node:test';

globalThis.__DEV__ = false; // history.ts → config/limits → feature-flags が読み込み時に __DEV__ を読む
register('../../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const { openExpoSqliteCompat } = await import('../../../tools/store-assets/engine/fixtures/expo-sqlite-node.mjs');
const { migrateDatabase } = await import('../schema.ts');
const H = await import('./history.ts');
const T = await import('./trips.ts');
const B = await import('../../utils/budget-core.ts');
const C = await import('../../utils/home-currency-core.ts');
const M = await import('../../utils/money-core.ts');

/** 変更前の `history.ts` の `BUDGET_GROUP_SQL`（1文字も変えていないことは下のテストでソースと比べる） */
const OLD_BUDGET_GROUP_SQL = `
  SELECT trip_id, is_purchased, COUNT(*) AS count, SUM(ROUND(jpy_amount)) AS total
  FROM conversion_history`;

async function oldByTrip(db) {
  return B.budgetTotalsByTripFromGroupRows(
    await db.getAllAsync(`${OLD_BUDGET_GROUP_SQL} WHERE trip_id IS NOT NULL GROUP BY trip_id, is_purchased`),
  );
}
async function oldForTrip(db, tripId) {
  const rows = await db.getAllAsync(`${OLD_BUDGET_GROUP_SQL} WHERE trip_id = ? GROUP BY trip_id, is_purchased`, tripId);
  return B.budgetTotalsByTripFromGroupRows(rows).get(tripId) ?? { ...B.EMPTY_BUDGET_TOTALS };
}

/** JS の丸め・SQL の ROUND・浮動小数の足し算がずれる額を混ぜる */
const AMOUNTS = [
  1.005, 2.675, 1.115, 0.285, 0.1, 0.2, 0.3, 1500.5, 61.49999999999999, 33.335, 10, 0.005, 0.004999999999999999,
  12345.675, 99.995, 6.666666666666667, 0.015, 1e-9, 250.125,
];

/**
 * 旅行：基準通貨ごとに1件。'' 'usd' 'XYZ' は JPY と読む。終了済みの USD・記録の無い USD も作る。
 * 旅行の id と記録の id はずらす（取り違えの退行を拾う）
 */
async function setup({ homes }) {
  const db = openExpoSqliteCompat(':memory:');
  await migrateDatabase(db);
  const tripIds = [];
  for (let i = 0; i < homes.length; i++) {
    const id = await T.insertTrip(db, { name: `t${i}`, budget_jpy: 1000, base_currency: 'USD', manual_rate: 150 });
    tripIds.push(id);
    if (homes[i] !== 'JPY') await db.runAsync('UPDATE trips SET target_currency = ? WHERE id = ?', homes[i], id);
  }
  return { db, tripIds };
}

const HOMES = ['JPY', 'KRW', 'TWD', 'USD', 'EUR', 'GBP', 'THB', '', 'usd', 'XYZ', 'USD', 'USD'];
const ARCHIVED_IDX = 10; // 終了済みの USD
const EMPTY_IDX = 11; // 記録の無い USD

async function fill(db, tripIds) {
  // 記録の無い旅行（EMPTY_IDX）以外に、額を候補・購入済みに振り分けて入れる。旅行なし（NULL）と見つからない旅行（999）も
  const targets = [...tripIds.filter((_, i) => i !== EMPTY_IDX), null, 999];
  let n = 0;
  for (const tripId of targets) {
    for (let k = 0; k < AMOUNTS.length; k++) {
      await H.insertHistory(
        db,
        { currency: 'USD', foreign_amount: 1, jpy_amount: AMOUNTS[(k + n) % AMOUNTS.length], rate_used: 150, trip_id: tripId },
        undefined,
        undefined,
        (k + n) % 3 === 0,
      );
    }
    n += 1;
  }
  await T.archiveTrip(db, tripIds[ARCHIVED_IDX]);
}

async function snapshot(db) {
  return {
    h: await db.getAllAsync('SELECT * FROM conversion_history ORDER BY id'),
    t: await db.getAllAsync('SELECT * FROM trips ORDER BY id'),
  };
}

/** 期待値：小数の基準通貨の旅行は sumMoney（候補・購入済みそれぞれ） */
async function expectedFractional(db, tripId, home) {
  const rows = await db.getAllAsync('SELECT is_purchased, jpy_amount FROM conversion_history WHERE trip_id = ?', tripId);
  const cand = rows.filter((r) => r.is_purchased !== 1).map((r) => r.jpy_amount);
  const pur = rows.filter((r) => r.is_purchased === 1).map((r) => r.jpy_amount);
  return {
    candidateCount: cand.length,
    candidateTotalJpy: M.sumMoney(cand, home),
    purchasedCount: pur.length,
    purchasedTotalJpy: M.sumMoney(pur, home),
  };
}

test('BUDGET_GROUP_SQL は1文字も変えていない（ソースに変更前の文字列がそのままある）', () => {
  const src = readFileSync(new URL('./history.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(src.includes(`const BUDGET_GROUP_SQL = \`${OLD_BUDGET_GROUP_SQL}\`;`));
});

test('既存の利用者（旅行はすべて既定の JPY）：ByTrip・ForTrip とも変更前の SQL と同じ値', async () => {
  const { db, tripIds } = await setup({ homes: HOMES.map(() => 'JPY') });
  await fill(db, tripIds);
  deepEqual(await H.getBudgetTotalsByTrip(db), await oldByTrip(db));
  for (const id of [...tripIds, 999]) deepEqual(await H.getBudgetTotalsForTrip(db, id), await oldForTrip(db, id));
});

test('基準通貨が0桁の旅行（JPY・KRW・TWD・空文字・小文字・未知の通貨・見つからない旅行）は変更前の SQL の値のまま', async () => {
  const { db, tripIds } = await setup({ homes: HOMES });
  await fill(db, tripIds);
  const now = await H.getBudgetTotalsByTrip(db);
  const old = await oldByTrip(db);
  const zeroDigit = HOMES.map((h, i) => [h, tripIds[i]]).filter(([h]) => C.fractionalHomeCurrency(h) == null);
  equal(zeroDigit.length, 6);
  for (const [, id] of [...zeroDigit, ['?', 999]]) {
    deepEqual(now.get(id), old.get(id));
    deepEqual(await H.getBudgetTotalsForTrip(db, id), await oldForTrip(db, id));
  }
});

test('小数の基準通貨（USD・EUR・GBP・THB・終了済みの USD）は sumMoney と同じ値・件数は SQL の COUNT と同じ・SQL の ROUND とは違う', async () => {
  const { db, tripIds } = await setup({ homes: HOMES });
  await fill(db, tripIds);
  const now = await H.getBudgetTotalsByTrip(db);
  const old = await oldByTrip(db);
  for (const i of [3, 4, 5, 6, ARCHIVED_IDX]) {
    const id = tripIds[i];
    const expected = await expectedFractional(db, id, HOMES[i]);
    deepEqual(now.get(id), expected);
    deepEqual(await H.getBudgetTotalsForTrip(db, id), expected);
    equal(expected.candidateCount, old.get(id).candidateCount);
    equal(expected.purchasedCount, old.get(id).purchasedCount);
    notDeepEqual(expected, old.get(id)); // 整数へ丸める SQL の値を使っていない
    // 最小単位で足した値は2桁の10進で表せる（浮動小数の足し算の誤差 0.30000000000000004 のような値にならない）
    for (const v of [expected.candidateTotalJpy, expected.purchasedTotalJpy]) equal(v, Number(v.toFixed(2)));
  }
});

test('具体値：USD の旅行で 1.005＋2.675＋0.1＋0.2 は 3.99（1.01＋2.68＋0.10＋0.20。SQL の ROUND(x,2) なら 3.97、変更前の SQL〈整数へ丸める〉なら 4）', async () => {
  const { db, tripIds } = await setup({ homes: ['USD'] });
  for (const a of [1.005, 2.675, 0.1, 0.2]) {
    await H.insertHistory(db, { currency: 'USD', foreign_amount: a, jpy_amount: a, rate_used: 1, trip_id: tripIds[0] }, undefined, undefined, true);
  }
  const t = await H.getBudgetTotalsForTrip(db, tripIds[0]);
  equal(t.purchasedTotalJpy, 3.99);
  equal(t.purchasedCount, 4);
  equal((await oldForTrip(db, tripIds[0])).purchasedTotalJpy, 4);
  const sqlRound2 = await db.getFirstAsync('SELECT SUM(ROUND(jpy_amount, 2)) AS s FROM conversion_history');
  ok(Math.abs(sqlRound2.s - 3.97) < 1e-9);
});

test('上限なし：USD の旅行に 600件あっても全件が合計に入る（表示用の 500件の上限で落ちない）', async () => {
  const { db, tripIds } = await setup({ homes: ['USD'] });
  const amounts = [];
  for (let i = 0; i < 600; i++) {
    const a = AMOUNTS[i % AMOUNTS.length] + i;
    amounts.push(a);
    await H.insertHistory(db, { currency: 'USD', foreign_amount: 1, jpy_amount: a, rate_used: 1, trip_id: tripIds[0] });
  }
  const t = await H.getBudgetTotalsForTrip(db, tripIds[0]);
  equal(t.candidateCount, 600);
  equal(t.candidateTotalJpy, M.sumMoney(amounts, 'USD'));
  deepEqual((await H.getBudgetTotalsByTrip(db)).get(tripIds[0]), t);
});

test('trip_id が NULL の記録はどの旅行にも入らない・記録の無い USD の旅行は ByTrip に出ず ForTrip は 0', async () => {
  const { db, tripIds } = await setup({ homes: HOMES });
  await fill(db, tripIds);
  const now = await H.getBudgetTotalsByTrip(db);
  ok(!now.has(null));
  ok(!now.has(tripIds[EMPTY_IDX]));
  deepEqual(await H.getBudgetTotalsForTrip(db, tripIds[EMPTY_IDX]), B.EMPTY_BUDGET_TOTALS);
  // 存在しない旅行 id（記録も無い）は 0
  deepEqual(await H.getBudgetTotalsForTrip(db, 123456), B.EMPTY_BUDGET_TOTALS);
  // 旅行ごとの件数の和＝trip_id のある記録の件数（どの記録も1つの旅行にだけ入る）
  let sum = 0;
  for (const t of now.values()) sum += t.candidateCount + t.purchasedCount;
  equal(sum, (await db.getFirstAsync('SELECT COUNT(*) AS c FROM conversion_history WHERE trip_id IS NOT NULL')).c);
});

test('読み出しは DB を書き換えない（記録・旅行の全列が読む前と同じ）', async () => {
  const { db, tripIds } = await setup({ homes: HOMES });
  await fill(db, tripIds);
  const before = await snapshot(db);
  await H.getBudgetTotalsByTrip(db);
  for (const id of tripIds) await H.getBudgetTotalsForTrip(db, id);
  deepEqual(await snapshot(db), before);
});

test('Web：budgetTotalsByTripFromRows・budgetTotalsForHome は native と同じ値', async () => {
  const { db, tripIds } = await setup({ homes: HOMES });
  await fill(db, tripIds);
  const rows = await db.getAllAsync('SELECT * FROM conversion_history ORDER BY id');
  const trips = await db.getAllAsync('SELECT id, target_currency FROM trips ORDER BY id');
  deepEqual(C.budgetTotalsByTripFromRows(rows, trips), await H.getBudgetTotalsByTrip(db));
  for (const id of tripIds) {
    const tripRows = rows.filter((r) => r.trip_id === id);
    const home = C.homeCurrencyOfTrip(id, trips);
    deepEqual(C.budgetTotalsForHome(tripRows, home), await H.getBudgetTotalsForTrip(db, id));
  }
});

test('Web：基準通貨がすべて JPY なら budgetTotalsByTripFromRows は変更前の Web のコード（1行ずつ Math.round）と同じ', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    rows.push({ trip_id: i % 7 === 0 ? null : (i % 5) + 1, is_purchased: i % 3 === 0 ? 1 : 0, jpy_amount: AMOUNTS[i % AMOUNTS.length] * (i + 1) });
  }
  rows.push({ trip_id: 2, is_purchased: 0, jpy_amount: Number.NaN }, { trip_id: 3, is_purchased: 1, jpy_amount: Infinity });
  const trips = [1, 2, 3, 4, 5].map((id) => ({ id, target_currency: id === 4 ? 'XYZ' : 'JPY' }));
  const oldWeb = B.budgetTotalsByTripFromGroupRows(
    rows.map((r) => ({ trip_id: r.trip_id, is_purchased: r.is_purchased, count: 1, total: Number.isFinite(r.jpy_amount) ? Math.round(r.jpy_amount) : 0 })),
  );
  deepEqual(C.budgetTotalsByTripFromRows(rows, trips), oldWeb);
  for (const id of [1, 2, 3, 4, 5]) {
    deepEqual(C.budgetTotalsForHome(rows.filter((r) => r.trip_id === id), C.homeCurrencyOfTrip(id, trips)), oldWeb.get(id));
  }
});

test('Web：同じ id が重なった壊れた旅行の一覧では後の旅行の基準通貨を使う（記録の home_currency と同じ向き）', () => {
  const trips = [{ id: 1, target_currency: 'JPY' }, { id: 1, target_currency: 'USD' }];
  const rows = [{ trip_id: 1, is_purchased: 0, jpy_amount: 1.005 }];
  equal(C.homeCurrencyOfTrip(1, trips), 'USD');
  equal(C.attachHomeCurrencyFromTrips(rows, trips)[0].home_currency, 'USD');
  equal(C.budgetTotalsByTripFromRows(rows, trips).get(1).candidateTotalJpy, 1.01);
  equal(C.homeCurrencyOfTrip(null, trips), 'JPY');
  equal(C.homeCurrencyOfTrip(2, trips), 'JPY');
});

test('fractionalHomeCurrency：USD・EUR・GBP・THB だけを返し、0桁と JPY と読む値は null', () => {
  for (const h of ['USD', 'EUR', 'GBP', 'THB']) equal(C.fractionalHomeCurrency(h), h);
  for (const h of ['JPY', 'KRW', 'TWD', '', 'usd', 'XYZ', null, undefined, 3, 'toString', '__proto__']) {
    equal(C.fractionalHomeCurrency(h), null);
  }
});

test('残り予算：units を渡すと最小単位で引く（1000.15 − 333.05 = 667.10）・未指定と0桁の基準通貨は今の式のまま', () => {
  const totals = { candidateCount: 0, candidateTotalJpy: 0, purchasedCount: 1, purchasedTotalJpy: 33.41 };
  const t2 = { ...totals, purchasedTotalJpy: 333.05 };
  equal(1000.15 - 333.05, 667.0999999999999); // 今の式は浮動小数の誤差が出る
  equal(B.computeBudgetStatsFromTotals(t2, 1000.15, C.budgetUnitsForHome('USD')).remainingBudget, 667.1);
  equal(B.computeBudgetStatsFromTotals(t2, 1000.15).remainingBudget, 1000.15 - 333.05);
  equal(C.budgetUnitsForHome('JPY'), undefined);
  equal(C.budgetUnitsForHome('KRW'), undefined);
  equal(C.budgetUnitsForHome(undefined), undefined);
  // 0 で止める（購入済みが予算を超えても負にしない）
  equal(B.computeBudgetStatsFromTotals({ ...totals, purchasedTotalJpy: 200.01 }, 100.1, C.budgetUnitsForHome('EUR')).remainingBudget, 0);
  // 円の旅行：units 未指定の値は変更前の式と同じ（格子）
  for (let b = 0; b < 3000; b += 37) {
    for (const p of [0, 1, 1500, 2999, 3001]) {
      const t = { ...totals, purchasedTotalJpy: p };
      deepEqual(B.computeBudgetStatsFromTotals(t, b, C.budgetUnitsForHome('JPY')), {
        candidateCount: 0, candidateTotalJpy: 0, purchasedTotalJpy: p, remainingBudget: Math.max(0, b - p),
      });
    }
  }
});

test('sumBudgetTotalsInMinorUnits：有限でない額は 0・is_purchased の null は候補（sumBudgetTotals と同じ分け方）', () => {
  const rows = [
    { jpy_amount: Number.NaN, is_purchased: 1 },
    { jpy_amount: 1.005, is_purchased: null },
    { jpy_amount: 2.675 },
    { jpy_amount: Infinity, is_purchased: 0 },
  ];
  deepEqual(B.sumBudgetTotalsInMinorUnits(rows, C.minorUnitsFor('USD')), {
    candidateCount: 3, candidateTotalJpy: 3.69, purchasedCount: 1, purchasedTotalJpy: 0,
  });
  const jpy = B.sumBudgetTotals(rows);
  const minor = B.sumBudgetTotalsInMinorUnits(rows, C.minorUnitsFor('JPY'));
  equal(minor.candidateCount, jpy.candidateCount);
  equal(minor.purchasedCount, jpy.purchasedCount);
});

test('配線：native の3画面は旅行の基準通貨を残り予算へ渡す・Web の集計は新しい関数を通る', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const p of ['../../app/(tabs)/index.tsx', '../../app/(tabs)/history/index.tsx', '../../app/(tabs)/settings.tsx']) {
    ok(read(p).includes('getTripStatsForDisplay(budgetTotals, tripBudgetJpy, activeTrip?.id, activeTrip?.target_currency)'), p);
  }
  ok(read('../../hooks/use-all-history.web.ts').includes('budgetTotalsByTripFromRows(rows, trips)'));
  ok(!read('../../hooks/use-all-history.web.ts').includes('Math.round(r.jpy_amount)'));
  ok(read('../../hooks/use-history.web.ts').includes('budgetTotalsForHome(rows, homeCurrencyOfTrip(activeTrip.id, tripHomes))'));
  ok(read('../../utils/trip-stats.ts').includes('budgetTotalsForHome(rows, home), budgetJpy, budgetUnitsForHome(home)'));
  // 旅行一覧・切替シートの残り予算も旅行の基準通貨の units を渡す（db-guardian should-fix 2）
  const list = read('../../app/trip-list.tsx');
  ok(list.includes('computeBudgetStatsFromTotals(s, active.budget_jpy, budgetUnitsForHome(active.target_currency))'));
  ok(list.includes('computeBudgetStatsFromTotals(s, t.budget_jpy, budgetUnitsForHome(t.target_currency))'));
  ok(read('../../components/domain/ActiveTripSwitchSheet.tsx').includes('computeBudgetStatsFromTotals(totals, t.budget_jpy, budgetUnitsForHome(t.target_currency))'));
  // computeBudgetStatsFromTotals を units 無しで呼ぶ画面が残っていない（src/app・src/components を全数）
});

test('全数：src/app・src/components で computeBudgetStatsFromTotals を呼ぶ所はすべて units（第3引数）を渡す', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e) && !/\.test\./.test(e)) files.push(p);
    }
  };
  walk(join(root, 'app'));
  walk(join(root, 'components'));
  let calls = 0;
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/computeBudgetStatsFromTotals\(([^;]*?)\)\.remainingBudget/g)) {
      calls += 1;
      ok(m[1].includes('budgetUnitsForHome('), `${f}: ${m[0]}`);
    }
  }
  equal(calls, 3);
});

test('is_purchased が 2 の壊れた行・負の額：0桁の基準通貨は変更前の SQL のまま・小数の基準通貨は sumMoney と同じ', async () => {
  const { db, tripIds } = await setup({ homes: ['JPY', 'KRW', 'USD'] });
  for (const id of tripIds) {
    for (const [a, p] of [[-0.5, 0], [-1.005, 1], [2.5, 0], [-2.675, 0], [10.125, 1]]) {
      await H.insertHistory(db, { currency: 'USD', foreign_amount: 1, jpy_amount: a, rate_used: 1, trip_id: id }, undefined, undefined, p === 1);
    }
  }
  // is_purchased が 2 の壊れた行も、SQL（budgetTotalsByTripFromGroupRows）と同じく候補に数える（列は NOT NULL なので NULL は入らない）
  for (const id of tripIds) {
    await db.runAsync('INSERT INTO conversion_history (currency, foreign_amount, jpy_amount, rate_used, trip_id, is_purchased) VALUES (?, ?, ?, ?, ?, 2)', 'USD', 1, 3.335, 1, id);
  }
  const now = await H.getBudgetTotalsByTrip(db);
  const old = await oldByTrip(db);
  deepEqual(now.get(tripIds[0]), old.get(tripIds[0]));
  deepEqual(now.get(tripIds[1]), old.get(tripIds[1]));
  deepEqual(now.get(tripIds[2]), await expectedFractional(db, tripIds[2], 'USD'));
  // 小数の基準通貨の負の額は 0 から遠い向き（-1.005 → -1.01）。負の額は保存の経路では作られない（money-core の注記）
  equal(now.get(tripIds[2]).purchasedTotalJpy, M.sumMoney([-1.005, 10.125], 'USD'));
});

/** SQL と JS の丸めが分かれる値（Fable SF1）：ROUND(0.49999999999999994)=1・toMinorUnits(…,'JPY')=0、Math.round(-0.5)=-0・toMinorUnits=-1 */
const SPLIT_VALUES = [0.49999999999999994, 2.5, 10, -0.5, -2.5, -1.5, 1.5, Infinity, -Infinity, 61.49999999999999];

test('SF1：丸めが分かれる値でも、0桁の基準通貨の旅行は変更前の SQL のまま（JS の最小単位で足す退行を拾う）', async () => {
  const { db, tripIds } = await setup({ homes: ['JPY', 'KRW', 'TWD', 'XYZ'] });
  for (const id of [...tripIds, 999]) {
    for (let k = 0; k < SPLIT_VALUES.length; k++) {
      await H.insertHistory(db, { currency: 'USD', foreign_amount: 1, jpy_amount: SPLIT_VALUES[k], rate_used: 1, trip_id: id }, undefined, undefined, k % 2 === 0);
    }
  }
  const now = await H.getBudgetTotalsByTrip(db);
  const old = await oldByTrip(db);
  deepEqual(now, old);
  for (const id of [...tripIds, 999]) {
    const t = await H.getBudgetTotalsForTrip(db, id);
    const o = await oldForTrip(db, id);
    for (const k of Object.keys(o)) ok(Object.is(t[k], o[k]), `${id} ${k}: ${t[k]} ≠ ${o[k]}`);
  }
  // 値そのものも固定する：0.49999999999999994・2.5・10 の旅行は SQL の ROUND で 1+3+10=14（JS の最小単位なら 0+3+10=13）
  const { db: db2, tripIds: ids2 } = await setup({ homes: ['JPY'] });
  for (const a of [0.49999999999999994, 2.5, 10]) {
    await H.insertHistory(db2, { currency: 'USD', foreign_amount: 1, jpy_amount: a, rate_used: 1, trip_id: ids2[0] });
  }
  equal((await H.getBudgetTotalsForTrip(db2, ids2[0])).candidateTotalJpy, 14); // JS の最小単位で足すと 13
});

test('SF1：Web の 0桁の基準通貨は丸めが分かれる値（負の .5・NaN・Infinity）でも変更前の Web のコードと同じ', () => {
  const rows = [];
  const values = [...SPLIT_VALUES, Number.NaN];
  for (let i = 0; i < 60; i++) rows.push({ trip_id: (i % 3) + 1, is_purchased: i % 2, jpy_amount: values[i % values.length] });
  const trips = [{ id: 1, target_currency: 'JPY' }, { id: 2, target_currency: 'KRW' }, { id: 3, target_currency: '' }];
  const oldWeb = B.budgetTotalsByTripFromGroupRows(
    rows.map((r) => ({ trip_id: r.trip_id, is_purchased: r.is_purchased, count: 1, total: Number.isFinite(r.jpy_amount) ? Math.round(r.jpy_amount) : 0 })),
  );
  const now = C.budgetTotalsByTripFromRows(rows, trips);
  for (const id of [1, 2, 3]) {
    for (const k of ['candidateCount', 'candidateTotalJpy', 'purchasedCount', 'purchasedTotalJpy']) {
      ok(Object.is(now.get(id)[k], oldWeb.get(id)[k]), `${id} ${k}: ${now.get(id)[k]} ≠ ${oldWeb.get(id)[k]}`);
    }
    const one = C.budgetTotalsForHome(rows.filter((r) => r.trip_id === id), C.homeCurrencyOfTrip(id, trips));
    const oldOne = B.sumBudgetTotals(rows.filter((r) => r.trip_id === id));
    for (const k of Object.keys(oldOne)) ok(Object.is(one[k], oldOne[k]), `${id} ${k}`);
  }
  // 負の .5 だけの旅行：Math.round(-0.5) は -0。最小単位（-1）に替える退行を拾う
  const neg = [{ trip_id: 1, is_purchased: 0, jpy_amount: -0.5 }, { trip_id: 1, is_purchased: 0, jpy_amount: -2.5 }];
  equal(C.budgetTotalsByTripFromRows(neg, trips).get(1).candidateTotalJpy, -2);
});

test('SF3：保存したら残り（remainingAfterSaving）は units で最小単位、未指定は今の式のまま', () => {
  equal(B.remainingAfterSaving(667.09, 12.34, C.budgetUnitsForHome('USD')), 654.75);
  equal(B.remainingAfterSaving(10, 12.34, C.budgetUnitsForHome('EUR')), 0);
  // 額は外貨×レートで2桁の格子の外が普通：1件を基準通貨の桁で丸めてから引く（12.345 → 12.35。引いてから丸めると 654.75）
  equal(B.remainingAfterSaving(667.09, 12.345, C.budgetUnitsForHome('USD')), 654.74);
  // 円の旅行：今の式 Math.max(0, remaining - Math.round(amount)) と Object.is で同じ（NaN・負・.5 を含む格子）
  const amounts = [0, 0.5, 1.5, 2.5, -0.5, 1200.5, 61.49999999999999, 0.49999999999999994, Number.NaN, Infinity];
  for (const r of [...Array.from({ length: 74 }, (_, i) => i * 41), 1000.5, 0.3, 61.49999999999999, 2999.995]) {
    for (const a of amounts) {
      for (const home of ['JPY', 'KRW', 'TWD', 'XYZ', undefined]) {
        ok(Object.is(B.remainingAfterSaving(r, a, C.budgetUnitsForHome(home)), Math.max(0, r - Math.round(a))), `${r} ${a} ${home}`);
      }
    }
  }
  // 配線：ホーム（native・Web）とも旅行の基準通貨を渡す
  for (const p of ['../../app/(tabs)/index.tsx', '../../app/(tabs)/index.web.tsx']) {
    const src = readFileSync(new URL(p, import.meta.url), 'utf8');
    ok(src.includes('remainingAfterSaving(stats.remainingBudget, jpyAmount, budgetUnitsForHome(activeTrip?.target_currency))'), p);
    ok(!src.includes('stats.remainingBudget - Math.round(jpyAmount)'), p);
  }
});

test('N1：小数の基準通貨の残り予算は、予算を先に基準通貨の桁で丸めてから引く（予算 100.005・購入済み 0.01 → 100）', () => {
  const totals = { candidateCount: 0, candidateTotalJpy: 0, purchasedCount: 1, purchasedTotalJpy: 0.01 };
  // 予算は基準通貨の額として画面に H の桁で出る（100.01）ので、その表示の値から引く
  equal(B.computeBudgetStatsFromTotals(totals, 100.005, C.budgetUnitsForHome('USD')).remainingBudget, 100);
});
