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
  updateAmount as updateAmountQuery,
  updateEntryDate as updateEntryDateQuery,
  updateImageUri as updateImageUriQuery,
  updateMemo as updateMemoQuery,
} from '@/db/queries/history';
import type { HistoryRow } from '@/db/queries/history';
import { useIsPro } from '@/hooks/use-purchases';
import { useTripStore } from '@/stores/trip-store';

export function useHistory() {
  const db = useSQLiteContext();
  const isPro = useIsPro();
  const activeTrip = useTripStore((s) => s.activeTrip);

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const load = useCallback(async () => {
    // 初回MVPは保存上限を露出しない方針のため、表示件数はFREE_HISTORY_LIMIT(30)で切らない（P0-04）。
    // Pro側と同じ上限(500)を無料版でも使う。FREE_LIMITS.saves自体は変更しない。
    const limit = 500;
    const [rows, count] = await Promise.all([
      activeTrip ? getHistoryForTrip(db, activeTrip.id, limit) : getHistory(db, limit),
      activeTrip ? getHistoryCountForTrip(db, activeTrip.id) : getHistoryCount(db),
    ]);
    setHistory(rows);
    setTotalCount(count);
  }, [db, activeTrip]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
    memo?: string,
    imageUri?: string,
    isPurchased?: boolean,
  ) {
    if (!activeTrip) return;
    await insertHistory(
      db,
      {
        currency,
        foreign_amount: foreignAmount,
        jpy_amount: jpyAmount,
        rate_used: rateUsed,
        trip_id: activeTrip.id,
      },
      memo,
      imageUri,
      isPurchased,
    );
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

  async function updateAmount(id: number, foreignAmount: number, jpyAmount: number) {
    await updateAmountQuery(db, id, foreignAmount, jpyAmount);
    await load();
  }

  async function updateMemo(id: number, memo: string | null) {
    await updateMemoQuery(db, id, memo);
    await load();
  }

  async function updateEntryDate(id: number, entryDate: string | null) {
    await updateEntryDateQuery(db, id, entryDate);
    await load();
  }

  async function updateImageUri(id: number, imageUri: string | null) {
    await updateImageUriQuery(db, id, imageUri);
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
    updateAmount,
    updateMemo,
    updateEntryDate,
    updateImageUri,
    reload: load,
  };
}
