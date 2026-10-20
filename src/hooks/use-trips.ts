// Web用: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .native.ts を iOS/Android で優先採用するため、
// use-trips.native.ts（expo-sqlite 使用）はネイティブのみで使われる。
import { useCallback, useEffect } from 'react';

import { canCreateTrip, canRestoreTrip, canSwitchTrip, isTripReadOnly } from '@/config/limits';
import type { CurrencyCode } from '@/constants/currencies';
import type { TripRow } from '@/db/queries/trips';
import { useIsPro } from '@/hooks/use-purchases';
import { useSettingsStore } from '@/stores/settings-store';
import { useTripStore } from '@/stores/trip-store';
import { resolveRecordingTripId, sortLiveTrips } from '@/utils/trip-recording-core';

const STORAGE_KEY = 'travelrate:trips';
let idCounter = Date.now();

function loadAll(): TripRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<TripRow>[]).map((t) => ({
      id: t.id ?? 0,
      name: t.name ?? '',
      base_currency: (t.base_currency ?? (t as Record<string, unknown>).currency ?? 'USD') as CurrencyCode,
      target_currency: t.target_currency ?? 'JPY',
      manual_rate: t.manual_rate ?? (t as Record<string, unknown>).rate as number ?? 0,
      budget_jpy: t.budget_jpy ?? 0,
      started_at: t.started_at ?? null,
      ended_at: t.ended_at ?? null,
      is_active: (t.is_active === 1 ? 1 : 0) as 0 | 1,
      created_at: t.created_at ?? '',
      updated_at: t.updated_at ?? t.created_at ?? '',
      archived_at: t.archived_at ?? null,
    }));
  } catch {
    return [];
  }
}

