/**
 * Pro+ 買い物マップ：保存地点の純粋ロジック（import 0件・`node --test`で検証）。
 *
 * 設計の正本：Vault `旅レートカメラ_ProPlus中核3機能_技術設計・原価制御_2026-11-04` §2・§3-2。
 * - 保存するのは「端末GPSの座標」「利用者が入力した店名・座標」「Apple Place ID」だけ。
 *   地図検索の結果（名称・住所・座標）は保存しない（Apple DPLA Attachment 6 §2.5）。そのため `coordSource` は
 *   'device_gps' | 'manual' | null のみで、検索由来の値を表す種類を持たない
 * - 場所は旅行に固定しない（別の旅行での再訪を表せる）。旅行との関係は記録・予定の側から引く
 * - 削除は論理削除（`deletedAt`）
 */

export type CoordSource = 'device_gps' | 'manual';

export type Place = {
  /** 端末で発行するUUID */
  id: string;
  /** 利用者が入力した店名・地点名 */
  name: string;
  lat: number | null;
  lng: number | null;
  coordSource: CoordSource | null;
  /** Apple Place ID（iOS 18以降・保存可）。無ければnull */
  applePlaceId: string | null;
  memo: string;
  /** この場所を最初に登録した旅行（一覧の絞り込み用。場所そのものは旅行に固定しない） */
  tripId: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** 記録（conversion_history の1行）と場所の紐付け。1つの記録に場所は1つ */
export type RecordPlaceLink = {
  historyId: number;
  placeId: string;
};

export const PLACE_NAME_MAX = 60;
export const PLACE_MEMO_MAX = 500;

export type PlaceInput = {
  name: string;
  lat?: number | string | null;
  lng?: number | string | null;
  coordSource?: CoordSource | null;
  applePlaceId?: string | null;
  memo?: string;
  tripId?: number | null;
};

export type PlaceValidation =
  | { ok: true; value: Omit<Place, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> }
  | { ok: false; errors: string[] };

function toCoord(v: number | string | null | undefined): number | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : 'invalid';
  }
  return Number.isFinite(v) ? v : 'invalid';
}

/** 入力を検証して保存できる形にする。座標は緯度・経度の両方があるか、両方無いかのどちらか。 */
export function validatePlaceInput(input: PlaceInput): PlaceValidation {
  const errors: string[] = [];
  const name = (input.name ?? '').trim();
  if (name === '') errors.push('店名・地点名を入力してください');
  if (name.length > PLACE_NAME_MAX) errors.push(`店名・地点名は${PLACE_NAME_MAX}文字までです`);
  const memo = (input.memo ?? '').trim();
  if (memo.length > PLACE_MEMO_MAX) errors.push(`メモは${PLACE_MEMO_MAX}文字までです`);

  const lat = toCoord(input.lat);
  const lng = toCoord(input.lng);
  if (lat === 'invalid' || lng === 'invalid') errors.push('緯度・経度は数値で入力してください');
  else if ((lat === null) !== (lng === null)) errors.push('緯度と経度は両方入力してください');
  else if (lat !== null && lng !== null) {
    if (lat < -90 || lat > 90) errors.push('緯度は-90〜90の範囲です');
    if (lng < -180 || lng > 180) errors.push('経度は-180〜180の範囲です');
  }
  if (errors.length) return { ok: false, errors };

  const hasCoord = lat !== null && lng !== null;
  return {
    ok: true,
    value: {
      name,
      lat: hasCoord ? (lat as number) : null,
      lng: hasCoord ? (lng as number) : null,
      coordSource: hasCoord ? (input.coordSource ?? 'manual') : null,
      applePlaceId: input.applePlaceId?.trim() || null,
      memo,
      tripId: input.tripId ?? null,
    },
  };
}

export function hasCoordinate(p: Pick<Place, 'lat' | 'lng'>): p is { lat: number; lng: number } {
  return typeof p.lat === 'number' && typeof p.lng === 'number';
}

const EARTH_RADIUS_M = 6371008.8;

/** 2点間の距離（メートル・大円距離）。 */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** 距離の表示（例：850 m／1.2 km／24 km）。 */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

export type PlaceWithDistance = Place & { distanceM: number | null };

/**
 * 一覧の並び。現在地があれば近い順（座標の無い場所は後ろ）、無ければ更新が新しい順。
 * 削除済みは含めない。tripIdを指定するとその旅行で登録した場所に絞る。
 */
