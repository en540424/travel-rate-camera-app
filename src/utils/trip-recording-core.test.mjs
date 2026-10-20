/**
 * `utils/trip-recording-core.ts`の検証（`node --test src/utils/trip-recording-core.test.mjs`）。
 *
 * 無料版の記録対象は「記録中（非アーカイブ）の旅行のうち使用中の1件」。
 * Proから戻って記録中の旅行が複数ある場合も、データは書き換えず判定だけで1件に絞る。
 */
import { deepEqual, equal } from 'node:assert/strict';
import { test } from 'node:test';

import {
  canSwitchTripOnFree,
  isTripLockedOnFree,
  resolveRecordingTripId,
  sortLiveTrips,
} from './trip-recording-core.ts';

const trip = (id, { active = 0, created = '2026-10-01 10:00:00', archived = null } = {}) => ({
  id,
  is_active: active,
  created_at: created,
  archived_at: archived,
});

test('記録中の旅行が1件なら、それが記録対象', () => {
  equal(resolveRecordingTripId([trip(1, { active: 1 })]), 1);
});

test('旅行が無い・全部終了済みなら記録対象なし', () => {
  equal(resolveRecordingTripId([]), null);
  equal(resolveRecordingTripId([trip(1, { archived: '2026-10-02 00:00:00' })]), null);
});

test('終了済みの旅行は使用中フラグが残っていても記録対象にしない', () => {
  equal(resolveRecordingTripId([trip(1, { active: 1, archived: '2026-10-02 00:00:00' }), trip(2)]), 2);
});

test('Proから戻って記録中が複数：使用中の旅行を優先して記録対象にする', () => {
  const trips = [
    trip(1, { created: '2026-10-01 10:00:00' }),
    trip(2, { active: 1, created: '2026-09-01 10:00:00' }),
    trip(3, { created: '2026-10-10 10:00:00' }),
  ];
  equal(resolveRecordingTripId(trips), 2);
});

test('使用中が判定できない場合は、作成が新しい旅行（同時刻はidが大きい方）', () => {
  equal(resolveRecordingTripId([trip(1, { created: '2026-10-01 10:00:00' }), trip(3, { created: '2026-10-10 10:00:00' })]), 3);
  equal(resolveRecordingTripId([trip(4), trip(7), trip(5)]), 7);
});

test('並びは使用中→作成が新しい順。終了済みは含めない', () => {
  const sorted = sortLiveTrips([
    trip(1, { created: '2026-10-01 10:00:00' }),
    trip(2, { archived: '2026-10-05 00:00:00', created: '2026-10-20 10:00:00' }),
    trip(3, { created: '2026-10-10 10:00:00' }),
    trip(4, { active: 1, created: '2026-08-01 10:00:00' }),
  ]);
  deepEqual(sorted.map((t) => t.id), [4, 3, 1]);
});

test('閲覧のみ判定：記録対象以外の旅行（終了済み・Proで記録していた他の旅行）はロック', () => {
  equal(isTripLockedOnFree(2, 2), false);
  equal(isTripLockedOnFree(1, 2), true);
  equal(isTripLockedOnFree(1, null), true);
});

test('旅行に紐づかない古い記録はロックしない', () => {
  equal(isTripLockedOnFree(null, 2), false);
  equal(isTripLockedOnFree(undefined, null), false);
});

test('無料版の切替：記録対象がある間は別の旅行へ切り替えられない', () => {
  equal(canSwitchTripOnFree(2, 2), true);
  equal(canSwitchTripOnFree(3, 2), false);
  equal(canSwitchTripOnFree(3, null), true);
});

test('A（記録対象）+B+C：Aを終了して新しい旅行Dを始めると、記録対象はDだけ（B・Cは閲覧のみのまま）', () => {
  const ended = '2026-10-20 12:00:00';
  const after = [
    trip(1, { archived: ended }), // A：終了（使用中は解除される）
    trip(2, { created: '2026-09-01 10:00:00' }), // B
    trip(3, { created: '2026-09-15 10:00:00' }), // C
    trip(4, { active: 1, created: '2026-10-20 12:00:00' }), // D：新規作成で使用中
  ];
  const recording = resolveRecordingTripId(after);
  equal(recording, 4);
  equal(isTripLockedOnFree(1, recording), true);
  equal(isTripLockedOnFree(2, recording), true);
  equal(isTripLockedOnFree(3, recording), true);
  equal(canSwitchTripOnFree(2, recording), false);
});

test('A（記録対象）+B+C：Aだけを終了すると、作成が新しいCが次の記録対象になる（終了済みAには戻らない）', () => {
  const after = [
    trip(1, { archived: '2026-10-20 12:00:00' }),
    trip(2, { created: '2026-09-01 10:00:00' }),
    trip(3, { created: '2026-09-15 10:00:00' }),
  ];
  equal(resolveRecordingTripId(after), 3);
  equal(isTripLockedOnFree(1, 3), true);
});
