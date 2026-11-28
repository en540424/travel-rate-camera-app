/**
 * GX-06 段階 a：記録の基準通貨の読み出し（設計書 `design/gx05-home-currency-design.md` §11 C1・C3・C5 の B1・§13）。
 *
 * 本物の `migrateDatabase`（src/db/schema.ts）と `history.ts` の4関数を node:sqlite の上で実行し、
 * 変更前と同じ素の `SELECT *`（同じ WHERE・ORDER・LIMIT）と比べる：
 *   - 件数・並び・元の列の名前と順・値（特に `id`・`created_at`・`updated_at`）が同じ
 *   - 増えるのは末尾の `home_currency` の1列だけ
 *   - `home_currency` は旅行の `target_currency`（7通貨に無い値・空文字・旅行なし・旅行が見つからない記録は 'JPY'）
 * 旅行の id・日時と記録の id・日時はわざとずらす（JOIN で記録の列が旅行の値に化ける退行を見逃さないため）。
 */
import { deepEqual, equal, ok } from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

globalThis.__DEV__ = false; // history.ts → config/limits → feature-flags が読み込み時に __DEV__ を読む
register('../../lib/proplus/ts-resolve-hook.mjs', import.meta.url);
const { openExpoSqliteCompat } = await import('../../../tools/store-assets/engine/fixtures/expo-sqlite-node.mjs');
const { migrateDatabase } = await import('../schema.ts');
const H = await import('./history.ts');
const T = await import('./trips.ts');
const C = await import('../../utils/home-currency-core.ts');

async function setup() {
  const db = openExpoSqliteCompat(':memory:');
  await migrateDatabase(db);
  // 旅行を先に6件作る（記録の id と旅行の id をずらす）。基準通貨は生の UPDATE で入れる（書く経路はまだ無い）
  const homes = ['JPY', 'USD', '', 'XYZ', 'jpy', 'KRW', 'EUR'];
  const tripIds = [];
  for (let i = 0; i < homes.length; i++) {
    const id = await T.insertTrip(db, { name: `t${i}`, budget_jpy: 1000, base_currency: 'USD', manual_rate: 150 });
    tripIds.push(id);
  }
  for (let i = 0; i < homes.length; i++) {
    if (homes[i] !== 'JPY') await db.runAsync('UPDATE trips SET target_currency = ? WHERE id = ?', homes[i], tripIds[i]);
    await db.runAsync(
      "UPDATE trips SET created_at = ?, updated_at = ? WHERE id = ?",
      `2020-01-0${i + 1} 00:00:00`, `2020-02-0${i + 1} 00:00:00`, tripIds[i],
    );
  }
  // 最後の旅行（EUR）は終了（アーカイブ）する。終了した旅行の記録も、その旅行の基準通貨で読む（旅行なし扱いにしない）
  await T.archiveTrip(db, tripIds[6]);
  // 記録：各旅行・旅行なし（NULL）・存在しない旅行（999）・終了した旅行
  const recordTrips = [tripIds[1], tripIds[0], null, tripIds[2], tripIds[3], 999, tripIds[4], tripIds[5], tripIds[1], tripIds[0], tripIds[6], tripIds[6]];
  for (let i = 0; i < recordTrips.length; i++) {
    await H.insertHistory(db, { currency: 'USD', foreign_amount: 10 + i, jpy_amount: 1500 + i * 150.5, rate_used: 150, trip_id: recordTrips[i] });
  }
  // 記録の日時を旅行と違う値にする。並びの退行（id 順など）を拾うため、created_at は id と逆向きにし、同じ値の組も混ぜる。
  // entry_date を持つ行も入れる（範囲の条件の entry_date の枝を通すため）
  const recs = await db.getAllAsync('SELECT id FROM conversion_history ORDER BY id');
  for (let i = 0; i < recs.length; i++) {
    const day = String(Math.max(10, 28 - i - (i % 4 === 1 ? 1 : 0))).padStart(2, '0');
    await db.runAsync(
      'UPDATE conversion_history SET created_at = ?, updated_at = ? WHERE id = ?',
      `2026-11-${day} 12:00:00`, i % 3 === 0 ? null : `2026-12-${day} 08:00:00`, recs[i].id,
    );
    if (i % 5 === 2) await db.runAsync('UPDATE conversion_history SET entry_date = ? WHERE id = ?', `2027-01-${day}`, recs[i].id);
  }
  const expectedHome = new Map(
    (await db.getAllAsync('SELECT id, trip_id FROM conversion_history')).map((r) => {
      const idx = tripIds.indexOf(r.trip_id);
      const home = idx < 0 ? 'JPY' : ({ JPY: 'JPY', USD: 'USD', '': 'JPY', XYZ: 'JPY', jpy: 'JPY', KRW: 'KRW', EUR: 'EUR' })[homes[idx]];
      return [r.id, home];
    }),
  );
  return { db, tripIds, expectedHome };
}

