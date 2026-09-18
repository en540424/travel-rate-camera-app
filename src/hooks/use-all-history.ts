import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { HistoryRow } from '@/db/queries/history';
import {
  deleteHistory,
  getBudgetTotalsByTrip,
  getHistoryInDateKeyRange,
  markPurchased,
} from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';
import { getAllTrips } from '@/db/queries/trips';
import type { BudgetTotals } from '@/utils/budget-core';
import type { DateKeyRange } from '@/utils/history-date-core';

export interface UseAllHistoryOptions {
  /**
   * `history`に載せる履歴の期間（表示日付キー`YYYY-MM-DD`の閉区間）。
   * 省略時は履歴行を**取得しない**（`history`は空のまま。`tripMap`・`totalsByTrip`だけ使う画面向け）。
   */
  dateRange?: DateKeyRange;
}

/**
 * 全旅行横断の履歴・旅行一覧・旅行別集計を読む。
 *
 * `history`は`dateRange`の期間に**入り得る**行の全件（新しい順・件数上限なし）。
 * 旧実装は`getHistory(db, 2000)`（最新2000件）で、分析・カレンダーがその配列をJS側で集計していたため、
 * 2001件目以降が合計・グラフ・カレンダーから黙って落ちていた（2026-09-18・候補C）。期間で絞ることで
 * 上限を撤廃しつつ、取得量が生涯の総件数に比例しないようにする。
 * SQL側は`created_at`のUTC/ローカル差を吸収するため前後1日広めに取るので、画面側は従来どおり
 * `rowToDateKey`で厳密に絞ること（`utils/history-date-core.ts`）。
 */
export function useAllHistory(options: UseAllHistoryOptions = {}) {
  const db = useSQLiteContext();
  // 期間はfrom/toの文字列で依存を取る（呼び出し側がオブジェクトを毎render作っても再取得を繰り返さない）
  const rangeFrom = options.dateRange?.from;
  const rangeTo = options.dateRange?.to;
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tripMap, setTripMap] = useState<Map<number, TripRow>>(new Map());
  /**
   * 旅行ごとの候補/購入済み件数・合計（SQL集計・全件）。旅行一覧・切替シートの残り予算はこれを使う。
   * `history`は期間表示用であり、旅行全体の集計に使ってはいけない（期間外の行は含まれない）。
   */
  const [totalsByTrip, setTotalsByTrip] = useState<Map<number, BudgetTotals>>(new Map());

  const load = useCallback(async () => {
    const [rows, trips, totals] = await Promise.all([
      rangeFrom !== undefined && rangeTo !== undefined
        ? getHistoryInDateKeyRange(db, { from: rangeFrom, to: rangeTo })
        : Promise.resolve<HistoryRow[]>([]),
      getAllTrips(db),
      getBudgetTotalsByTrip(db),
    ]);
    setHistory(rows);
    setTripMap(new Map(trips.map((t) => [t.id, t])));
    setTotalsByTrip(totals);
  }, [db, rangeFrom, rangeTo]);

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
