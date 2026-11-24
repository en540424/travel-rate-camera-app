// シミュレーター撮影用のテストデータDBを作る。
//
//   node tools/store-assets/apps/tabirate/build-fixture-db.mjs [出力先.db]
//
// - アプリ本体のmigration（src/db/schema.ts の migrateDatabase）と保存関数（src/db/queries）をそのまま使う。
//   スキーマを手で書き写さないので、アプリのDBの版と食い違わない
// - 出力は新しいファイルだけ。既存のファイルがあれば上書きせずに止める
// - 中身は撮影用の見本（記録中の旅行1件と記録数件・終了した旅行2件）。実在の店舗・利用者のデータは含まない
// - レートは見本の固定値（manual_rate）。現在の為替レートではない（素材の文言でも実際のレートとして扱わない）
// - 使い道：profile.json の capture.ios.fixtureBuild に指定すると、iOSシミュレーター撮影の手順がシミュレーター内のアプリへ入れる
// - 見本は2種類：FIXTURE（パリ・EUR。既定・profile.json）と FIXTURE_HAWAII（ハワイ・USD。profile-hawaii.json →
//   build-fixture-db-hawaii.mjs）。混ぜない（ハワイの見本にパリの旅行・記録を入れない）
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openExpoSqliteCompat } from '../../engine/fixtures/expo-sqlite-node.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
globalThis.__DEV__ = false;
register(pathToFileURL(path.join(HERE, 'alias-hooks.mjs')).href);

// 撮影用の見本。記録の日付は「撮影する日」からの日数（daysAgo）で持ち、作る時に実際の日付へ直す。
// iOS シミュレーターは実行するマシンの時計で動き、カレンダーは今日の月を開く。日付を固定すると、
// 月が変わった後の撮影でカレンダーが空（月合計 ¥0）のまま、全ての検査を通ってしまう（2026-11-23 の独立検収の指摘）
export const FIXTURE = {
  trip: { name: 'パリ旅行', budget_jpy: 150000, base_currency: 'EUR', manual_rate: 165 },
  records: [
    { foreign: 12.5, memo: 'マカロン 6個入り', category: 'food', purchased: true, daysAgo: 4 },
    { foreign: 38, memo: '紅茶の缶 3種セット', category: 'souvenir', purchased: true, daysAgo: 4 },
    { foreign: 89, memo: 'ストール', category: 'clothing', purchased: false, daysAgo: 3 },
    { foreign: 24, memo: '美術館の入館料', category: 'entertainment', purchased: true, daysAgo: 3 },
    { foreign: 16.9, memo: 'メトロ 回数券', category: 'transport', purchased: true, daysAgo: 2 },
    { foreign: 145, memo: '革の小銭入れ', category: 'souvenir', purchased: false, daysAgo: 1 },
    { foreign: 32, memo: 'ランチ', category: 'food', purchased: true, daysAgo: 0 },
  ],
  // 終了した旅行（旅行一覧の撮影用）。アプリの archiveTrip で終了にする（無料版でも閲覧できる状態）。
  // 日付は撮影する月より前（monthsAgo か月前の day 日）に置き、カレンダーの当月へ混ざらないようにする
  pastTrips: [
    {
      trip: { name: 'ソウル旅行', budget_jpy: 60000, base_currency: 'KRW', manual_rate: 0.11 }, monthsAgo: 2, days: [10, 13],
      records: [
        { foreign: 28000, memo: 'コスメ セット', category: 'souvenir', purchased: true, day: 11 },
        { foreign: 9000, memo: '屋台の軽食', category: 'food', purchased: true, day: 12 },
      ],
    },
    {
      trip: { name: '台北旅行', budget_jpy: 50000, base_currency: 'TWD', manual_rate: 4.8 }, monthsAgo: 5, days: [3, 6],
      records: [
        { foreign: 680, memo: 'お茶の詰め合わせ', category: 'souvenir', purchased: true, day: 4 },
        { foreign: 250, memo: '小籠包', category: 'food', purchased: true, day: 5 },
      ],
    },
  ],
};

// ハワイ・USD の見本（2026-11-24 第9回）。実機の掲載素材（OneDrive「旅レートカメラAppStore掲載素材」2026-10-24 撮影）と
// その被写体「ハワイのお土産価格表.png」に写っている値だけを使う。根拠：
// - 旅行名「ハワイ旅行」・1 USD = ¥163.00：03_買い物一覧.png・02_リアルタイム翻訳3.png の表示
// - 予算 ¥50,000：03_買い物一覧.png の「残り予算 ¥48,048」＋「購入済み ¥1,952」
// - 品目と金額：価格表の6品のうち、実機の画面に日本語名が出た5品（名前はアプリの表示のまま）。
//   アロハTシャツ・コナコーヒー・マカダミアナッツチョコレート＝02_リアルタイム翻訳3.png（スマートカメラの訳）、
//   ボトルウォーター・パイナップルジュース＝03_買い物一覧.png（保存した記録）。Beach Sandals は訳が画面に無いので入れない
// - 候補／購入済み：ボトルウォーター・パイナップルジュースは実機の記録で「候補」。他の3品の区分は実機に記録が無く、
//   画面の表示用に割り当てた（コナコーヒー・マカダミアナッツチョコレート＝購入済み、アロハTシャツ＝候補）
// - 実機の記録にあるコストコの品目（被写体が価格表と別・商標）と内容の読めない記録は入れない
// - 円の金額は保存の時と同じアプリの換算（src/utils/currency.ts の convert。丸めない値を保存し、表示・合計で1件ずつ丸める）
// - 日付：撮影する日の5〜1日前（2026-11-24 に作ると 11/19〜23。第6〜8回の撮影の記録日と同じ範囲）
export const FIXTURE_HAWAII = {
  trip: { name: 'ハワイ旅行', budget_jpy: 50000, base_currency: 'USD', manual_rate: 163 },
  jpy: 'app-convert',
  records: [
    { foreign: 4.5, memo: 'コナコーヒー', category: 'food', purchased: true, daysAgo: 5 },
    { foreign: 6.2, memo: 'マカダミアナッツチョコレート', category: 'souvenir', purchased: true, daysAgo: 4 },
    { foreign: 29.9, memo: 'アロハTシャツ', category: 'clothing', purchased: false, daysAgo: 3 },
    { foreign: 1.8, memo: 'ボトルウォーター', category: 'food', purchased: false, daysAgo: 2 },
    { foreign: 5.4, memo: 'パイナップルジュース', category: 'food', purchased: false, daysAgo: 1 },
  ],
  // 終了した旅行はパリの見本と同じ2件（ソウル・台北。パリは入れない）
  pastTrips: FIXTURE.pastTrips,
};