/** 新しい行 = 素の行 + 末尾の home_currency。元の列の名前・順・値が同じことを確かめる */
function assertSameRowsPlusHome(actual, plain, expectedHome) {
  equal(actual.length, plain.length);
  for (let i = 0; i < plain.length; i++) {
    const a = actual[i];
    const p = plain[i];
    deepEqual(Object.keys(a), [...Object.keys(p), 'home_currency']);
    for (const k of Object.keys(p)) ok(Object.is(a[k], p[k]), `列 ${k} が変わった：${a[k]} ≠ ${p[k]}`);
    equal(a.home_currency, expectedHome.get(p.id));
  }
}

test('getHistory：素の SELECT * と同じ行・列＋末尾の home_currency（id・日時は記録の値のまま）', async () => {
  const { db, expectedHome } = await setup();
  for (const limit of [50, 3, 1]) {
    const plain = await db.getAllAsync('SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT ?', limit);
    assertSameRowsPlusHome(await H.getHistory(db, limit), plain, expectedHome);
  }
  // 既定の上限（50）
  assertSameRowsPlusHome(
    await H.getHistory(db),
    await db.getAllAsync('SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT 50'),
    expectedHome,
  );
});

test('getHistoryById：記録の id で引ける（旅行の id と取り違えない）・無い id は null', async () => {
  const { db, tripIds, expectedHome } = await setup();
  const ids = (await db.getAllAsync('SELECT id FROM conversion_history ORDER BY id')).map((r) => r.id);
  for (const id of ids) {
    const plain = await db.getFirstAsync('SELECT * FROM conversion_history WHERE id = ?', id);
    assertSameRowsPlusHome([await H.getHistoryById(db, id)], [plain], expectedHome);
  }
  equal(await H.getHistoryById(db, 12345), null);
  // 旅行の id と同じ数の記録の id が、その旅行ではなく記録自身を返す
  for (const tid of tripIds) {
    const row = await H.getHistoryById(db, tid);
    if (row) equal(row.id, tid);
  }
});

test('getHistoryInDateKeyRange：無修飾の created_at・entry_date が記録の表に解決される（素の SELECT と同じ）', async () => {
  const { db, expectedHome } = await setup();
  const { HISTORY_DATE_KEY_RANGE_WHERE_SQL, historyDateKeyRangeParams } = await import('../../utils/history-date-core.ts');
  // 旅行の created_at（2020年）に掛かる範囲・記録に掛かる範囲・一部だけの範囲
  for (const range of [
    { from: '2026-11-01', to: '2026-12-31' },
    { from: '2026-11-20', to: '2026-11-24' }, // 一部だけ掛かる
    { from: '2020-01-01', to: '2020-02-28' },
    { from: '2027-01-01', to: '2027-01-31' }, // entry_date だけが掛かる
  ]) {
    const plain = await db.getAllAsync(
      `SELECT * FROM conversion_history WHERE ${HISTORY_DATE_KEY_RANGE_WHERE_SQL} ORDER BY created_at DESC`,
      ...historyDateKeyRangeParams(range),
    );
    assertSameRowsPlusHome(await H.getHistoryInDateKeyRange(db, range), plain, expectedHome);
  }
  equal((await H.getHistoryInDateKeyRange(db, { from: '2020-01-01', to: '2020-02-28' })).length, 0);
  ok((await H.getHistoryInDateKeyRange(db, { from: '2027-01-01', to: '2027-01-31' })).length > 0);
});

test('getHistoryForTrip：旅行ごとに素の SELECT と同じ・基準通貨はその旅行の値', async () => {
  const { db, tripIds, expectedHome } = await setup();
  for (const tid of [...tripIds, 999, 4242]) {
    for (const limit of [50, 1]) {
      const plain = await db.getAllAsync(
        'SELECT * FROM conversion_history WHERE trip_id = ? ORDER BY created_at DESC LIMIT ?', tid, limit,
      );
      assertSameRowsPlusHome(await H.getHistoryForTrip(db, tid, limit), plain, expectedHome);
    }
  }
});

