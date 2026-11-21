/**
 * Pro+の画面で、指定した旅行の記録を読む（読み取りのみ。既存の `getHistoryForTrip` を使う）。
 * `useAllHistory()` は期間を渡さないと一覧を返さない設計のため、Pro+の紐付け・ピンの色はこちらで引く。
 */
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { getHistoryForTrip, type HistoryRow } from '@/db/queries/history';

/** 1旅行あたりの読み取り上限（表示・紐付け用） */
const LIMIT_PER_TRIP = 500;

export function useTripRecords(tripIds: number[]): HistoryRow[] {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const key = [...new Set(tripIds)].sort((a, b) => a - b).join(',');
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const ids = key ? key.split(',').map(Number) : [];
      void Promise.all(ids.map((id) => getHistoryForTrip(db, id, LIMIT_PER_TRIP)))
        .then((lists) => { if (alive) setRows(lists.flat()); })
        .catch((e) => { if (__DEV__) console.warn('[proplus] records load failed', e); });
      return () => { alive = false; };
    }, [db, key]),
  );
  return rows;
}
