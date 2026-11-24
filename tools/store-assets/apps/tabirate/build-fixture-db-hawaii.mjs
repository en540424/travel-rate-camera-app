// ハワイ・USD の撮影用テストデータDBを作る（profile-hawaii.json の capture.ios.fixtureBuild）。
//
//   node tools/store-assets/apps/tabirate/build-fixture-db-hawaii.mjs [出力先.db]
//
// 中身と根拠は build-fixture-db.mjs の FIXTURE_HAWAII。作り方（アプリ本体の migration・保存関数・上書きしない）はパリの見本と同じ。
// パリの見本（build-fixture-db.mjs・profile.json）は既定のまま変えない
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFixtureDb, FIXTURE_HAWAII } from './build-fixture-db.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..', 'out', 'tabirate', 'fixture-hawaii', 'travelrate.db'));
  buildFixtureDb(out, { fixture: FIXTURE_HAWAII })
    .then((r) => console.log(`[fixture-hawaii] ${r.file}（user_version ${r.userVersion}・記録 ${r.records}件・日付 ${r.from}〜${r.to}）`))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