export function sortPlaces(
  places: Place[],
  here: { lat: number; lng: number } | null,
  tripId?: number | null,
): PlaceWithDistance[] {
  const list = places
    .filter((p) => p.deletedAt === null)
    .filter((p) => tripId === undefined || tripId === null || p.tripId === tripId)
    .map((p) => ({ ...p, distanceM: here && hasCoordinate(p) ? distanceMeters(here, p) : null }));
  return list.sort((a, b) => {
    if (here) {
      if (a.distanceM === null && b.distanceM !== null) return 1;
      if (a.distanceM !== null && b.distanceM === null) return -1;
      if (a.distanceM !== null && b.distanceM !== null && a.distanceM !== b.distanceM) return a.distanceM - b.distanceM;
    }
    return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  });
}

export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

/** ピンがすべて入る表示範囲。点が無ければnull、1点なら周囲約1km。 */
export function regionForPoints(points: { lat: number; lng: number }[], paddingRatio = 0.3): MapRegion | null {
  if (points.length === 0) return null;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const MIN_DELTA = 0.01;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * (1 + paddingRatio)),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * (1 + paddingRatio)),
  };
}

export type ExternalMapApp = 'apple' | 'google';

/**
 * 外部の地図アプリで経路案内を開くURL（鍵不要）。
 * - 座標があれば座標を目的地にする（端末GPS・手入力の座標はApple・Googleのどちらにも渡せる）
 * - 座標が無ければ利用者が入力した店名で検索させる
 * Apple: https://maps.apple.com/?daddr=… ／ Google Maps URLs: https://www.google.com/maps/dir/?api=1&destination=…
 */
export function externalNavigationUrl(place: Pick<Place, 'name' | 'lat' | 'lng'>, app: ExternalMapApp): string {
  const dest = hasCoordinate(place) ? `${place.lat},${place.lng}` : place.name;
  if (app === 'apple') {
    const q = hasCoordinate(place) ? `&q=${encodeURIComponent(place.name)}` : '';
    return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&dirflg=w${q}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=walking`;
}

/** 記録に紐付いた場所を引く（削除済みの場所・孤児のリンクは除く）。 */
export function placeForRecord(historyId: number, links: RecordPlaceLink[], places: Place[]): Place | null {
  const link = links.find((l) => l.historyId === historyId);
  if (!link) return null;
  const place = places.find((p) => p.id === link.placeId);
  return place && place.deletedAt === null ? place : null;
}

/** 場所ごとの記録ID（ピン詳細で「この場所の記録」を出す用）。存在しない記録のリンクは除く。 */
export function recordIdsForPlace(placeId: string, links: RecordPlaceLink[], existingHistoryIds: ReadonlySet<number>): number[] {
  return links.filter((l) => l.placeId === placeId && existingHistoryIds.has(l.historyId)).map((l) => l.historyId);
}

/** 記録に場所を紐付ける（既にあれば置き換え）。新しい配列を返す。 */
export function linkRecordToPlace(links: RecordPlaceLink[], historyId: number, placeId: string | null): RecordPlaceLink[] {
  const rest = links.filter((l) => l.historyId !== historyId);
  return placeId ? [...rest, { historyId, placeId }] : rest;
}

/**
 * 記録の一括削除のあとに、消えた記録へのリンクを外し、どこからも参照されない場所を論理削除する対象として返す。
 * 別の旅行・予定から参照されている場所は残す（設計書§3-2「履歴の一括削除」）。
 */
export function pruneAfterRecordsDeleted(
  links: RecordPlaceLink[],
  existingHistoryIds: ReadonlySet<number>,
  placeIdsReferencedByEvents: ReadonlySet<string>,
  deletedHistoryIds: ReadonlySet<number>,
): { links: RecordPlaceLink[]; orphanPlaceIds: string[] } {
  const affected = new Set(links.filter((l) => deletedHistoryIds.has(l.historyId)).map((l) => l.placeId));
  const kept = links.filter((l) => existingHistoryIds.has(l.historyId) && !deletedHistoryIds.has(l.historyId));
  const stillUsed = new Set(kept.map((l) => l.placeId));
  const orphanPlaceIds = [...affected].filter((id) => !stillUsed.has(id) && !placeIdsReferencedByEvents.has(id));
  return { links: kept, orphanPlaceIds };
}
