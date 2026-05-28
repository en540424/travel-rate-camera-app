import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import {
  FREE_HISTORY_LIMIT,
  clearHistory,
  deleteHistory,
  getHistory,
  getHistoryCount,
  insertHistory,
} from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useSettingsStore } from '@/stores/settings-store';

export function useHistory() {
  const db = useSQLiteContext();
  const isPro = useSettingsStore((s) => s.isPro);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(async () => {
    const limit = isPro ? 500 : FREE_HISTORY_LIMIT;
    const [rows, count] = await Promise.all([
      getHistory(db, limit),
      getHistoryCount(db),
    ]);
    setHistory(rows);
    setTotalCount(count);
  }, [db, isPro]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
  ) {
    await insertHistory(db, {
      currency,
      foreign_amount: foreignAmount,
      jpy_amount: jpyAmount,
      rate_used: rateUsed,
      trip_id: null,
    });
    await load();
  }

  async function removeEntry(id: number) {
    await deleteHistory(db, id);
    await load();
  }

  async function clearAll() {
    await clearHistory(db);
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
    reload: load,
  };
}
