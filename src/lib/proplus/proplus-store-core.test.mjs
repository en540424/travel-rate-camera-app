/**
 * Pro+のデータ操作（proplus-store-core.ts）の検証。コアどうしのimportを解決するため、テスト専用の解決フックを先に登録する。
 */
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

register('./ts-resolve-hook.mjs', import.meta.url);
const S = await import('./proplus-store-core.ts');

function clock() {
  let n = 0;
  let t = 0;
  return { now: () => `2026-11-21T10:00:${String(t++).padStart(2, '0')}Z`, newId: () => `id-${++n}` };
}

test('保存ファイルの検査：新しい版・壊れた形は上書きしないための理由を返す', () => {
  assert.equal(S.parseProPlusState(null).ok, false);
  assert.deepEqual(S.parseProPlusState({ version: 99, places: [], links: [], events: [] }), { ok: false, reason: 'newer_version' });
  assert.deepEqual(S.parseProPlusState({ version: 1, places: 'x', links: [], events: [] }), { ok: false, reason: 'invalid' });
  assert.deepEqual(S.parseProPlusState({ version: 1, places: [{ id: 1 }], links: [], events: [] }), { ok: false, reason: 'invalid' });
  assert.equal(S.parseProPlusState(S.EMPTY_PROPLUS_STATE).ok, true);
});

test('場所の追加・更新・論理削除。削除すると記録の紐付けと予定の場所が外れる', () => {
  const c = clock();
  let s = S.EMPTY_PROPLUS_STATE;
  assert.equal(S.hasAnyProPlusData(s), false);
  const bad = S.addPlace(s, { name: '' }, c);
  assert.equal(bad.ok, false);
  const a = S.addPlace(s, { name: 'パン屋', lat: 48.85, lng: 2.35, coordSource: 'device_gps', tripId: 1 }, c);
  s = a.state;
  const placeId = a.value.id;
  assert.equal(S.hasAnyProPlusData(s), true);
  s = S.setRecordPlace(s, 10, placeId).state;
  s = S.addEvent(s, { tripId: 1, title: '朝食', startsLocal: '2026-11-22T08:00', tz: 'Europe/Paris', placeId }, c).state;
  const u = S.updatePlace(s, placeId, { name: 'パン屋（本店）', lat: 48.85, lng: 2.35 }, c);
  assert.equal(u.value.name, 'パン屋（本店）');
  assert.equal(u.value.tripId, 1, '旅行は変えない');
  assert.notEqual(u.value.updatedAt, a.value.updatedAt);
  s = u.state;
  s = S.deletePlace(s, placeId, c).state;
  assert.ok(s.places[0].deletedAt, '論理削除（行は残る）');
  assert.equal(s.places.length, 1);
  assert.deepEqual(s.links, []);
  assert.equal(s.events[0].placeId, null);
  assert.equal(S.deletePlace(s, placeId, c).ok, false, '二重削除は不可');
  assert.equal(S.setRecordPlace(s, 11, placeId).ok, false, '削除済みの場所には紐付けない');
});

test('記録が消えた後の整理：消えた記録の紐付けを外し、予定が使う場所と手で登録しただけの場所は残す', () => {
  const c = clock();
  let s = S.EMPTY_PROPLUS_STATE;
  const p1 = S.addPlace(s, { name: '記録だけの店' }, c); s = p1.state;
  const p2 = S.addPlace(s, { name: '予定にも使う店' }, c); s = p2.state;
  const p3 = S.addPlace(s, { name: '手で登録しただけ' }, c); s = p3.state;
  s = S.setRecordPlace(s, 1, p1.value.id).state;
  s = S.setRecordPlace(s, 2, p2.value.id).state;
  s = S.addEvent(s, { tripId: 1, title: '再訪', startsLocal: '2026-11-23', allDay: true, tz: 'Europe/Paris', placeId: p2.value.id }, c).state;
  const same = S.reconcileWithRecords(s, new Set([1, 2]), c);
  assert.equal(same, s, '変化が無ければ同じ状態');
  const r = S.reconcileWithRecords(s, new Set(), c);
  assert.deepEqual(r.links, []);
  const byName = Object.fromEntries(r.places.map((p) => [p.name, p.deletedAt !== null]));
  assert.deepEqual(byName, { '記録だけの店': true, '予定にも使う店': false, '手で登録しただけ': false });
});

test('予定の追加・更新・論理削除と警告。存在しない場所は拒否し、旅行は変えない', () => {
  const c = clock();
  let s = S.EMPTY_PROPLUS_STATE;
  const trip = { startDate: '2026-11-20', endDate: '2026-11-25' };
  assert.equal(S.addEvent(s, { tripId: 1, title: 'x', startsLocal: '2026-11-21T10:00', tz: 'Europe/Paris', placeId: 'nope' }, c).ok, false);
  const a = S.addEvent(s, { tripId: 1, title: '美術館', startsLocal: '2026-11-26T10:00', tz: 'Europe/Paris' }, c, trip);
  assert.deepEqual(a.warnings, ['旅行の終了日より後の予定です']);
  s = a.state;
  const u = S.updateEvent(s, a.value.id, { tripId: 999, title: '美術館', startsLocal: '2026-11-24T10:00', tz: 'Europe/Paris' }, c, trip);
  assert.equal(u.value.tripId, 1);
  assert.deepEqual(u.warnings, []);
  s = S.deleteEvent(u.state, a.value.id, c).state;
  assert.ok(s.events[0].deletedAt);
  assert.equal(S.hasAnyProPlusData(s), false);
  assert.equal(S.updateEvent(s, a.value.id, { tripId: 1, title: 'y', startsLocal: '2026-11-24T10:00', tz: 'Europe/Paris' }, c).ok, false);
});

test('DB v8へ移す行は設計書§3-2の列名で、論理削除も含めて全部', () => {
  const c = clock();
  let s = S.addPlace(S.EMPTY_PROPLUS_STATE, { name: '店', lat: 1, lng: 2 }, c).state;
  s = S.setRecordPlace(s, 5, 'id-1').state;
  s = S.addEvent(s, { tripId: 3, title: '予定', startsLocal: '2026-11-21', allDay: true, tz: 'Asia/Tokyo' }, c).state;
  s = S.deleteEvent(s, 'id-2', c).state;
  const rows = S.exportForMigration(s);
  assert.deepEqual(Object.keys(rows.places[0]).sort(), ['apple_place_id', 'coord_source', 'created_at', 'deleted_at', 'lat', 'lng', 'memo', 'name', 'trip_id', 'updated_at', 'uuid']);
  assert.deepEqual(rows.record_places, [{ history_id: 5, place_uuid: 'id-1' }]);
  assert.equal(rows.trip_events[0].all_day, 1);
  assert.ok(rows.trip_events[0].deleted_at);
});

test('端末内IDはUUID v4の形', () => {
  assert.match(S.newLocalId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
