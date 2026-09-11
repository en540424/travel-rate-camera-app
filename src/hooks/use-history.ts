import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { canSaveEntry } from '@/config/limits';
import type { CurrencyCode } from '@/constants/currencies';
import {
  clearHistory,
  clearHistoryForTrip,
  deleteHistory,
  getHistory,
  getHistoryCount,
  getHistoryCountForTrip,
  getHistoryForTrip,
  getImageUris,
  insertHistory,
  markPurchased as markPurchasedQuery,
  updateAmount as updateAmountQuery,
  updateCategory as updateCategoryQuery,
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
  // 保存の直列化。setStateの反映を待たずに即判定するためrefで持つ（購入処理のpurchasingRefと同じ考え方）。
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    // 初回MVPは保存上限を露出しない方針のため、表示件数はFREE_HISTORY_LIMIT（FREE_LIMITS.saves）で切らない（P0-04）。
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

  /**
   * DB書き込み**成功後**の再読込。ここでの失敗（SELECT失敗）は書き込みの成否と無関係なので
   * 呼び出し側へ投げず記録だけする。投げると「DBは更新済みなのに保存失敗扱い」になり、
   * 編集画面側で保存済み写真を下書き扱いで削除する経路（Codex S2-4）が成立してしまう。
   */
  const reloadAfterWrite = useCallback(async () => {
    try {
      await load();
    } catch (e) {
      console.warn('[history reload after write]', e);
    }
  }, [load]);

  /**
   * 無料版は保存件数がFREE_LIMITS.saves以上ならブロックする（Proは無制限）。保存処理の唯一の入口。
   *
   * ■ 連打・並行呼び出し
   *   実行中にもう一度呼ばれた場合はDBへ触らず`{ blocked: false, busy: true }`を返す
   *   （呼び出し側は保存成功として扱わない）。上限判定はReact stateの`totalCount`ではなく、
   *   INSERT直前にDBから読み直した件数で行う（stateの反映遅れによる上限突破を防ぐ）。
   *   数える対象（現在の旅行の件数＝`getHistoryCountForTrip`）はこれまでと同じで変更しない。
   */
  async function addEntry(
    currency: CurrencyCode,
    foreignAmount: number,
    jpyAmount: number,
    rateUsed: number,
    memo?: string,
    imageUri?: string,
    isPurchased?: boolean,
    category?: string | null,
  ): Promise<{ blocked: boolean; busy?: boolean }> {
    if (!activeTrip) return { blocked: false };
    if (savingRef.current) return { blocked: false, busy: true };
    savingRef.current = true;
    try {
      const currentCount = await getHistoryCountForTrip(db, activeTrip.id);
      if (!canSaveEntry(isPro, currentCount)) return { blocked: true };
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
        category,
      );
    } finally {
      savingRef.current = false;
    }
    await reloadAfterWrite();
    return { blocked: false };
  }

  async function removeEntry(id: number) {
    await deleteHistory(db, id);
    await reloadAfterWrite();
  }

  /**
   * 現在の旅行（なければ全件）の履歴を削除する。
   * 戻り値は削除した記録が参照していた写真URI。**DB削除が成功した後**に呼び出し側がfileを片付ける
   * （fileを先に消してDB削除が失敗すると「記録は残るのに写真だけ無い」状態になるため、順序を逆にしない）。
   */
  async function clearAll(): Promise<{ imageUris: string[] }> {
    const tripId = activeTrip?.id ?? null;
    const imageUris = await getImageUris(db, tripId);
    if (tripId != null) {
      await clearHistoryForTrip(db, tripId);
    } else {
      await clearHistory(db);
    }
    await reloadAfterWrite();
    return { imageUris };
  }

  async function togglePurchased(id: number, currentValue: 0 | 1) {
    await markPurchasedQuery(db, id, currentValue === 0);
    await reloadAfterWrite();
  }

  async function updateAmount(id: number, foreignAmount: number, jpyAmount: number) {
    await updateAmountQuery(db, id, foreignAmount, jpyAmount);
    await reloadAfterWrite();
  }

  async function updateMemo(id: number, memo: string | null) {
    await updateMemoQuery(db, id, memo);
    await reloadAfterWrite();
  }

  async function updateEntryDate(id: number, entryDate: string | null) {
    await updateEntryDateQuery(db, id, entryDate);
    await reloadAfterWrite();
  }

  /** カテゴリーを更新（null で未分類へ戻す） */
  async function updateCategory(id: number, category: string | null) {
    await updateCategoryQuery(db, id, category);
    await reloadAfterWrite();
  }

  async function updateImageUri(id: number, imageUri: string | null) {
    await updateImageUriQuery(db, id, imageUri);
    await reloadAfterWrite();
  }

  const isAtFreeLimit = !canSaveEntry(isPro, totalCount);

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
    updateCategory,
    reload: load,
  };
}
