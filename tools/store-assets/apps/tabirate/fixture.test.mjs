import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { anchoredToday, buildFixtureDb, FIXTURE, FIXTURE_HAWAII, fixtureDates, HAWAII_PRICE_TAG, pastTripDate } from './build-fixture-db.mjs';
import { openExpoSqliteCompat } from '../../engine/fixtures/expo-sqlite-node.mjs';
import { loadProfile } from '../../engine/profile.mjs';
import { interactHash } from '../../engine/drivers/interact.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

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

// 撮影はディープリンクを profile の並びの順に開く。アプリで modal の画面（src/app/_layout.tsx の presentation）の後に
// 通常の画面を開くと、その画面も modal の上のシートとして表示される（native-stack の決まり。利用者が見る全画面の表示と違う）。
// タブの画面は開く時に上の画面を閉じるので問題にならない。画面を絞ったジョブ（--screens）でも守れるよう、
// modal の画面は操作の無い画面の最後にまとめ、操作の画面（最後に撮る）はタブの画面にする
for (const profileFile of ['profile.json', 'profile-hawaii.json']) test(`profile（${profileFile}）: modal の画面は操作の無い画面の最後に置き、操作の画面はタブの画面（modal の上のシートとして撮らない）`, () => {
  const here = HERE;
  const appDir = path.join(here, '..', '..', '..', '..', 'src', 'app');
  const layout = fs.readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');
  const modal = new Set();
  for (const chunk of layout.split('<Stack.Screen').slice(1)) {
    const tag = chunk.split('/>')[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    const presentation = tag.match(/presentation:\s*'([^']+)'/)?.[1];
    if (name && presentation && presentation !== 'card') modal.add(name);
  }
  assert.ok(modal.has('rate-setup'), 'アプリの modal の画面を読めている（_layout.tsx の書き方が変わったらこの検査を直す）');
  const profile = loadProfile(path.join(here, profileFile));
  const routeName = (s) => String(s.route ?? '').replace(/^\//, '');
  const isTab = (s) => routeName(s) === '' || ['', '.tsx'].some((ext) => fs.existsSync(path.join(appDir, '(tabs)', `${routeName(s)}${ext}`)));
  const linked = profile.capture.screens.filter((s) => s.deepLink);
  const plain = linked.filter((s) => !s.interact);
  const firstModal = plain.findIndex((s) => modal.has(routeName(s)));
  assert.ok(firstModal >= 0, 'profile に modal の画面がある（無くなったらこの検査を直す）');
  const after = plain.slice(firstModal).filter((s) => !modal.has(routeName(s)));
  assert.deepEqual(after.map((s) => s.id), [], 'modal の画面の後に、操作の無い通常の画面を置かない');
  if (firstModal > 0) assert.ok(isTab(plain[firstModal - 1]), `modal の直前はタブの画面（背後が通常の画面になる）：${plain[firstModal - 1].id}`);
  for (const s of linked.filter((x) => x.interact)) assert.ok(isTab(s), `操作の画面 ${s.id} はタブの画面（開く時に modal を閉じる）`);
});

// ハワイ・USD の見本（第9回）：パリの見本と混ざらず、期待する表示（profile-hawaii.json）がアプリの計算と一致する
const appModule = (rel) => import(new URL(`../../../../src/${rel}`, import.meta.url).href);

test('fixture（ハワイ）: ハワイ旅行・USD 163・予算 ¥50,000。パリの旅行・記録は入らず、円はアプリの換算（丸めない値）で保存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabirate-fixture-hawaii-'));
  try {
    const file = path.join(dir, 'travelrate.db');
    const r = await buildFixtureDb(file, { today: new Date(2026, 10, 24), fixture: FIXTURE_HAWAII });
    assert.deepEqual([r.from, r.to], ['2026-11-19', '2026-11-23'], '2026-11-24 に作ると第6〜8回の撮影と同じ 11/19〜23');
    const { convert } = await appModule('utils/currency.ts');
    const db = openExpoSqliteCompat(file);
    const trip = await db.getFirstAsync('SELECT * FROM trips WHERE id = ?', r.tripId);
    assert.equal(trip.name, 'ハワイ旅行');
    assert.equal(trip.base_currency, 'USD');
    assert.equal(trip.manual_rate, 163);
    assert.equal(trip.budget_jpy, 50000);
    const names = (await db.getAllAsync('SELECT name FROM trips ORDER BY id')).map((t) => t.name);
    assert.deepEqual(names, ['ソウル旅行', '台北旅行', 'ハワイ旅行'], 'パリ旅行は入らない');
    const rows = await db.getAllAsync('SELECT * FROM conversion_history WHERE trip_id = ? ORDER BY id', r.tripId);
    assert.deepEqual(rows.map((x) => x.memo), FIXTURE_HAWAII.records.map((x) => x.memo));
    for (const [i, row] of rows.entries()) {
      assert.equal(row.currency, 'USD');
      assert.equal(row.jpy_amount, convert(FIXTURE_HAWAII.records[i].foreign, 163, 'TO_JPY'), `${row.memo}：保存の時と同じ換算`);
    }
    const all = await db.getAllAsync('SELECT memo FROM conversion_history');
    for (const p of FIXTURE.records) assert.ok(!all.some((x) => x.memo === p.memo), `パリの記録 ${p.memo} は入らない`);
    const rates = await db.getAllAsync('SELECT * FROM exchange_rates');
    assert.ok(rates.some((x) => x.currency === 'USD' && x.rate === 163), 'レートは旅行の通貨（USD）で入る');
    assert.ok(!rates.some((x) => x.currency === 'EUR'), 'EUR のレートは入らない');
    await db.closeAsync();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fixture（ハワイ）: 基準日（11/24）と同じ月で以後なら日付は 11/19〜23 のまま、月が違えば撮影する日の月', () => {
  const range = (d) => { const a = fixtureDates(d, FIXTURE_HAWAII); return [a[0], a.at(-1)]; };
  for (const day of [24, 25, 30]) assert.deepEqual(range(new Date(2026, 10, day)), ['2026-11-19', '2026-11-23'], `11/${day}`);
  assert.deepEqual(range(new Date(2026, 11, 3)), ['2026-12-01', '2026-12-05'], '12月はカレンダーの月に合わせる');
  assert.equal(anchoredToday(new Date(2026, 10, 20), FIXTURE_HAWAII).getDate(), 20, '基準日より前は撮影する日');
  assert.equal(anchoredToday(new Date(2026, 10, 28), FIXTURE).getDate(), 28, 'パリの見本は基準日を持たない（従来どおり）');
});

