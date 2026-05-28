import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import {
  FREE_HISTORY_LIMIT,
  clearHistory,
  clearHistoryForTrip,
  deleteHistory,
  getHistory,
  getHistoryCount,
  getHistoryCountForTrip,
  getHistoryForTrip,
  insertHistory,
  markPurchased as markPurchasedQuery,
} from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useSettingsStore } from '@/stores/settings-store';
import { useTripStore } from '@/stores/trip-store';

export function useHistory() {
  const db = useSQLiteContext();
  const isPro = useSettingsStore((s) => s.isPro);
  const activeTrip = useTripStore((s) => s.activeTrip);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(async () => {
    const limit = isPro ? 500 : FREE_HISTORY_LIMIT;
    const [rows, count] = await Promise.all([
      activeTrip ? getHistoryForTrip(db, activeTrip.id, limit) : getHistory(db, limit),
      activeTrip ? getHistoryCountForTrip(db, activeTrip.id) : getHistoryCount(db),
    ]);
    setHistory(rows);
    setTotalCount(count);
  }, [db, isPro, activeTrip]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
  ) {
    if (!activeTrip) return;
    await insertHistory(db, {
      currency,
      foreign_amount: foreignAmount,
      jpy_amount: jpyAmount,
      rate_used: rateUsed,
      trip_id: activeTrip.id,
    });
    await load();
  }

  async function removeEntry(id: number) {
    await deleteHistory(db, id);
    await load();
  }

  async function clearAll() {
    if (activeTrip) {
      await clearHistoryForTrip(db, activeTrip.id);
    } else {
      await clearHistory(db);
    }
    await load();
  }

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    await markPurchasedQuery(db, id, currentValue === 0);
    await load();
  }

  const isAtFreeLimit = !isPro && totalCount >= FREE_HISTORY_LIMIT;

  return {
    history,
    totalCount,
    isAtFreeLimit,
    addEntry,
    removeEntry,
    clearAll,
    togglePurchased,
    reload: load,
  };
}
