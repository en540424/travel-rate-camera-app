/**
 * Pro+のデータ（場所・記録との紐付け・予定）の状態と操作（純粋関数・`node --test`で検証）。
 *
 * ■ 保存先について（重要）
 * 本番の保存先は設計書§3-2・§10工程6の「DB v8（places・record_places・trip_events）」で、**Human承認（H-P5）と
 * db-guardianの確認が前提**のため、まだ既存DB（travelrate.db）へは入れていない。
 * それまでの間は、既存DBとは別のJSONファイル（`proplus-storage.ts`）へ保存する。既存のテーブル・migration・保存処理には触れない。
 * DB v8が承認されたら、このJSONを1回だけDBへ移す（`exportForMigration`）。状態の形はDB v8の列と1対1に揃えてある。
 *
 * ■ 守ること
 * - 削除は論理削除（`deletedAt`）。物理削除はしない
 * - 読み込めない（壊れた・新しい版の）ファイルを上書きしない（`proplus-storage.ts` が判定し、ここでは版を検査する）
 */
import {
  linkRecordToPlace, pruneAfterRecordsDeleted, validatePlaceInput,
  type Place, type PlaceInput, type RecordPlaceLink,
} from './places-core';
import { validateEventInput, type EventInput, type TripEvent } from './trip-events-core';

export const PROPLUS_STATE_VERSION = 1;

export type ProPlusState = {
  version: typeof PROPLUS_STATE_VERSION;
  places: Place[];
  links: RecordPlaceLink[];
  events: TripEvent[];
};

export const EMPTY_PROPLUS_STATE: ProPlusState = { version: PROPLUS_STATE_VERSION, places: [], links: [], events: [] };

export type Clock = { now: () => string; newId: () => string };

export type OpResult<T> = { ok: true; state: ProPlusState; value: T; warnings?: string[] } | { ok: false; errors: string[] };

/** 保存ファイルの中身を検査する。版が新しい・形が違う時は理由を返し、呼び出し側は上書きしない。 */
export function parseProPlusState(raw: unknown): { ok: true; state: ProPlusState } | { ok: false; reason: 'newer_version' | 'invalid' } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid' };
  const r = raw as Partial<ProPlusState> & { version?: unknown };
  if (typeof r.version !== 'number') return { ok: false, reason: 'invalid' };
  if (r.version > PROPLUS_STATE_VERSION) return { ok: false, reason: 'newer_version' };
  if (!Array.isArray(r.places) || !Array.isArray(r.links) || !Array.isArray(r.events)) return { ok: false, reason: 'invalid' };
  const placeOk = r.places.every((p) => p && typeof p.id === 'string' && typeof p.name === 'string');
  const linkOk = r.links.every((l) => l && typeof l.historyId === 'number' && typeof l.placeId === 'string');
  const eventOk = r.events.every((e) => e && typeof e.id === 'string' && typeof e.tripId === 'number' && typeof e.startsLocal === 'string');
  if (!placeOk || !linkOk || !eventOk) return { ok: false, reason: 'invalid' };
  return { ok: true, state: { version: PROPLUS_STATE_VERSION, places: r.places, links: r.links, events: r.events } };
}

export function hasAnyProPlusData(s: ProPlusState): boolean {
  return s.places.some((p) => p.deletedAt === null) || s.events.some((e) => e.deletedAt === null);
}

export function addPlace(s: ProPlusState, input: PlaceInput, clock: Clock): OpResult<Place> {
  const v = validatePlaceInput(input);
  if (!v.ok) return v;
  const now = clock.now();
  const place: Place = { ...v.value, id: clock.newId(), createdAt: now, updatedAt: now, deletedAt: null };
  return { ok: true, state: { ...s, places: [...s.places, place] }, value: place };
}

export function updatePlace(s: ProPlusState, id: string, input: PlaceInput, clock: Clock): OpResult<Place> {
  const cur = s.places.find((p) => p.id === id && p.deletedAt === null);
  if (!cur) return { ok: false, errors: ['場所が見つかりません'] };
  const v = validatePlaceInput({ tripId: cur.tripId, ...input });
  if (!v.ok) return v;
  const next: Place = { ...cur, ...v.value, updatedAt: clock.now() };
  return { ok: true, state: { ...s, places: s.places.map((p) => (p.id === id ? next : p)) }, value: next };
}

/** 場所を論理削除し、この場所への記録の紐付けと予定の場所を外す。 */
export function deletePlace(s: ProPlusState, id: string, clock: Clock): OpResult<null> {
  if (!s.places.some((p) => p.id === id && p.deletedAt === null)) return { ok: false, errors: ['場所が見つかりません'] };
  const now = clock.now();
  return {
    ok: true,
    value: null,
    state: {
      ...s,
      places: s.places.map((p) => (p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p)),
      links: s.links.filter((l) => l.placeId !== id),
      events: s.events.map((e) => (e.placeId === id ? { ...e, placeId: null, updatedAt: now } : e)),
    },
  };
}

