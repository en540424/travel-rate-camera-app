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

/** 有限でない金額は0として扱い、集計を壊さない */
function safeAmount(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * 履歴行から候補/購入済みの件数・合計と残り予算を求める。
 *
 * 端数は行ごとに`Math.round`する（既存挙動を維持。合計後に丸めると1円単位でズレる）。
 * 残り予算は`Math.max(0, …)`でclampする（既存仕様。購入済みが予算を超えても0止まり）。
 */
export function computeBudgetStats(
  rows: readonly BudgetInputRow[],
  budgetJpy: number,
): BudgetStats {
  const list = rows ?? [];
  let candidateCount = 0;
  let candidateTotalJpy = 0;
  let purchasedTotalJpy = 0;

  for (const row of list) {
    const amount = safeAmount(row.jpy_amount);
    if ((row.is_purchased ?? 0) === 1) {
      purchasedTotalJpy += amount;
    } else {
      candidateCount += 1;
      candidateTotalJpy += amount;
    }
  }

  const budget = Number.isFinite(budgetJpy) ? budgetJpy : 0;

  return {
    candidateCount,
    candidateTotalJpy,
    purchasedTotalJpy,
    // 候補は差し引かない（上部コメント参照）
    remainingBudget: Math.max(0, budget - purchasedTotalJpy),
  };
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
