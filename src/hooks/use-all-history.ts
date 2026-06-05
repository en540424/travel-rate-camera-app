import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { HistoryRow } from '@/db/queries/history';
import { getHistory, markPurchased } from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';
import { getAllTrips } from '@/db/queries/trips';

export function useAllHistory() {
  const db = useSQLiteContext();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tripMap, setTripMap] = useState<Map<number, TripRow>>(new Map());

  const load = useCallback(async () => {
    const [rows, trips] = await Promise.all([
      getHistory(db, 2000),
      getAllTrips(db),
    ]);
    setHistory(rows);
    setTripMap(new Map(trips.map((t) => [t.id, t])));
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    await markPurchased(db, id, currentValue === 0);
    await load();
  }

  return { history, tripMap, reload: load, togglePurchased };
}
