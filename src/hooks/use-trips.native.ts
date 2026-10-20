import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect } from 'react';

import { canCreateTrip, canRestoreTrip, canSwitchTrip, isTripReadOnly } from '@/config/limits';
import type { CurrencyCode } from '@/constants/currencies';
import {
  archiveTrip,
  getActiveTrips,
  getTripById,
  insertTrip,
  restoreTrip as restoreTripInDb,
  setActiveTrip as setActiveTripInDb,
  updateTrip,
} from '@/db/queries/trips';
import type { TripRow } from '@/db/queries/trips';
import { useIsPro } from '@/hooks/use-purchases';
import { useSettingsStore } from '@/stores/settings-store';
import { useTripStore } from '@/stores/trip-store';
import { resolveRecordingTripId } from '@/utils/trip-recording-core';

export function useTrips() {
  const db = useSQLiteContext();
  const isPro = useIsPro();
  const { activeTrip, setActiveTrip } = useTripStore();

  const loadTrips = useCallback(async (): Promise<TripRow[]> => {
    return getActiveTrips(db);
  }, [db]);

  /** 初回マウント時：is_active=1 の旅行、なければ最新をアクティブにする */
  useEffect(() => {
    if (activeTrip !== null) return;
    loadTrips().then((trips) => {
      const trip = trips.find((t) => t.is_active === 1) ?? trips[0] ?? null;
      if (trip) {
        setActiveTrip(trip);
        useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
      }
    }).catch(console.error);
  }, [activeTrip, loadTrips, setActiveTrip]);

  /** 無料版は非アーカイブの旅行数がFREE_LIMITS.trips以上ならブロックする（Proは無制限。development／__DEV__時はDEV_BYPASS_FREE_LIMITSで無視）。旅行新規作成の唯一の入口。 */
  async function createTrip(
    name: string,
    budgetJpy: number,
    currency: CurrencyCode,
    rate: number = 0,
  ): Promise<TripRow | null> {
    const active = await getActiveTrips(db);
    if (!canCreateTrip(isPro, active.length)) return null;
    // 既存を全て非アクティブ化してから新規作成
    await db.runAsync("UPDATE trips SET is_active = 0, updated_at = datetime('now')");
    const id = await insertTrip(db, {
      name,
      budget_jpy: budgetJpy,
      base_currency: currency,
      manual_rate: rate,
    });
    await db.runAsync("UPDATE trips SET is_active = 1, updated_at = datetime('now') WHERE id = ?", id);
    const trip = await getTripById(db, id);
    if (!trip) throw new Error('Trip creation failed');
    setActiveTrip(trip);
    useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    return trip;
  }

  async function editTrip(
    id: number,
    fields: Partial<Pick<TripRow, 'name' | 'budget_jpy' | 'base_currency' | 'manual_rate' | 'started_at' | 'ended_at'>>,
  ): Promise<void> {
    await updateTrip(db, id, fields);
    const updated = await getTripById(db, id);
    if (updated && activeTrip?.id === id) {
      setActiveTrip(updated);
      if (fields.base_currency) {
        useSettingsStore.getState().setSelectedCurrency(fields.base_currency);
      }
    }
  }

  async function removeTrip(id: number): Promise<void> {
    await archiveTrip(db, id);
    if (activeTrip?.id === id) {
      const remaining = await loadTrips();
      const next = remaining[0] ?? null;
      if (next) {
        // DB側のis_activeも新しいactive旅行に付け替える（switchTripと同じ経路を再利用）
        await setActiveTripInDb(db, next.id);
        const trip = await getTripById(db, next.id);
        setActiveTrip(trip);
        if (trip) useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
      } else {
        setActiveTrip(null);
        useSettingsStore.getState().setSelectedCurrency('USD');
      }
    }
  }

  /**
   * 使用中の旅行を切り替える。切替処理そのもの（`setActiveTripInDb`）は従来どおりで、その手前に上限の判定だけを置く。
   *
   * 無料版は記録対象（記録中の旅行のうち使用中の1件）がある間、別の旅行へ切り替えない（`canSwitchTrip`）。
   * 終了済みの旅行へは切り替えない（再開はProの`restoreTrip`のみ）。
   * ブロック時はDBに触らず`{ blocked: true }`を返す（呼び出し側が「記録中の旅行は1件まで」の案内を出す）。
   */
  async function switchTrip(id: number): Promise<{ blocked: boolean }> {
    const live = await getActiveTrips(db);
    if (!live.some((t) => t.id === id)) return { blocked: true };
    if (!canSwitchTrip(isPro, id, resolveRecordingTripId(live))) return { blocked: true };
    await setActiveTripInDb(db, id);
    const trip = await getTripById(db, id);
    if (trip) {
      setActiveTrip(trip);
      useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    }
    return { blocked: false };
  }

  /**
   * 今の記録対象の旅行を終了（アーカイブ）して、新しい旅行を作成する。無料版の「記録中の旅行は1件まで」の案内から呼ぶ。
   *
   * 終了と作成は1つのtransactionで行う（途中で失敗しても「終了だけされて新しい旅行が無い」状態を残さない）。
   * 終了するのは記録対象の1件だけ。Proから戻って記録中の旅行が他にもある場合、それらは閲覧のみのまま残す
   * （ここで件数の判定をやり直すとそれらが数に入り、案内が繰り返し出てしまうため、判定はしない）。
   * 旅行・記録・写真は削除しない。
   */
  async function endCurrentAndCreateTrip(
    name: string,
    budgetJpy: number,
    currency: CurrencyCode,
    rate: number = 0,
  ): Promise<TripRow> {
    let id = 0;
    await db.withTransactionAsync(async () => {
      const recordingTripId = resolveRecordingTripId(await getActiveTrips(db));
      if (recordingTripId != null) await archiveTrip(db, recordingTripId);
      await db.runAsync("UPDATE trips SET is_active = 0, updated_at = datetime('now')");
      id = await insertTrip(db, {
        name,
        budget_jpy: budgetJpy,
        base_currency: currency,
        manual_rate: rate,
      });
      await db.runAsync("UPDATE trips SET is_active = 1, updated_at = datetime('now') WHERE id = ?", id);
    });
    const trip = await getTripById(db, id);
    if (!trip) throw new Error('Trip creation failed');
    setActiveTrip(trip);
    useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    return trip;
  }

  /**
   * 今の記録対象の旅行を終了（アーカイブ）して、記録中の別の旅行へ切り替える（Proから戻って記録中の旅行が複数ある場合）。
   * 終了と切替は1つのtransactionで行う。切替先が記録中でなければ何もしない。旅行・記録・写真は削除しない。
   */
  async function endCurrentAndSwitchTrip(id: number): Promise<void> {
    await db.withTransactionAsync(async () => {
      const live = await getActiveTrips(db);
      if (!live.some((t) => t.id === id)) throw new Error('Switch target is not a live trip');
      const recordingTripId = resolveRecordingTripId(live);
      if (recordingTripId != null && recordingTripId !== id) await archiveTrip(db, recordingTripId);
      await setActiveTripInDb(db, id);
    });
    const trip = await getTripById(db, id);
    if (trip) {
      setActiveTrip(trip);
      useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    }
  }

  /**
   * アーカイブ済み旅行を復元（記録中へ戻す）。復元のみ行い、自動でのアクティブ化はしない（安全側）。
   *
   * 無料版は終了した旅行を再開できない（`canRestoreTrip`。記録中の旅行が0件でも不可）。Proは再開できる。
   * ブロック時はDBに触らず`{ blocked: true }`を返す。既存データ・アーカイブ済み旅行は削除しない。
   */
  async function restoreTrip(id: number): Promise<{ blocked: boolean }> {
    if (!canRestoreTrip(isPro)) return { blocked: true };
    await restoreTripInDb(db, id);
    return { blocked: false };
  }

  /**
   * この旅行が閲覧のみか（無料版で記録対象以外の旅行）。無料版の記録対象＝使用中の旅行
   * （無料版は記録対象から別の旅行へ切り替えられないため、使用中の旅行が常に記録対象になる）。
   */
  function isReadOnlyTrip(tripId: number | null | undefined): boolean {
    const recordingTripId = activeTrip != null && activeTrip.archived_at == null ? activeTrip.id : null;
    return isTripReadOnly(isPro, tripId, recordingTripId);
  }

  return {
    activeTrip,
    loadTrips,
    createTrip,
    endCurrentAndCreateTrip,
    editTrip,
    removeTrip,
    switchTrip,
    endCurrentAndSwitchTrip,
    restoreTrip,
    isReadOnlyTrip,
  };
}
