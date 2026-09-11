import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { HistoryRow } from '@/db/queries/history';
import { deleteHistory, getBudgetTotalsByTrip, getHistory, markPurchased } from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';
import { getAllTrips } from '@/db/queries/trips';
import type { BudgetTotals } from '@/utils/budget-core';

export function useAllHistory() {
  const db = useSQLiteContext();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tripMap, setTripMap] = useState<Map<number, TripRow>>(new Map());
  /**
   * 旅行ごとの候補/購入済み件数・合計（SQL集計・全件）。旅行一覧・切替シートの残り予算はこれを使う。
   * `history`は表示用（最新2000件）であり、集計に使うと2001件目以降が黙って落ちる。
   */
  const [totalsByTrip, setTotalsByTrip] = useState<Map<number, BudgetTotals>>(new Map());

  const load = useCallback(async () => {
    const [rows, trips, totals] = await Promise.all([
      getHistory(db, 2000),
      getAllTrips(db),
      getBudgetTotalsByTrip(db),
    ]);
    setHistory(rows);
    setTripMap(new Map(trips.map((t) => [t.id, t])));
    setTotalsByTrip(totals);
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  /** DB書き込み成功後の再読込。SELECT失敗を書き込み失敗と混同しない（use-history.tsと同じ理由） */
  const reloadAfterWrite = useCallback(async () => {
    try {
      await load();
    } catch (e) {
      console.warn('[all-history reload after write]', e);
    }
  }, [load]);

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    await markPurchased(db, id, currentValue === 0);
    await reloadAfterWrite();
  }

  async function removeEntry(id: number) {
    await deleteHistory(db, id);
    await reloadAfterWrite();
  }

  return { history, tripMap, totalsByTrip, reload: load, togglePurchased, removeEntry };
}