export function setRecordPlace(s: ProPlusState, historyId: number, placeId: string | null): OpResult<null> {
  if (placeId && !s.places.some((p) => p.id === placeId && p.deletedAt === null)) return { ok: false, errors: ['場所が見つかりません'] };
  return { ok: true, state: { ...s, links: linkRecordToPlace(s.links, historyId, placeId) }, value: null };
}

/**
 * 記録が消えた後の整理。今ある記録IDの集合を受け取り、消えた記録の紐付けを外し、
 * どこからも参照されなくなった場所を論理削除する（予定から使われている場所は残す）。
 */
export function reconcileWithRecords(s: ProPlusState, existingHistoryIds: ReadonlySet<number>, clock: Clock): ProPlusState {
  const deleted = new Set(s.links.filter((l) => !existingHistoryIds.has(l.historyId)).map((l) => l.historyId));
  if (deleted.size === 0) return s;
  const usedByEvents = new Set(s.events.filter((e) => e.deletedAt === null && e.placeId).map((e) => e.placeId as string));
  const r = pruneAfterRecordsDeleted(s.links, existingHistoryIds, usedByEvents, deleted);
  // 記録から作った場所のうち、手で登録しただけの場所（紐付けが元から無い）は消さない：pruneは「紐付けがあった場所」だけを返す
  const now = clock.now();
  const orphan = new Set(r.orphanPlaceIds);
  return {
    ...s,
    links: r.links,
    places: s.places.map((p) => (orphan.has(p.id) && p.deletedAt === null ? { ...p, deletedAt: now, updatedAt: now } : p)),
  };
}

function checkEventPlace(s: ProPlusState, placeId: string | null | undefined): string[] {
  if (!placeId) return [];
  return s.places.some((p) => p.id === placeId && p.deletedAt === null) ? [] : ['予定の場所が見つかりません'];
}

export function addEvent(
  s: ProPlusState, input: EventInput, clock: Clock, trip?: { startDate: string | null; endDate: string | null },
): OpResult<TripEvent> {
  const v = validateEventInput(input, trip);
  if (!v.ok) return v;
  const placeErrors = checkEventPlace(s, v.value.placeId);
  if (placeErrors.length) return { ok: false, errors: placeErrors };
  const now = clock.now();
  const ev: TripEvent = { ...v.value, id: clock.newId(), createdAt: now, updatedAt: now, deletedAt: null };
  return { ok: true, state: { ...s, events: [...s.events, ev] }, value: ev, warnings: v.warnings };
}

export function updateEvent(
  s: ProPlusState, id: string, input: EventInput, clock: Clock, trip?: { startDate: string | null; endDate: string | null },
): OpResult<TripEvent> {
  const cur = s.events.find((e) => e.id === id && e.deletedAt === null);
  if (!cur) return { ok: false, errors: ['予定が見つかりません'] };
  const v = validateEventInput({ ...input, tripId: cur.tripId }, trip);
  if (!v.ok) return v;
  const placeErrors = checkEventPlace(s, v.value.placeId);
  if (placeErrors.length) return { ok: false, errors: placeErrors };
  const next: TripEvent = { ...cur, ...v.value, updatedAt: clock.now() };
  return { ok: true, state: { ...s, events: s.events.map((e) => (e.id === id ? next : e)) }, value: next, warnings: v.warnings };
}

export function deleteEvent(s: ProPlusState, id: string, clock: Clock): OpResult<null> {
  if (!s.events.some((e) => e.id === id && e.deletedAt === null)) return { ok: false, errors: ['予定が見つかりません'] };
  const now = clock.now();
  return { ok: true, value: null, state: { ...s, events: s.events.map((e) => (e.id === id ? { ...e, deletedAt: now, updatedAt: now } : e)) } };
}

/** DB v8へ移す時の行（論理削除も含めて全部。同期・監査のため）。 */
export function exportForMigration(s: ProPlusState) {
  return {
    places: s.places.map((p) => ({
      uuid: p.id, name: p.name, lat: p.lat, lng: p.lng, coord_source: p.coordSource, apple_place_id: p.applePlaceId,
      memo: p.memo, trip_id: p.tripId, created_at: p.createdAt, updated_at: p.updatedAt, deleted_at: p.deletedAt,
    })),
    record_places: s.links.map((l) => ({ history_id: l.historyId, place_uuid: l.placeId })),
    trip_events: s.events.map((e) => ({
      uuid: e.id, trip_id: e.tripId, kind: e.kind, title: e.title, starts_local: e.startsLocal, ends_local: e.endsLocal,
      tz_iana: e.tz, all_day: e.allDay ? 1 : 0, place_uuid: e.placeId, memo: e.memo,
      created_at: e.createdAt, updated_at: e.updatedAt, deleted_at: e.deletedAt,
    })),
  };
}

/** 端末内で使うID（UUID v4形式）。crypto.randomUUIDが無い環境ではMath.randomで作る（端末内の識別だけに使う）。 */
export function newLocalId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