test('基準通貨の読み方：JPY・USD・KRW はそのまま、空文字・XYZ・小文字の jpy・旅行なし・旅行が見つからない記録は JPY', async () => {
  const { db, tripIds } = await setup();
  const rows = await H.getHistory(db, 500);
  const byTrip = (tid) => rows.filter((r) => r.trip_id === tid).map((r) => r.home_currency);
  deepEqual([...new Set(byTrip(tripIds[0]))], ['JPY']);
  deepEqual([...new Set(byTrip(tripIds[1]))], ['USD']);
  deepEqual(byTrip(tripIds[2]), ['JPY']); // 空文字（COALESCE を素通りする）
  deepEqual(byTrip(tripIds[3]), ['JPY']); // 7通貨に無い
  deepEqual(byTrip(tripIds[4]), ['JPY']); // 小文字
  deepEqual(byTrip(tripIds[5]), ['KRW']);
  deepEqual(byTrip(null), ['JPY']);
  deepEqual(byTrip(999), ['JPY']);
  deepEqual(byTrip(tripIds[6]), ['EUR', 'EUR']); // 終了した旅行
});

test('並び：created_at が id と逆向き・同じ値の行でも素の SELECT と同じ順', async () => {
  const { db, expectedHome } = await setup();
  const plain = await db.getAllAsync('SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT 50');
  const ids = plain.map((r) => r.id);
  ok(ids.some((id, i) => i > 0 && id > ids[i - 1]), 'id の降順と一致しないデータであること');
  ok(new Set(plain.map((r) => r.created_at)).size < plain.length, '同じ created_at の行があること');
  assertSameRowsPlusHome(await H.getHistory(db, 50), plain, expectedHome);
});

test('既存の利用者（旅行はすべて既定の JPY）：全記録が JPY と読まれ、元の列は変わらない', async () => {
  const db = openExpoSqliteCompat(':memory:');
  await migrateDatabase(db);
  const t1 = await T.insertTrip(db, { name: 'a', budget_jpy: 0, base_currency: 'KRW', manual_rate: 0.11 });
  const t2 = await T.insertTrip(db, { name: 'b', budget_jpy: 0, base_currency: 'JPY', manual_rate: 1 });
  equal((await db.getFirstAsync('SELECT COUNT(*) AS n FROM trips WHERE target_currency <> ?', 'JPY')).n, 0);
  await H.insertHistory(db, { currency: 'KRW', foreign_amount: 1000, jpy_amount: 110.00000000000001, rate_used: 0.11, trip_id: t1 });
  await H.insertHistory(db, { currency: 'JPY', foreign_amount: 1200.5, jpy_amount: 1200.5, rate_used: 1, trip_id: t2 });
  await H.insertHistory(db, { currency: 'USD', foreign_amount: 1, jpy_amount: 150, rate_used: 150, trip_id: null });
  const rows = await H.getHistory(db, 50);
  deepEqual(rows.map((r) => r.home_currency), ['JPY', 'JPY', 'JPY']);
  const plain = await db.getAllAsync('SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT 50');
  assertSameRowsPlusHome(rows, plain, new Map(plain.map((p) => [p.id, 'JPY'])));
});

test('読み出しは DB を書き換えない（記録・旅行の全列が読む前と同じ）', async () => {
  const { db, tripIds } = await setup();
  const before = JSON.stringify([
    await db.getAllAsync('SELECT * FROM conversion_history ORDER BY id'),
    await db.getAllAsync('SELECT * FROM trips ORDER BY id'),
  ]);
  await H.getHistory(db, 500);
  await H.getHistoryById(db, 1);
  await H.getHistoryInDateKeyRange(db, { from: '2026-11-01', to: '2026-12-31' });
  for (const tid of tripIds) await H.getHistoryForTrip(db, tid, 500);
  const after = JSON.stringify([
    await db.getAllAsync('SELECT * FROM conversion_history ORDER BY id'),
    await db.getAllAsync('SELECT * FROM trips ORDER BY id'),
  ]);
  equal(after, before);
  // 表に home_currency の列は増えていない（スキーマ変更なし）
  const cols = (await db.getAllAsync('PRAGMA table_info(conversion_history)')).map((c) => c.name);
  ok(!cols.includes('home_currency'));
});

