/**
 * Pro+の買い物マップ・旅行スケジュール・権利の純ロジックの検証。
 * 実行：node --test src/lib/proplus/proplus-core.test.mjs（npm test に含まれる）
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  distanceMeters, externalNavigationUrl, formatDistance, linkRecordToPlace, placeForRecord,
  pruneAfterRecordsDeleted, recordIdsForPlace, regionForPoints, sortPlaces, validatePlaceInput,
} from './places-core.ts';
import {
  eventRange, findDuplicate, findOverlaps, formatEventTime, googleCalendarUrl, groupEventsByDay,
  localToDate, parseLocal, timeZoneNote, toCalendarPayload, validateEventInput,
} from './trip-events-core.ts';
import { canEditProPlusData, canViewProPlusData, getProPlusAccess } from './proplus-access-core.ts';

const place = (over) => ({
  id: 'p1', name: '店', lat: null, lng: null, coordSource: null, applePlaceId: null, memo: '', tripId: 1,
  createdAt: '2026-11-20T00:00:00Z', updatedAt: '2026-11-20T00:00:00Z', deletedAt: null, ...over,
});
const ev = (over) => ({
  id: 'e1', tripId: 1, kind: 'other', title: '予定', startsLocal: '2026-11-21T10:00', endsLocal: null, tz: 'Europe/Paris',
  allDay: false, placeId: null, memo: '', createdAt: '', updatedAt: '', deletedAt: null, ...over,
});

// ── 場所 ──
test('場所：店名は必須・座標は両方あるか両方無いか・範囲外は拒否', () => {
  assert.equal(validatePlaceInput({ name: '  ' }).ok, false);
  assert.equal(validatePlaceInput({ name: 'a', lat: 10 }).ok, false);
  assert.equal(validatePlaceInput({ name: 'a', lat: 91, lng: 0 }).ok, false);
  assert.equal(validatePlaceInput({ name: 'a', lat: 'x', lng: '2' }).ok, false);
  assert.equal(validatePlaceInput({ name: 'a'.repeat(61) }).ok, false);
  const ok = validatePlaceInput({ name: ' パン屋 ', lat: '48.85', lng: '2.35' });
  assert.equal(ok.ok, true);
  assert.deepEqual([ok.value.name, ok.value.lat, ok.value.lng, ok.value.coordSource], ['パン屋', 48.85, 2.35, 'manual']);
  const gps = validatePlaceInput({ name: 'a', lat: 1, lng: 2, coordSource: 'device_gps' });
  assert.equal(gps.value.coordSource, 'device_gps');
  const noCoord = validatePlaceInput({ name: 'a', lat: '', lng: '', coordSource: 'device_gps' });
  assert.equal(noCoord.value.coordSource, null, '座標が無ければ取得元も無し');
});

test('場所：距離（パリ〜ロンドン約344km）と表示', () => {
  const d = distanceMeters({ lat: 48.8566, lng: 2.3522 }, { lat: 51.5074, lng: -0.1278 });
  assert.ok(Math.abs(d - 343_500) < 2_000, String(d));
  assert.equal(formatDistance(846), '850 m');
  assert.equal(formatDistance(1234), '1.2 km');
  assert.equal(formatDistance(23_600), '24 km');
  assert.equal(formatDistance(-1), '');
});

test('場所：現在地があれば近い順（座標なしは後ろ）、無ければ更新の新しい順。削除済みと別旅行は除く', () => {
  const list = [
    place({ id: 'far', lat: 48.9, lng: 2.4, updatedAt: '2026-11-21' }),
    place({ id: 'near', lat: 48.8567, lng: 2.3523, updatedAt: '2026-11-19' }),
    place({ id: 'none', updatedAt: '2026-11-22' }),
    place({ id: 'gone', lat: 48.8566, lng: 2.3522, deletedAt: '2026-11-21' }),
    place({ id: 'other', tripId: 2, lat: 48.8566, lng: 2.3522 }),
  ];
  const here = { lat: 48.8566, lng: 2.3522 };
  assert.deepEqual(sortPlaces(list, here, 1).map((p) => p.id), ['near', 'far', 'none']);
  assert.deepEqual(sortPlaces(list, null, 1).map((p) => p.id), ['none', 'far', 'near']);
  assert.equal(sortPlaces(list, null).length, 4, '旅行を指定しなければ全旅行');
});

test('場所：表示範囲は全ピンを含み、1点なら最小幅', () => {
  assert.equal(regionForPoints([]), null);
  const one = regionForPoints([{ lat: 10, lng: 20 }]);
  assert.deepEqual([one.latitude, one.longitude, one.latitudeDelta], [10, 20, 0.01]);
  const two = regionForPoints([{ lat: 10, lng: 20 }, { lat: 12, lng: 24 }]);
  assert.equal(two.latitude, 11);
  assert.ok(two.latitudeDelta >= 2 && two.longitudeDelta >= 4);
});

test('場所：外部ナビのURLは座標があれば座標、無ければ店名で、Apple・Googleとも鍵不要', () => {
  const withCoord = place({ name: 'Café A&B', lat: 48.85, lng: 2.35 });
  assert.equal(externalNavigationUrl(withCoord, 'apple'), 'https://maps.apple.com/?daddr=48.85%2C2.35&dirflg=w&q=Caf%C3%A9%20A%26B');
  assert.equal(externalNavigationUrl(withCoord, 'google'), 'https://www.google.com/maps/dir/?api=1&destination=48.85%2C2.35&travelmode=walking');
  assert.equal(externalNavigationUrl(place({ name: '駅前の店' }), 'apple'), `https://maps.apple.com/?daddr=${encodeURIComponent('駅前の店')}&dirflg=w`);
});

test('場所：記録との紐付けは1記録1場所、削除済みの場所・存在しない記録は出さない', () => {
  let links = linkRecordToPlace([], 10, 'p1');
  links = linkRecordToPlace(links, 10, 'p2');
  assert.deepEqual(links, [{ historyId: 10, placeId: 'p2' }]);
  links = linkRecordToPlace(links, 11, 'p2');
  const places = [place({ id: 'p2' }), place({ id: 'p3', deletedAt: 'x' })];
  assert.equal(placeForRecord(10, links, places).id, 'p2');
  assert.equal(placeForRecord(99, links, places), null);
  assert.equal(placeForRecord(12, [{ historyId: 12, placeId: 'p3' }], places), null);
  assert.deepEqual(recordIdsForPlace('p2', links, new Set([11])), [11]);
  assert.deepEqual(linkRecordToPlace(links, 10, null), [{ historyId: 11, placeId: 'p2' }]);
});

test('場所：記録の一括削除後、どこからも参照されない場所だけが整理対象（予定・他の記録が使う場所は残す）', () => {
  const links = [
    { historyId: 1, placeId: 'a' }, { historyId: 2, placeId: 'b' }, { historyId: 3, placeId: 'b' },
    { historyId: 4, placeId: 'c' },
  ];
  const r = pruneAfterRecordsDeleted(links, new Set([3]), new Set(['c']), new Set([1, 2, 4]));
  assert.deepEqual(r.links, [{ historyId: 3, placeId: 'b' }]);
  assert.deepEqual(r.orphanPlaceIds, ['a']);
});

// ── 予定 ──
test('予定：現地時刻の形式・暦の妥当性', () => {
  assert.deepEqual(parseLocal('2026-11-21T09:05', false), { y: 2026, mo: 11, d: 21, h: 9, mi: 5 });
  assert.equal(parseLocal('2026-02-29T10:00', false), null, '2026年は平年');
  assert.ok(parseLocal('2028-02-29T10:00', false));
  assert.equal(parseLocal('2026-11-21T24:00', false), null);
  assert.equal(parseLocal('2026-11-21', false), null);
  assert.ok(parseLocal('2026-11-21', true));
});

test('予定：現地時刻→絶対時刻（パリ冬時間UTC+1・東京UTC+9・夏時間の切替日）', () => {
  assert.equal(localToDate('2026-11-21T10:00', 'Europe/Paris').toISOString(), '2026-11-21T09:00:00.000Z');
  assert.equal(localToDate('2026-11-21T10:00', 'Asia/Tokyo').toISOString(), '2026-11-21T01:00:00.000Z');
  assert.equal(localToDate('2026-07-01T10:00', 'Europe/Paris').toISOString(), '2026-07-01T08:00:00.000Z');
  // 2026-03-29 02:30 はパリに存在しない（02:00→03:00）。直後の有効な時刻（03:30 CEST = 01:30Z）へ進める
  assert.equal(localToDate('2026-03-29T02:30', 'Europe/Paris').toISOString(), '2026-03-29T01:30:00.000Z');
  // 2026-10-25 02:30 は2回ある。早い方（CEST・00:30Z）
  assert.equal(localToDate('2026-10-25T02:30', 'Europe/Paris').toISOString(), '2026-10-25T00:30:00.000Z');
  assert.equal(localToDate('2026-11-21T10:00', 'Not/AZone'), null);
});

test('予定：入力の検証（必須・終了が開始より前・不正なTZ）と旅行期間外の警告', () => {
  const base = { tripId: 1, title: 'ルーブル', startsLocal: '2026-11-21T10:00', tz: 'Europe/Paris' };
  assert.equal(validateEventInput({ ...base, title: '' }).ok, false);
  assert.equal(validateEventInput({ ...base, endsLocal: '2026-11-21T09:00' }).ok, false);
  assert.equal(validateEventInput({ ...base, tz: 'Mars/Base' }).ok, false);
  assert.equal(validateEventInput({ ...base, startsLocal: '2026-11-21' }).ok, false, '時刻ありに日付だけは不可');
  const ok = validateEventInput({ ...base, endsLocal: ' ' }, { startDate: '2026-11-22', endDate: null });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.endsLocal, null);
  assert.deepEqual(ok.warnings, ['旅行の開始日より前の予定です']);
  const allDay = validateEventInput({ ...base, startsLocal: '2026-11-21', allDay: true });
  assert.equal(allDay.ok, true);
});

test('予定：重複（表記ゆれを無視）と時間の重なり', () => {
  const list = [ev({ id: 'a', title: 'ルーブル 美術館' }), ev({ id: 'b', startsLocal: '2026-11-21T10:30', title: 'カフェ' }), ev({ id: 'c', startsLocal: '2026-11-21T11:00', title: '昼' })];
  assert.equal(findDuplicate(list, { tripId: 1, title: ' ルーブル　美術館 ', startsLocal: '2026-11-21T10:00', tz: 'Europe/Paris' }).id, 'a');
  assert.equal(findDuplicate(list, { tripId: 1, title: 'ルーブル 美術館', startsLocal: '2026-11-21T10:00', tz: 'Europe/Paris' }, 'a'), null, '自分自身は除く');
  assert.deepEqual(findOverlaps(list).map(([x, y]) => `${x.id}-${y.id}`), ['a-b', 'b-c']);
});

test('予定：日別のまとめ（終日が先・時刻順・削除済みと別旅行を除く）と時刻表示', () => {
  const days = groupEventsByDay([
    ev({ id: 'x', startsLocal: '2026-11-22T09:00' }),
    ev({ id: 'y', startsLocal: '2026-11-21T15:00' }),
    ev({ id: 'z', startsLocal: '2026-11-21', allDay: true }),
    ev({ id: 'd', startsLocal: '2026-11-21T08:00', deletedAt: 'x' }),
    ev({ id: 'o', tripId: 2, startsLocal: '2026-11-21T08:00' }),
  ], 1);
  assert.deepEqual(days.map((d) => [d.date, d.events.map((e) => e.id)]), [['2026-11-21', ['z', 'y']], ['2026-11-22', ['x']]]);
  assert.equal(formatEventTime(ev({ endsLocal: '2026-11-21T11:30' })), '10:00〜11:30');
  assert.equal(formatEventTime(ev({ endsLocal: '2026-11-22T01:00' })), '10:00〜11/22 01:00');
  assert.equal(formatEventTime(ev({ allDay: true })), '終日');
  assert.equal(timeZoneNote('Europe/Paris', 'Asia/Tokyo'), '現地時間（Europe/Paris）');
  assert.equal(timeZoneNote('Asia/Tokyo', 'Asia/Tokyo'), null);
});

test('予定：端末カレンダーへ渡す内容（既定1時間・終日は翌日0時まで）', () => {
  const p = toCalendarPayload(ev({ memo: '予約あり' }), 'ルーブル美術館');
  assert.equal(p.startDate.toISOString(), '2026-11-21T09:00:00.000Z');
  assert.equal(p.endDate.toISOString(), '2026-11-21T10:00:00.000Z');
  assert.equal(p.location, 'ルーブル美術館');
  assert.ok(p.notes.startsWith('予約あり'));
  const r = eventRange(ev({ startsLocal: '2026-11-21', endsLocal: '2026-11-22', allDay: true }));
  assert.equal(r.end.toISOString(), '2026-11-22T23:00:00.000Z', '最終日の翌日0時（パリ）');
});

test('予定：Googleカレンダーの追加URLは現地の壁時計＋ctz', () => {
  const u = new URL(googleCalendarUrl(ev({ title: '夕食', memo: 'm' }), '店'));
  assert.equal(u.searchParams.get('dates'), '20261121T100000/20261121T110000');
  assert.equal(u.searchParams.get('ctz'), 'Europe/Paris');
  assert.equal(u.searchParams.get('location'), '店');
  const late = new URL(googleCalendarUrl(ev({ startsLocal: '2026-12-31T23:30' }), null));
  assert.equal(late.searchParams.get('dates'), '20261231T233000/20270101T003000', '年をまたぐ既定の終了');
  const allDay = new URL(googleCalendarUrl(ev({ startsLocal: '2026-11-21', allDay: true }), null));
  assert.equal(allDay.searchParams.get('dates'), '20261121/20261122');
});

// ── 権利 ──
test('権利：フラグ無効なら全プランで非表示、Pro+は全機能、失効後は閲覧のみでデータを消さない', () => {
  assert.equal(getProPlusAccess({ flagEnabled: false, hasProPlus: true, hasExistingData: true }), 'hidden');
  assert.equal(getProPlusAccess({ flagEnabled: true, hasProPlus: true, hasExistingData: false }), 'full');
  assert.equal(getProPlusAccess({ flagEnabled: true, hasProPlus: false, hasExistingData: true }), 'read_only');
  assert.equal(getProPlusAccess({ flagEnabled: true, hasProPlus: false, hasExistingData: false }), 'upsell');
  assert.equal(canEditProPlusData('read_only'), false);
  assert.equal(canViewProPlusData('read_only'), true);
  assert.equal(canViewProPlusData('upsell'), false);
});