function persistAll(rows: TripRow[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {}
}

export function useTrips() {
  const isPro = useIsPro();
  const { activeTrip, setActiveTrip } = useTripStore();

  const loadTrips = useCallback((): Promise<TripRow[]> => {
    return Promise.resolve(
      loadAll()
        .filter((t) => t.archived_at === null)
        .sort((a, b) => b.is_active - a.is_active),
    );
  }, []);

  useEffect(() => {
    if (activeTrip !== null) return;
    loadTrips().then((trips) => {
      const trip = trips.find((t) => t.is_active === 1) ?? trips[0] ?? null;
      if (trip) {
        setActiveTrip(trip);
        useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
      }
    });
  }, [activeTrip, loadTrips, setActiveTrip]);

  /** 無料版は非アーカイブの旅行数がFREE_LIMITS.trips以上ならブロックする（Proは無制限。development／__DEV__時はDEV_BYPASS_FREE_LIMITSで無視）。旅行新規作成の唯一の入口。 */
  async function createTrip(
    name: string,
    budgetJpy: number,
    currency: CurrencyCode,
    rate: number = 0,
  ): Promise<TripRow | null> {
    const activeCount = loadAll().filter((t) => t.archived_at === null).length;
    if (!canCreateTrip(isPro, activeCount)) return null;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    // 既存を全て非アクティブ化
    const all = loadAll().map((t) => ({ ...t, is_active: 0 as 0 | 1, updated_at: now }));
    const trip: TripRow = {
      id: idCounter++,
      name,
      base_currency: currency,
      target_currency: 'JPY',
      manual_rate: rate,
      budget_jpy: budgetJpy,
      started_at: null,
      ended_at: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    persistAll([trip, ...all]);
    setActiveTrip(trip);
    useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    return trip;
  }

  async function editTrip(
    id: number,
    fields: Partial<Pick<TripRow, 'name' | 'budget_jpy' | 'base_currency' | 'manual_rate' | 'started_at' | 'ended_at'>>,
  ): Promise<void> {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const all = loadAll().map((t) =>
      t.id === id ? { ...t, ...fields, updated_at: now } : t,
    );
    persistAll(all);
    const updated = all.find((t) => t.id === id) ?? null;
    if (updated && activeTrip?.id === id) {
      setActiveTrip(updated);
      if (fields.base_currency) {
        useSettingsStore.getState().setSelectedCurrency(fields.base_currency);
      }
    }
  }

  async function removeTrip(id: number): Promise<void> {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const archived = loadAll().map((t) =>
      t.id === id ? { ...t, archived_at: now, is_active: 0 as 0 | 1, updated_at: now } : t,
    );
    if (activeTrip?.id !== id) {
      persistAll(archived);
      return;
    }
    const remaining = archived.filter((t) => t.archived_at === null);
    const next = remaining[0] ?? null;
    // DB(localStorage)側のis_activeも新しいactive旅行に付け替える（switchTripと同じ考え方）
    const all = archived.map((t) => ({
      ...t,
      is_active: (next != null && t.id === next.id ? 1 : 0) as 0 | 1,
    }));
    persistAll(all);
    const updatedNext = next ? all.find((t) => t.id === next.id) ?? null : null;
    setActiveTrip(updatedNext);
    if (updatedNext) {
      useSettingsStore.getState().setSelectedCurrency(updatedNext.base_currency);
    } else {
      useSettingsStore.getState().setSelectedCurrency('USD');
    }
  }

  /** 使用中の旅行を切り替える。無料版は記録対象がある間、別の旅行へ切り替えない（native版と同じ契約） */
  async function switchTrip(id: number): Promise<{ blocked: boolean }> {
    const live = loadAll().filter((t) => t.archived_at === null);
    if (!live.some((t) => t.id === id)) return { blocked: true };
    if (!canSwitchTrip(isPro, id, resolveRecordingTripId(live))) return { blocked: true };
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const all = loadAll().map((t) => ({
      ...t,
      is_active: (t.id === id ? 1 : 0) as 0 | 1,
      updated_at: now,
    }));
    persistAll(all);
    const trip = all.find((t) => t.id === id) ?? null;
    if (trip) {
      setActiveTrip(trip);
      useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    }
    return { blocked: false };
  }

  /** 今の記録対象の旅行を終了して、新しい旅行を作成する（native版と同じ契約。件数の判定はしない） */
  async function endCurrentAndCreateTrip(
    name: string,
    budgetJpy: number,
    currency: CurrencyCode,
    rate: number = 0,
  ): Promise<TripRow> {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const recordingTripId = resolveRecordingTripId(loadAll());
    const all = loadAll().map((t) => ({
      ...t,
      archived_at: t.id === recordingTripId ? now : t.archived_at,
      is_active: 0 as 0 | 1,
      updated_at: now,
    }));
    const trip: TripRow = {
      id: idCounter++,
      name,
      base_currency: currency,
      target_currency: 'JPY',
      manual_rate: rate,
      budget_jpy: budgetJpy,
      started_at: null,
      ended_at: null,
      is_active: 1,
      created_at: now,
      updated_at: now,
      archived_at: null,
    };
    persistAll([trip, ...all]);
    setActiveTrip(trip);
    useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    return trip;
  }

  /** 今の記録対象の旅行を終了して、記録中の別の旅行へ切り替える（native版と同じ契約） */
  async function endCurrentAndSwitchTrip(id: number): Promise<void> {
    const live = sortLiveTrips(loadAll());
    if (!live.some((t) => t.id === id)) throw new Error('Switch target is not a live trip');
    const recordingTripId = resolveRecordingTripId(live);
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const all = loadAll().map((t) => ({
      ...t,
      archived_at: t.id === recordingTripId && t.id !== id ? now : t.archived_at,
      is_active: (t.id === id ? 1 : 0) as 0 | 1,
      updated_at: now,
    }));
    persistAll(all);
    const trip = all.find((t) => t.id === id) ?? null;
    if (trip) {
      setActiveTrip(trip);
      useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    }
  }

  /**
   * アーカイブ済み旅行を復元。復元のみ行い、自動でのアクティブ化はしない（安全側）。
   * 無料版は終了した旅行を再開できない（native版と同じ契約）。
   */
  async function restoreTrip(id: number): Promise<{ blocked: boolean }> {
    if (!canRestoreTrip(isPro)) return { blocked: true };
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const all = loadAll().map((t) =>
      t.id === id ? { ...t, archived_at: null, updated_at: now } : t,
    );
    persistAll(all);
    return { blocked: false };
  }

  /** この旅行が閲覧のみか（native版と同じ契約） */
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
