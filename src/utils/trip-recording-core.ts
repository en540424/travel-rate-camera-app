/**
 * 無料版の「記録中の旅行」判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つ（`budget-core.ts`と同じ規律）。
 * Pro判定・development用バイパスは`config/limits.ts`側の責務。
 *
 * ■ 旅行の状態（2026-10-20 Human確定・スキーマ変更なし）
 *   - 記録中：`archived_at IS NULL`の旅行
 *   - 終了済み：`archived_at`が入った旅行（既存の「アーカイブ」）。記録・写真は削除しない
 *
 * ■ 無料版の記録対象は1件だけ（`FREE_LIMITS.trips = 1`）
 *   記録中の旅行のうち、使用中（`is_active = 1`）の旅行。無ければ作成が新しい順の先頭
 *   （`getActiveTrips`の並び・起動時に使用中を決める処理と同じ規則）。
 *   Proから戻った・既存データで記録中の旅行が複数あっても、**データは書き換えず**、
 *   記録対象以外を「無料版では新規記録・旅行の編集/再開ができない（保存済みの記録の閲覧・編集・削除・候補/購入済みの切替は可）」と扱う。
 *   `updated_at`は旅行切替のたびに全行が更新されるため、判定には使わない。
 *
 *   無料版では記録対象から別の旅行へ切り替えさせない（切り替えると記録対象が移り、
 *   複数の旅行へ交互に記録できてしまう＝Proの機能になる）。別の旅行を使うには今の旅行を終了する。
 */

/** 判定に必要な最小の行形。`TripRow`から必要な項目だけを受け取る */
export type RecordingTripCandidate = {
  id: number;
  is_active: number;
  created_at: string;
  archived_at: string | null;
};

/** 記録中（非アーカイブ）の旅行を、使用中→作成が新しい順（同時刻はidが大きい順）に並べる */
export function sortLiveTrips<T extends RecordingTripCandidate>(trips: readonly T[]): T[] {
  return trips
    .filter((t) => t.archived_at == null)
    .sort((a, b) => {
      if (a.is_active !== b.is_active) return b.is_active - a.is_active;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return b.id - a.id;
    });
}

/** 無料版で記録できる旅行のid。記録中の旅行が無ければnull */
export function resolveRecordingTripId(trips: readonly RecordingTripCandidate[]): number | null {
  return sortLiveTrips(trips)[0]?.id ?? null;
}

/**
 * 無料版で、この旅行が「閲覧のみ」か（新規記録・旅行の編集/再開ができない。保存済みの記録の編集は可）。
 * 旅行に紐づかない古い記録（`trip_id`がnull）は対象外として扱う（終了済み旅行の記録ではないため）。
 */
export function isTripLockedOnFree(
  tripId: number | null | undefined,
  recordingTripId: number | null,
): boolean {
  if (tripId == null) return false;
  return tripId !== recordingTripId;
}

/** 無料版で、この旅行へ切り替えられるか。記録対象が無いときだけ、別の旅行を記録対象にできる */
export function canSwitchTripOnFree(targetTripId: number, recordingTripId: number | null): boolean {
  return recordingTripId == null || targetTripId === recordingTripId;
}
