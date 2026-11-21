// シミュレーター撮影用のテストデータDBを作る。
//
//   node tools/store-assets/apps/tabirate/build-fixture-db.mjs [出力先.db]
//
// - アプリ本体のmigration（src/db/schema.ts の migrateDatabase）と保存関数（src/db/queries）をそのまま使う。
//   スキーマを手で書き写さないので、アプリのDBの版と食い違わない
// - 出力は新しいファイルだけ。既存のファイルがあれば上書きせずに止める
// - 中身は撮影用の見本（旅行1件・記録数件）。実在の店舗・利用者のデータは含まない
// - 使い道：profile.json の capture.ios.fixtureDb に指定すると、iOSシミュレーター撮影の手順がシミュレーター内のアプリへ入れる
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openExpoSqliteCompat } from '../../engine/fixtures/expo-sqlite-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
globalThis.__DEV__ = false;
register(pathToFileURL(path.join(HERE, 'alias-hooks.mjs')).href);

// 撮影の基準日（profile.json の capture.clock と同じ日）に合わせた見本
export const FIXTURE = {
  trip: { name: 'パリ旅行', budget_jpy: 150000, base_currency: 'EUR', manual_rate: 165 },
  records: [
    { foreign: 12.5, memo: 'マカロン 6個入り', category: 'food', purchased: true, date: '2026-11-17' },
    { foreign: 38, memo: '紅茶の缶 3種セット', category: 'souvenir', purchased: true, date: '2026-11-17' },
    { foreign: 89, memo: 'ストール', category: 'clothing', purchased: false, date: '2026-11-18' },
    { foreign: 24, memo: '美術館の入館料', category: 'entertainment', purchased: true, date: '2026-11-18' },
    { foreign: 16.9, memo: 'メトロ 回数券', category: 'transport', purchased: true, date: '2026-11-19' },
    { foreign: 145, memo: '革の小銭入れ', category: 'souvenir', purchased: false, date: '2026-11-20' },
    { foreign: 32, memo: 'ランチ', category: 'food', purchased: true, date: '2026-11-21' },
  ],
};

export async function buildFixtureDb(outFile) {
  if (fs.existsSync(outFile)) throw new Error(`出力先が既にあります（上書きしません）：${outFile}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { migrateDatabase } = await import('../../../../src/db/schema.ts');
  const trips = await import('../../../../src/db/queries/trips.ts');
  const history = await import('../../../../src/db/queries/history.ts');
  const rates = await import('../../../../src/db/queries/rates.ts');

  const db = openExpoSqliteCompat(outFile);
  try {
    await migrateDatabase(db);
    const tripId = await trips.insertTrip(db, FIXTURE.trip);
    await trips.setActiveTrip(db, tripId);
    await rates.upsertRate(db, 'EUR', FIXTURE.trip.manual_rate);
    for (const r of FIXTURE.records) {
      await history.insertHistory(
        db,
        {
          currency: 'EUR', foreign_amount: r.foreign, jpy_amount: Math.round(r.foreign * FIXTURE.trip.manual_rate),
          rate_used: FIXTURE.trip.manual_rate, trip_id: tripId,
        },
        r.memo, undefined, r.purchased, r.category,
      );
      const { id } = await db.getFirstAsync('SELECT MAX(id) AS id FROM conversion_history');
      await history.updateEntryDate(db, id, r.date);
    }
    const version = (await db.getFirstAsync('PRAGMA user_version')).user_version;
    const count = await history.getHistoryCountForTrip(db, tripId);
    // WALをDB本体へ書き戻し、1ファイルで持ち運べるようにする
    db._raw.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
    return { file: outFile, userVersion: version, tripId, records: count };
  } finally {
    await db.closeAsync();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..', 'out', 'tabirate', 'fixture', 'travelrate.db'));
  buildFixtureDb(out)
    .then((r) => console.log(`[fixture] ${r.file}（user_version ${r.userVersion}・記録 ${r.records}件）`))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
