import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildFixtureDb, FIXTURE } from './build-fixture-db.mjs';
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
  const dated = await db.getAllAsync('SELECT entry_date FROM conversion_history WHERE entry_date IS NOT NULL');
  assert.equal(dated.length, FIXTURE.records.length);
  await db.closeAsync();
  assert.equal(fs.existsSync(`${file}-wal`), false, '1ファイルで持ち運べる');
  await assert.rejects(() => buildFixtureDb(file), /上書きしません/);
  fs.rmSync(dir, { recursive: true, force: true });
});
