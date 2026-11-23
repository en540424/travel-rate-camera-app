import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildFixtureDb, FIXTURE, fixtureDates, pastTripDate } from './build-fixture-db.mjs';
import { openExpoSqliteCompat } from '../../engine/fixtures/expo-sqlite-node.mjs';

test('fixture: アプリ本体のmigrationで最新版のDBを作り、見本の記録が旅行に入る', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabirate-fixture-'));
  const file = path.join(dir, 'travelrate.db');
  const r = await buildFixtureDb(file);
  assert.equal(r.records, FIXTURE.records.length);
  assert.ok(r.userVersion >= 7, `user_version ${r.userVersion}`);
  const db = openExpoSqliteCompat(file);
  const trip = await db.getFirstAsync('SELECT * FROM trips WHERE id = ?', r.tripId);
  assert.equal(trip.is_active, 1);
  assert.equal(trip.base_currency, 'EUR');
  const dated = await db.getAllAsync('SELECT entry_date FROM conversion_history WHERE entry_date IS NOT NULL AND trip_id = ?', r.tripId);
  assert.equal(dated.length, FIXTURE.records.length);
  // 終了した旅行（旅行一覧の撮影用）：アプリの archiveTrip で終了済み・使用中ではない・記録あり
  const past = await db.getAllAsync('SELECT * FROM trips WHERE id <> ? ORDER BY id', r.tripId);
  assert.deepEqual(past.map((t) => t.name), FIXTURE.pastTrips.map((p) => p.trip.name));
  for (const t of past) {
    assert.ok(t.archived_at, `${t.name} は終了済み`);
    assert.equal(t.is_active, 0);
    const n = await db.getFirstAsync('SELECT COUNT(*) AS n FROM conversion_history WHERE trip_id = ?', t.id);
    assert.ok(n.n > 0);
  }
  const live = await db.getAllAsync('SELECT id FROM trips WHERE archived_at IS NULL');
  assert.deepEqual(live.map((x) => x.id), [r.tripId], '記録中の旅行は1件（無料版の境界の内側）');
  await db.closeAsync();
  assert.equal(fs.existsSync(`${file}-wal`), false, '1ファイルで持ち運べる');
  await assert.rejects(() => buildFixtureDb(file), /上書きしません/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('fixture: 記録の日付は撮影する日の月に入る（月が変わってもカレンダーが空にならない）', async () => {
  const sameMonth = (dates, y, m) => dates.every((d) => d.startsWith(`${y}-${String(m).padStart(2, '0')}-`));
  // 月の半ば：今日を最後に、4日前から
  const mid = fixtureDates(new Date(2026, 10, 23));
  assert.deepEqual([mid[0], mid.at(-1)], ['2026-11-19', '2026-11-23']);
  // 月初（前月にはみ出す日）：基準を後ろへずらして当月に収める
  for (const [y, m, d] of [[2026, 12, 2], [2027, 1, 1], [2027, 3, 4]]) {
    const dates = fixtureDates(new Date(y, m - 1, d));
    assert.ok(sameMonth(dates, y, m), `${y}-${m}-${d}: ${dates.join(',')}`);
    assert.equal(dates[0], `${y}-${String(m).padStart(2, '0')}-01`);
  }
  // 月末
  assert.ok(sameMonth(fixtureDates(new Date(2027, 1, 28)), 2027, 2));
  // DB に入る日付も同じ
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabirate-fixture-'));
  try {
    const today = new Date(2026, 11, 2);
    const r = await buildFixtureDb(path.join(dir, 't.db'), { today });
    assert.deepEqual([r.from, r.to], ['2026-12-01', '2026-12-05']);
    const db = openExpoSqliteCompat(path.join(dir, 't.db'));
    const rows = await db.getAllAsync('SELECT entry_date FROM conversion_history WHERE trip_id = ? ORDER BY id', r.tripId);
    const others = await db.getAllAsync('SELECT entry_date FROM conversion_history WHERE trip_id <> ?', r.tripId);
    await db.closeAsync();
    assert.deepEqual(rows.map((x) => String(x.entry_date).slice(0, 10)), fixtureDates(today));
    // 終了した旅行の記録は当月に入らない（カレンダーの当月を変えない）
    assert.ok(others.length > 0 && others.every((x) => !String(x.entry_date).startsWith('2026-12-')), others.map((x) => x.entry_date).join(','));
    assert.equal(pastTripDate(new Date(2027, 0, 15), 2, 10), '2026-11-10', '年をまたぐ');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
