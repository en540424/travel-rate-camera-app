import { Platform } from 'react-native';

import type { CurrencyCode } from '@/constants/currencies';
import type { HistoryRow, StoredHistoryRow } from '@/db/queries/history';
import {
  computeBudgetStats,
  computeBudgetStatsFromTotals,
  sumBudgetTotals,
  type BudgetTotals,
} from '@/utils/budget-core';
import {
  budgetTotalsForHome,
  budgetUnitsForHome,
  homeCurrencyOfTrip,
  normalizeHomeCurrency,
  tripHomesFromJson,
} from '@/utils/home-currency-core';

const WEB_HISTORY_STORAGE_KEY = 'travelrate:history';
/** 旅行の保存先（`use-trips.ts` の `STORAGE_KEY` と同じ）。旅行の基準通貨を引くためだけに読む */
const WEB_TRIPS_STORAGE_KEY = 'travelrate:trips';

function loadTripHomesFromWebStorage(): { id: number; target_currency: unknown }[] {
  try {
    return tripHomesFromJson(localStorage.getItem(WEB_TRIPS_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** 集計（件数・合計）にだけ使うので記録に基準通貨は付けない（合計の桁は旅行の基準通貨で決める。GX-06 段階 c-2） */
function loadAllFromWebStorage(): StoredHistoryRow[] {
  try {
    const raw = localStorage.getItem(WEB_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Partial<StoredHistoryRow & { purchase_date?: string }>[]).map((r) => ({
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
 * `getTripStatsForDisplay` が残り予算に使う基準通貨（GX-06 段階 d）。Web は localStorage の旅行から旅行の id で引く
 * （store の `activeTrip` ではなく `stats` と同じ出どころ）。旅行が無い時は 'JPY'（`stats` は単位なしで合計する）。
 * ネイティブは渡された基準通貨（`activeTrip.target_currency`）を正規化した値
 */
export function tripStatsHomeCurrency(activeTripId?: number | null, homeCurrency?: unknown): CurrencyCode {
  if (Platform.OS === 'web') {
    if (activeTripId == null) return 'JPY';
    return homeCurrencyOfTrip(activeTripId, loadTripHomesFromWebStorage());
  }
  return normalizeHomeCurrency(homeCurrency);
}

/**
 * 画面表示用。
 *
 * nativeは`useHistory().budgetTotals`（SQLで対象全件を集計した合計）を受け取り、
 * 表示用の500件上限に依存しない残り予算を出す。
 * Web は hook の state ではなく localStorage 全件から集計し、タブ間でズレないようにする
 * （activeTripId が渡された場合は旅行スコープでフィルタする）。
 *
 * `homeCurrency`（GX-06 段階 c-2）：native の旅行の `target_currency`。小数の基準通貨なら残り予算を最小単位で引く。
 * 未指定・0桁の基準通貨は今の式のまま。Web は渡された値を使わず、記録と同じ同期処理で読んだ localStorage の旅行から引く。
 * 旅行が選ばれていない時（activeTripId が null）は全旅行の行が混ざるが、その金額はどの画面にも出さないので今の式のまま
 */
export function getTripStatsForDisplay(
  hookTotals: BudgetTotals,
  budgetJpy: number,
  activeTripId?: number | null,
  homeCurrency?: unknown,
): TripStats {
  if (Platform.OS === 'web') {
    const all = loadAllFromWebStorage();
    if (activeTripId == null) return computeBudgetStatsFromTotals(sumBudgetTotals(all), budgetJpy);
    const rows = all.filter((r) => r.trip_id === activeTripId);
    const home = homeCurrencyOfTrip(activeTripId, loadTripHomesFromWebStorage());
    return computeBudgetStatsFromTotals(budgetTotalsForHome(rows, home), budgetJpy, budgetUnitsForHome(home));
  }
  return computeBudgetStatsFromTotals(hookTotals, budgetJpy, budgetUnitsForHome(homeCurrency));
}
