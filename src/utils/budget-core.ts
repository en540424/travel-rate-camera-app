/**
 * 旅行予算の集計と無料枠しきい値の判定（純粋関数）。
 *
 * **react-native・nativeモジュール・値のimportを一切持たない自己完結モジュール。**
 * `node --test`から直接importして検証できる状態を保つため
 * （`categories.ts`・`csv-export-core.ts`と同じ規律）。
 * `Platform`分岐やDB読み込みは`trip-stats.ts`側の責務。
 *
 * ■ 「残り予算」の定義（2026-08-28にHuman実機確認を受けて変更）
 *   残り予算 = 旅行予算 − **購入済み合計のみ**
 *
 *   以前は候補も差し引いていたため、予算50,000円／購入済み33,407円／候補18,192円の
 *   実機ケースで残り0円と表示されていた（50,000−33,407−18,192 = −1,599 → 0にclamp）。
 *   候補は「買うかもしれない」段階であって支出ではないため、残り予算を減らさない。
 *   候補合計は`candidateTotalJpy`として引き続き別途返し、表示側で使う。
 */

/** 集計に必要な最小の行形。`HistoryRow`から必要な2項目だけを受け取る */
export type BudgetInputRow = {
  /** 円換算済み金額（`HistoryRow.jpy_amount`） */
  jpy_amount: number;
  /** 1なら購入済み、0/未設定なら候補（`HistoryRow.is_purchased`） */
  is_purchased?: 0 | 1 | null;
};

export type BudgetStats = {
  candidateCount: number;
  candidateTotalJpy: number;
  purchasedTotalJpy: number;
  /** 旅行予算 − 購入済み合計。0未満にはしない（表示上マイナス予算を出さない既存仕様を維持） */
  remainingBudget: number;
};

/**
 * 候補/購入済みの件数・合計（予算とは独立した「合計だけ」の形）。
 *
 * 表示用の取得上限（旅行500件／全旅行2000件）に依存せず**対象全件**から集計するため、
 * nativeではSQLの`GROUP BY is_purchased`（`db/queries/history.ts`）で作り、
 * Webでは`sumBudgetTotals`で全行から作る。どちらも最終的に`computeBudgetStatsFromTotals`へ渡す。
 */
export type BudgetTotals = {
  candidateCount: number;
  candidateTotalJpy: number;
  purchasedCount: number;
  purchasedTotalJpy: number;
};

export const EMPTY_BUDGET_TOTALS: BudgetTotals = {
  candidateCount: 0,
  candidateTotalJpy: 0,
  purchasedCount: 0,
  purchasedTotalJpy: 0,
};

/** 有限でない金額は0として扱い、集計を壊さない */
function safeAmount(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * 履歴行から候補/購入済みの件数・合計を求める（予算は関与しない）。
 * 端数は行ごとに`Math.round`する（既存挙動を維持。合計後に丸めると1円単位でズレる）。
 */
export function sumBudgetTotals(rows: readonly BudgetInputRow[]): BudgetTotals {
  const list = rows ?? [];
  let candidateCount = 0;
  let candidateTotalJpy = 0;
  let purchasedCount = 0;
  let purchasedTotalJpy = 0;

  for (const row of list) {
    const amount = safeAmount(row.jpy_amount);
    if ((row.is_purchased ?? 0) === 1) {
      purchasedCount += 1;
      purchasedTotalJpy += amount;
    } else {
      candidateCount += 1;
      candidateTotalJpy += amount;
    }
  }
  return { candidateCount, candidateTotalJpy, purchasedCount, purchasedTotalJpy };
}

/**
 * SQLの`GROUP BY trip_id, is_purchased`結果（`db/queries/history.ts`）を`BudgetTotals`へ畳む。
 * `trip_id`ごとのMapを返す。NULLのtrip_id（未分類）はキー`null`として保持しない（旅行画面では使わない）。
 * SQL側の`SUM(ROUND(jpy_amount))`は行ごとの丸めなので、`sumBudgetTotals`と同じ結果になる。
 */
export type BudgetGroupRow = {
  trip_id: number | null;
  is_purchased: 0 | 1 | null;
  count: number;
  total: number | null;
};

export function budgetTotalsByTripFromGroupRows(rows: readonly BudgetGroupRow[]): Map<number, BudgetTotals> {
  const map = new Map<number, BudgetTotals>();
  for (const row of rows) {
    if (row.trip_id == null) continue;
    const current = map.get(row.trip_id) ?? { ...EMPTY_BUDGET_TOTALS };
    const count = Number.isFinite(row.count) ? row.count : 0;
    const total = row.total != null && Number.isFinite(row.total) ? row.total : 0;
    if ((row.is_purchased ?? 0) === 1) {
      current.purchasedCount += count;
      current.purchasedTotalJpy += total;
    } else {
      current.candidateCount += count;
      current.candidateTotalJpy += total;
    }
    map.set(row.trip_id, current);
  }
  return map;
}

/**
 * 合計から残り予算を求める。**残り予算 = 予算 − 購入済み合計**（候補は差し引かない）。
 * 残り予算は`Math.max(0, …)`でclampする（既存仕様。購入済みが予算を超えても0止まり）。
 * 旅行一覧・切替シート・カメラ・履歴・設定のすべてがこの1関数を通る（画面間で定義をずらさない）。
 */
export function computeBudgetStatsFromTotals(totals: BudgetTotals, budgetJpy: number): BudgetStats {
  const budget = Number.isFinite(budgetJpy) ? budgetJpy : 0;
  return {
    candidateCount: totals.candidateCount,
    candidateTotalJpy: totals.candidateTotalJpy,
    purchasedTotalJpy: totals.purchasedTotalJpy,
    // 候補は差し引かない（上部コメント参照）
    remainingBudget: Math.max(0, budget - totals.purchasedTotalJpy),
  };
}

/**
 * 履歴行から候補/購入済みの件数・合計と残り予算を求める。
 * `sumBudgetTotals`→`computeBudgetStatsFromTotals`の合成（意味・戻り値の形は従来どおり）。
 */
export function computeBudgetStats(
  rows: readonly BudgetInputRow[],
  budgetJpy: number,
): BudgetStats {
  return computeBudgetStatsFromTotals(sumBudgetTotals(rows), budgetJpy);
}

/**
 * 無料枠の「上限が近い」案内を出すかどうか。
 *
 * `offset`は上限の何件手前から出すか（`limit - offset`件目から表示）。
 * 上限10件・offset3なら7件目から出る。Pro・上限0以下では常にfalse。
 */
export function shouldShowNearSaveLimit(
  currentCount: number,
  limit: number,
  offset: number,
): boolean {
  if (!Number.isFinite(currentCount) || !Number.isFinite(limit) || limit <= 0) return false;
  return currentCount >= Math.max(0, limit - offset);
}

/**
 * 上限までの残り保存可能件数。0未満にはしない
 * （上限を超えて保存済みの既存ユーザーでも「残り-3件」のような表示にしない）。
 */
export function remainingSaveSlots(currentCount: number, limit: number): number {
  if (!Number.isFinite(currentCount) || !Number.isFinite(limit)) return 0;
  return Math.max(0, limit - currentCount);
}