test('normalizeHomeCurrency：7通貨だけを通し、他は JPY（Object の組み込みの名前も通さない）', () => {
  for (const c of ['JPY', 'USD', 'EUR', 'GBP', 'KRW', 'TWD', 'THB']) equal(C.normalizeHomeCurrency(c), c);
  for (const v of [null, undefined, '', ' ', 'jpy', 'Usd', 'USD ', ' USD', 'JPY\n', 'XYZ', 'CNY', 'toString', 'constructor', '__proto__', 'hasOwnProperty', 0, 1, true, {}, []]) {
    equal(C.normalizeHomeCurrency(v), 'JPY', String(v));
  }
});

test('Web：attachHomeCurrencyFromTrips は旅行から引き、見つからない・旅行なしは JPY。元の列の並びは変えない', () => {
  const rows = [
    { id: 1, trip_id: 10, jpy_amount: 1 },
    { id: 2, trip_id: null, jpy_amount: 2 },
    { id: 3, trip_id: 99, jpy_amount: 3 },
    { id: 4, trip_id: 11, jpy_amount: 4 },
    { id: 5, trip_id: 12, jpy_amount: 5, home_currency: 'USD' }, // 古い値は正規化して上書き
    { id: 6, trip_id: 0, jpy_amount: 6 },
  ];
  // id=0 の旅行（壊れた旅行の JSON の既定値）があっても、旅行なし（null）の記録はそれを引かない
  const trips = [{ id: 10, target_currency: 'USD' }, { id: 11, target_currency: '' }, { id: 12, target_currency: 'KRW' }, { id: 0, target_currency: 'EUR' }];
  const out = C.attachHomeCurrencyFromTrips(rows, trips);
  deepEqual(out.map((r) => r.home_currency), ['USD', 'JPY', 'JPY', 'JPY', 'KRW', 'EUR']);
  deepEqual(Object.keys(out[0]), ['id', 'trip_id', 'jpy_amount', 'home_currency']);
  deepEqual(Object.keys(out[4]), ['id', 'trip_id', 'jpy_amount', 'home_currency']);
  // 入力を書き換えない
  equal('home_currency' in rows[0], false);
});

test('Web：tripHomesFromJson は壊れた JSON・配列でない値を空にし、target_currency が無い旅行は JPY', () => {
  deepEqual(C.tripHomesFromJson(null), []);
  deepEqual(C.tripHomesFromJson(''), []);
  deepEqual(C.tripHomesFromJson('{'), []);
  deepEqual(C.tripHomesFromJson('{"id":1}'), []);
  deepEqual(C.tripHomesFromJson('[{"id":3,"target_currency":"EUR"},{"id":4},null]'), [
    { id: 3, target_currency: 'EUR' },
    { id: 4, target_currency: 'JPY' },
    { id: 0, target_currency: 'JPY' },
  ]);
});

test('Web：読み込み→付ける→更新→保存の1周で、保存する JSON に home_currency が入らない', () => {
  const stored = [
    { id: 1, currency: 'USD', foreign_amount: 1, jpy_amount: 150, rate_used: 150, trip_id: 10, is_purchased: 0, purchased_at: null, updated_at: null, created_at: 'x', memo: null, image_uri: null, entry_date: null, category: null },
  ];
  const shown = C.attachHomeCurrencyFromTrips(stored, [{ id: 10, target_currency: 'USD' }]);
  equal(shown[0].home_currency, 'USD');
  // 画面から来た行（home_currency つき）を誤って保存へ渡しても落ちる
  const edited = shown.map((r) => ({ ...r, memo: 'm' }));
  const json = JSON.stringify(edited.map(C.stripHomeCurrency));
  ok(!json.includes('home_currency'));
  deepEqual(JSON.parse(json)[0], { ...stored[0], memo: 'm' });
  // 列の並びも保存前と同じ
  deepEqual(Object.keys(JSON.parse(json)[0]), Object.keys(stored[0]));
});

test('範囲の一部だけが掛かる時も素の SELECT と同じ（空どうしの比較にしない）', async () => {
  const { db } = await setup();
  const n = (await H.getHistoryInDateKeyRange(db, { from: '2026-11-20', to: '2026-11-24' })).length;
  const all = (await H.getHistoryInDateKeyRange(db, { from: '2026-11-01', to: '2026-12-31' })).length;
  ok(n > 0 && n < all, `一部だけ：${n} / ${all}`);
});