test('fixture（ハワイ）: 金額は価格表の値・名前は実機の表示だけ（Beach Sandals・コストコの品目は入れない）', () => {
  for (const r of FIXTURE_HAWAII.records) assert.ok(Object.values(HAWAII_PRICE_TAG).includes(r.foreign), `${r.memo} は価格表の金額`);
  const priceTag = { 'コナコーヒー': 4.5, 'マカダミアナッツチョコレート': 6.2, 'アロハTシャツ': 29.9, 'ボトルウォーター': 1.8, 'パイナップルジュース': 5.4 };
  assert.deepEqual(Object.fromEntries(FIXTURE_HAWAII.records.map((r) => [r.memo, r.foreign])), priceTag);
  // 実機の記録（03_買い物一覧.png）で候補だった2品
  for (const m of ['ボトルウォーター', 'パイナップルジュース']) assert.equal(FIXTURE_HAWAII.records.find((r) => r.memo === m).purchased, false);
});

test('profile-hawaii: 見出し・広告・並びは profile.json と同じで、撮影（capture）だけが違う。期待する金額はアプリの計算と一致', async () => {
  const paris = loadProfile(path.join(HERE, 'profile.json'));
  const hawaii = loadProfile(path.join(HERE, 'profile-hawaii.json'));
  for (const k of ['shots', 'ads', 'storeSets', 'features', 'brand', 'outputs', 'disclaimer']) assert.deepEqual(hawaii[k], paris[k], k);
  assert.equal(hawaii.capture.ios.fixtureBuild, 'build-fixture-db-hawaii.mjs');
  assert.equal(paris.capture.ios.fixtureBuild, 'build-fixture-db.mjs', 'パリの撮影は既定のまま');
  assert.deepEqual(hawaii.capture.screens.map((s) => s.id), paris.capture.screens.map((s) => s.id), '画面と並びは同じ');
  const scr = (p, id) => p.capture.screens.find((s) => s.id === id);
  assert.notEqual(interactHash(scr(hawaii, 'converter').interact), interactHash(scr(paris, 'converter').interact), 'パリの換算の撮影をハワイの合成に使わない（指紋が違う）');

  const { sumBudgetTotals } = await appModule('utils/budget-core.ts');
  const { formatJpy } = await appModule('utils/format.ts');
  const { convert } = await appModule('utils/currency.ts');
  const { trip, records } = FIXTURE_HAWAII;
  const rows = records.map((r) => ({ jpy_amount: convert(r.foreign, trip.manual_rate, 'TO_JPY'), is_purchased: r.purchased ? 1 : 0 }));
  const t = sumBudgetTotals(rows);
  assert.ok(scr(hawaii, 'history').expectVisible.includes(formatJpy(trip.budget_jpy - t.purchasedTotalJpy)), `残り予算 ${formatJpy(trip.budget_jpy - t.purchasedTotalJpy)}`);
  assert.ok(scr(hawaii, 'calendar').expectVisible.includes(formatJpy(t.purchasedTotalJpy)), `月合計の購入済み ${formatJpy(t.purchasedTotalJpy)}`);
  const conv = scr(hawaii, 'converter').interact;
  const typed = Number(conv.steps.find((s) => s.inputText).inputText);
  assert.ok(Object.values(HAWAII_PRICE_TAG).includes(typed), '換算に入れる金額は価格表の金額');
  assert.ok(Number.isInteger(typed), '換算の入力は整数（第9回の1回目は小数の入力の後の確認が通らなかった）');
  assert.deepEqual(conv.expectVisible, [formatJpy(convert(typed, trip.manual_rate, 'TO_JPY'))]);
  assert.ok(scr(hawaii, 'history').expectVisible.every((x) => typeof x === 'string'));
  assert.ok(records.some((r) => scr(hawaii, 'history').expectVisible.includes(r.memo)), '履歴の確認に見本の品目名');
});

test('resolveExtends: 最上位の項目だけ置き換え・1段だけ・同じフォルダの名前だけ', async () => {
  const { resolveExtends } = await import('../../engine/profile.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabirate-extends-'));
  try {
    fs.writeFileSync(path.join(dir, 'base.json'), JSON.stringify({ a: 1, capture: { x: 1, y: 2 } }));
    assert.deepEqual(resolveExtends({ $extends: 'base.json', capture: { x: 9 } }, dir), { a: 1, capture: { x: 9 }, $extendsFile: 'base.json' });
    assert.deepEqual(resolveExtends({ a: 2 }, dir), { a: 2 });
    fs.writeFileSync(path.join(dir, 'chain.json'), JSON.stringify({ $extends: 'base.json' }));
    assert.throws(() => resolveExtends({ $extends: 'chain.json' }, dir), /1段だけ/);
    assert.throws(() => resolveExtends({ $extends: '../base.json' }, dir), /同じフォルダ/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
