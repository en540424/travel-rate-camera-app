// Web用: expo-sqlite を使わず localStorage にフォールバック。
// Metro は .web.ts を Web ビルドで優先採用する。
import { useCallback, useEffect, useState } from 'react';

import type { CurrencyCode } from '@/constants/currencies';
import type { HistoryRow, StoredHistoryRow } from '@/db/queries/history';
import type { TripRow } from '@/db/queries/trips';
import type { BudgetTotals } from '@/utils/budget-core';
import { isDateKeyInRange, rowToDateKey, type DateKeyRange } from '@/utils/history-date-core';
import {
  attachHomeCurrencyFromTrips,
  budgetTotalsByTripFromRows,
  stripHomeCurrency,
} from '@/utils/home-currency-core';

const HISTORY_KEY = 'travelrate:history';
const TRIPS_KEY   = 'travelrate:trips';

function loadAllHistory(): StoredHistoryRow[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<StoredHistoryRow & { purchase_date?: string }>[]).map((r) => ({
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
      category: r.category ?? null,
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

/** 読み出し専用の `home_currency` は書かない（型では余分なキーを止められないので実行時に落とす。設計書 §13） */
function persistHistory(rows: readonly StoredHistoryRow[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rows.map(stripHomeCurrency)));
  } catch {}
}

export interface UseAllHistoryOptions {
  /** native版（`use-all-history.ts`）と同じ。省略時は`history`を空にする */
  dateRange?: DateKeyRange;
}

export function useAllHistory(options: UseAllHistoryOptions = {}) {
  const rangeFrom = options.dateRange?.from;
  const rangeTo = options.dateRange?.to;
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [tripMap, setTripMap] = useState<Map<number, TripRow>>(new Map());
  // 旅行ごとの集計（native版のSQL集計と同じ形。全行から作る）
  const [totalsByTrip, setTotalsByTrip] = useState<Map<number, BudgetTotals>>(new Map());

  const load = useCallback(() => {
    const rows = loadAllHistory();
    const trips = loadAllTrips();
    // native版は期間内に入り得る行をSQLで返す。Webは全行から同じ日付キー規則で絞る（集計は全行のまま）
    // 記録の基準通貨は、同じ同期処理で読んだ旅行から引く（state の tripMap は使わない。GX-06 段階 a）
    setHistory(
      rangeFrom !== undefined && rangeTo !== undefined
        ? attachHomeCurrencyFromTrips(
            rows.filter((r) => isDateKeyInRange(rowToDateKey(r), { from: rangeFrom, to: rangeTo })),
            trips,
          )
        : [],
    );
    setTripMap(new Map(trips.map((t) => [t.id, t])));
    // 旅行ごとの合計：基準通貨が0桁の旅行は1行ずつ Math.round（変更前と同じ）・小数の基準通貨の旅行は最小単位で足す（GX-06 段階 c-2）
    setTotalsByTrip(budgetTotalsByTripFromRows(rows, trips));
  }, [rangeFrom, rangeTo]);

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

  return { history, tripMap, totalsByTrip, reload: load, togglePurchased, removeEntry };
}
