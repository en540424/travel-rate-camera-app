import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import {
  archiveTrip,
  getActiveTrips,
  getTripById,
  insertTrip,
  setActiveTrip as setActiveTripInDb,
  updateTrip,
} from '@/db/queries/trips';
import type { TripRow } from '@/db/queries/trips';
import { useSettingsStore } from '@/stores/settings-store';
import { useTripStore } from '@/stores/trip-store';

export function useTrips() {
  const db = useSQLiteContext();
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

  async function createTrip(
    name: string,
    budgetJpy: number,
    currency: CurrencyCode,
    rate: number = 0,
  ): Promise<TripRow> {
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
    if (updated && activeTrip?.id === id) setActiveTrip(updated);
  }

  async function removeTrip(id: number): Promise<void> {
    await archiveTrip(db, id);
    if (activeTrip?.id === id) {
      const remaining = await loadTrips();
      const next = remaining[0] ?? null;
      setActiveTrip(next);
      if (next) {
        useSettingsStore.getState().setSelectedCurrency(next.base_currency);
      } else {
        useSettingsStore.getState().setSelectedCurrency('USD');
      }
    }
  }

  async function switchTrip(id: number): Promise<void> {
    await setActiveTripInDb(db, id);
    const trip = await getTripById(db, id);
    if (trip) {
      setActiveTrip(trip);
      useSettingsStore.getState().setSelectedCurrency(trip.base_currency);
    }
  }

  return { activeTrip, loadTrips, createTrip, editTrip, removeTrip, switchTrip };
}
