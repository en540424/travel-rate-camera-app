import { Platform } from 'react-native';

import type { CurrencyCode } from '@/constants/currencies';
import type { HistoryRow } from '@/db/queries/history';
import { computeBudgetStats } from '@/utils/budget-core';

const WEB_HISTORY_STORAGE_KEY = 'travelrate:history';

function loadAllFromWebStorage(): HistoryRow[] {
  try {
    const raw = localStorage.getItem(WEB_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<HistoryRow & { purchase_date?: string }>[]).map((r) => ({
      id: r.id ?? 0,
      currency: (r.currency ?? 'USD') as CurrencyCode,
      foreign_amount: r.foreign_amount ?? 0,
      jpy_amount: r.jpy_amount ?? 0,
      rate_used: r.rate_used ?? 0,
      trip_id: r.trip_id ?? null,
      is_purchased: (r.is_purchased === 1 ? 1 : 0) as 0 | 1,
      purchased_at: r.purchased_at ?? r.purchase_date ?? null,
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

export interface TripStats {
  candidateCount: number;
  candidateTotalJpy: number;
  purchasedTotalJpy: number;
  remainingBudget: number;
}

/**
 * 集計の実体は`utils/budget-core.ts`（純粋関数・`node --test`で検証済み）に委ねる。
 * **残り予算は「旅行予算 − 購入済み合計」**で、候補は差し引かない（budget-core.ts参照）。
 */
export function getTripStats(rows: HistoryRow[], budgetJpy: number): TripStats {
  return computeBudgetStats(rows, budgetJpy);
}

/**
 * 画面表示用。Web は hook の slice 済み state ではなく localStorage 全件から集計し、
 * タブ間でズレないようにする。activeTripId が渡された場合は旅行スコープでフィルタする。
 */
export function getTripStatsForDisplay(
  hookRows: HistoryRow[],
  budgetJpy: number,
  activeTripId?: number | null,
): TripStats {
  let rows: HistoryRow[];
  if (Platform.OS === 'web') {
    const all = loadAllFromWebStorage();
    rows = activeTripId != null
      ? all.filter((r) => r.trip_id === activeTripId)
      : all;
  } else {
    rows = hookRows;
  }
  return getTripStats(rows, budgetJpy);
}