const pad = (n) => String(n).padStart(2, '0');

/**
 * 見本の記録の日付（YYYY-MM-DD）。基準は today（実行するマシンのローカルの日付）。
 * 全ての記録が today と同じ月に入るよう、月初（最も古い記録が前月にはみ出す日）は基準を後ろへずらす
 * （その場合は今日より後の日付の記録になる。カレンダーが空になるよりよい）。
 */
export function fixtureDates(today = new Date(), fixture = FIXTURE) {
  const span = Math.max(...fixture.records.map((r) => r.daysAgo));
  const y = today.getFullYear();
  const m = today.getMonth();
  const anchor = Math.max(today.getDate(), span + 1);
  return fixture.records.map((r) => {
    const d = new Date(y, m, anchor - r.daysAgo);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
}

/** 終了した旅行の日付（YYYY-MM-DD）。today の monthsAgo か月前の day 日。 */
export function pastTripDate(today, monthsAgo, day) {
  const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function insertRecords(db, history, tripId, trip, records, dates, toJpy) {
  for (const [i, r] of records.entries()) {
    await history.insertHistory(
      db,
      {
        currency: trip.base_currency, foreign_amount: r.foreign, jpy_amount: toJpy(r.foreign, trip.manual_rate),
        rate_used: trip.manual_rate, trip_id: tripId,
      },
      r.memo, undefined, r.purchased, r.category,
    );
    const { id } = await db.getFirstAsync('SELECT MAX(id) AS id FROM conversion_history');
    await history.updateEntryDate(db, id, dates[i]);
  }
}

/**
 * 見本の円の金額の出し方。パリ（既定）は従来どおり Math.round した値を保存する（第5〜8回の撮影と同じ DB を作るため変えない）。
 * jpy: 'app-convert' の見本は、アプリが保存する時と同じ convert（丸めない値）を使う
 */
async function jpyOf(fixture) {
  if (fixture.jpy !== 'app-convert') return (amount, rate) => Math.round(amount * rate);
  const { convert } = await import('../../../../src/utils/currency.ts');
  return (amount, rate) => convert(amount, rate, 'TO_JPY');
}

export async function buildFixtureDb(outFile, { today = new Date(), fixture = FIXTURE } = {}) {
  if (fs.existsSync(outFile)) throw new Error(`出力先が既にあります（上書きしません）：${outFile}`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const { migrateDatabase } = await import('../../../../src/db/schema.ts');
  const trips = await import('../../../../src/db/queries/trips.ts');
  const history = await import('../../../../src/db/queries/history.ts');
  const rates = await import('../../../../src/db/queries/rates.ts');

  const toJpy = await jpyOf(fixture);
  const db = openExpoSqliteCompat(outFile);
  try {
    await migrateDatabase(db);
    // 終了した旅行を先に作る（記録中の旅行を最後に作り、使用中にする）
    for (const past of fixture.pastTrips) {
      const id = await trips.insertTrip(db, past.trip);
      await trips.updateTrip(db, id, {
        started_at: pastTripDate(today, past.monthsAgo, past.days[0]),
        ended_at: pastTripDate(today, past.monthsAgo, past.days[1]),
      });
      await insertRecords(db, history, id, past.trip, past.records, past.records.map((r) => pastTripDate(today, past.monthsAgo, r.day)), toJpy);
      await trips.archiveTrip(db, id);
    }
    const tripId = await trips.insertTrip(db, fixture.trip);
    await trips.setActiveTrip(db, tripId);
    await rates.upsertRate(db, fixture.trip.base_currency, fixture.trip.manual_rate);
    const dates = fixtureDates(today, fixture);
    // 旅行一覧の月の表示（started_at が無ければ作った日）を記録の日付と合わせる
    await trips.updateTrip(db, tripId, { started_at: dates[0] });
    await insertRecords(db, history, tripId, fixture.trip, fixture.records, dates, toJpy);
    const version = (await db.getFirstAsync('PRAGMA user_version')).user_version;
    const count = await history.getHistoryCountForTrip(db, tripId);
    // WALをDB本体へ書き戻し、1ファイルで持ち運べるようにする
    db._raw.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
    return { file: outFile, userVersion: version, tripId, records: count, from: dates[0], to: dates[dates.length - 1] };
  } finally {
    await db.closeAsync();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(HERE, '..', '..', 'out', 'tabirate', 'fixture', 'travelrate.db'));
  buildFixtureDb(out)
    .then((r) => console.log(`[fixture] ${r.file}（user_version ${r.userVersion}・記録 ${r.records}件・日付 ${r.from}〜${r.to}）`))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
