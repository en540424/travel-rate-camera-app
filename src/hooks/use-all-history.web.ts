// Web用: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .web.ts を Web ビルドで優先採用する。
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';

const HISTORY_KEY = 'travelrate:history';
const TRIPS_KEY   = 'travelrate:trips';

function loadAllHistory(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<HistoryRow & { purchase_date?: string }>[]).map((r) => ({
      id: r.id ?? 0,
      currency: (r.currency ?? 'USD') as CurrencyCode,
      foreign_amount: r.foreign_amount ?? 0,
      jpy_amount: r.jpy_amount ?? 0,
      rate_used: r.rate_used ?? 0,
      trip_id: r.trip_id ?? null,
      is_purchased: (r.is_purchased === 1 ? 1 : 0) as 0 | 1,
      purchased_at: r.purchased_at ?? (r as Record<string, unknown>).purchase_date as string ?? null,
      updated_at: r.updated_at ?? null,
      created_at: r.created_at ?? '',
      memo: r.memo ?? null,
      image_uri: r.image_uri ?? null,
      entry_date: r.entry_date ?? null,
    }));
  } catch {
    return [];
  }
}

function loadAllTrips(): TripRow[] {
  try {
    const raw = localStorage.getItem(TRIPS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<TripRow>[]).map((t) => ({
      id: t.id ?? 0,
      name: t.name ?? '',
      base_currency: (t.base_currency ?? 'USD') as CurrencyCode,
      target_currency: t.target_currency ?? 'JPY',
      manual_rate: t.manual_rate ?? 0,
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

function persistHistory(rows: HistoryRow[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows));
  } catch {}
}

export function useAllHistory() {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tripMap, setTripMap] = useState<Map<number, TripRow>>(new Map());

  const load = useCallback(() => {
    const rows = loadAllHistory();
    const trips = loadAllTrips();
    setHistory(rows);
    setTripMap(new Map(trips.map((t) => [t.id, t])));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    const isPurchased = currentValue === 0;
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    persistHistory(
      loadAllHistory().map((r) =>
        r.id === id
          ? {
              ...r,
              is_purchased: (isPurchased ? 1 : 0) as 0 | 1,
              purchased_at: isPurchased ? now : null,
              updated_at: now,
            }
          : r,
      ),
    );
    load();
  }

  async function removeEntry(id: number) {
    persistHistory(loadAllHistory().filter((r) => r.id !== id));
    load();
  }

  return { history, tripMap, reload: load, togglePurchased, removeEntry };
}
