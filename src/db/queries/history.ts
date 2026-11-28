import type { SQLiteDatabase } from 'expo-sqlite';

import { FREE_LIMITS } from '@/config/limits';
import type { CurrencyCode } from '@/constants/currencies';
import {
  budgetTotalsByTripFromGroupRows,
  EMPTY_BUDGET_TOTALS,
  sumBudgetTotalsInMinorUnits,
  type BudgetGroupRow,
  type BudgetInputRow,
  type BudgetTotals,
} from '@/utils/budget-core';
import {
  HISTORY_DATE_KEY_RANGE_WHERE_SQL,
  historyDateKeyRangeParams,
  type DateKeyRange,
} from '@/utils/history-date-core';
import { fractionalHomeCurrency, minorUnitsFor, withHomeCurrency } from '@/utils/home-currency-core';

/** DB（と Web の localStorage）に実際にある記録の列 */
export interface StoredHistoryRow {
  id: number;
  currency: CurrencyCode;
  foreign_amount: number;
  jpy_amount: number;
  rate_used: number;
  trip_id: number | null;
  is_purchased: 0 | 1;
  purchased_at: string | null;
  updated_at: string | null;
  created_at: string;
  memo: string | null;
  image_uri: string | null;
  entry_date: string | null;
  /** 買い物カテゴリーid（`config/categories.ts`の`CategoryId`）。未分類はnull */
  category: string | null;
}

/**
 * 読み出した記録。`home_currency` は**読み出し専用**（記録の旅行の `target_currency`。旅行が無い・見つからない・
 * 7通貨に無い値は 'JPY'。設計書 `design/gx05-home-currency-design.md` §11 C1・C3）。DB の列ではないので保存しない
 */
export interface HistoryRow extends StoredHistoryRow {
  home_currency: CurrencyCode;
}

/**
 * 記録の SELECT の頭。記録の基準通貨を**副問い合わせ**で載せる（GX-06 段階 a・設計書 §11 C1）。
 * - JOIN は使わない（`SELECT *` のまま JOIN すると、`trips` と同名の `id`・`created_at`・`updated_at` で記録の列が旅行の値に化ける）
 * - FROM は `conversion_history` だけなので、後ろに続く `WHERE id = ?`・`history-date-core.ts` の無修飾の列は記録の表に解決される
 * - 元の列の並び・値は素の `SELECT *` と同じで、`home_currency` が末尾に1列増えるだけ（`history-home-currency.test.mjs`）
 * - 空文字は `COALESCE` を素通りするので、読んだ後に必ず `withHomeRows` で正規化する（§13 の nit）
 */
const SELECT_HISTORY_SQL = `SELECT *, COALESCE((SELECT trips.target_currency FROM trips WHERE trips.id = conversion_history.trip_id), 'JPY') AS home_currency FROM conversion_history`;

function withHomeRows(rows: (StoredHistoryRow & { home_currency: unknown })[]): HistoryRow[] {
  return rows.map((r) => withHomeCurrency(r, r.home_currency));
}

/** 無料版の最大保存件数（config/limits.ts の FREE_LIMITS.saves を正とする） */
export const FREE_HISTORY_LIMIT = FREE_LIMITS.saves;

/** 履歴を新しい順で取得（`limit`件まで。表示用） */
export async function getHistory(
  db: SQLiteDatabase,
  limit: number = 50,
): Promise<HistoryRow[]> {
  return withHomeRows(await db.getAllAsync<StoredHistoryRow & { home_currency: unknown }>(
    `${SELECT_HISTORY_SQL} ORDER BY created_at DESC LIMIT ?`,
    limit,
  ));
}

/**
 * idで1件だけ取得する（trip_idによる絞り込みなし）。
 *
 * `item-detail.tsx` / `item-edit.tsx`のfallback専用。calendarタブは`useAllHistory()`で
 * 全旅行の記録を表示するが、詳細/編集画面は`useHistory()`（activeTripで絞り込み済み）から
 * idを探すため、activeTrip以外の旅行の記録を開くと見つからない。その場合だけこの関数で
 * 1件読み直す（`useAllHistory()`を丸ごと使うと期間分の履歴+全旅行+全件集計の取得が毎回走ってしまうため、
 * 「見つからなかった時だけ」の単発読み取りに留める）。
 */
export async function getHistoryById(db: SQLiteDatabase, id: number): Promise<HistoryRow | null> {
  const row = await db.getFirstAsync<StoredHistoryRow & { home_currency: unknown }>(
    `${SELECT_HISTORY_SQL} WHERE id = ?`,
    id,
  );
  return row ? withHomeRows([row])[0] : null;
}

/**
 * 全旅行の履歴のうち、表示日付キー（`entry_date ?? created_at`のローカル日付）が`range`に入り得る行を
 * 新しい順で取得する。**件数上限なし**（取得量は期間内の件数で決まる）。
 *
 * 分析・カレンダー用（`useAllHistory({ dateRange })`）。旧実装の`getHistory(db, 2000)`は2001件目以降が
 * 集計・表示から黙って落ちていた（2026-09-18・候補C）。SQL側は`created_at`のUTC/ローカル差を吸収するため
 * 前後1日広めに取るので、呼び出し側は従来どおり`rowToDateKey`で厳密に絞ること
 * （条件の根拠は`utils/history-date-core.ts`先頭）。
 */
export async function getHistoryInDateKeyRange(
  db: SQLiteDatabase,
  range: DateKeyRange,
): Promise<HistoryRow[]> {
  return withHomeRows(await db.getAllAsync<StoredHistoryRow & { home_currency: unknown }>(
    `${SELECT_HISTORY_SQL} WHERE ${HISTORY_DATE_KEY_RANGE_WHERE_SQL} ORDER BY created_at DESC`,
    ...historyDateKeyRangeParams(range),
  ));
}

/** 履歴の総件数を取得（全件） */
export async function getHistoryCount(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM conversion_history',
  );
  return result?.count ?? 0;
}

/** アクティブ旅行の履歴を取得（trip_id が完全一致するもののみ） */
export async function getHistoryForTrip(
  db: SQLiteDatabase,
  tripId: number,
  limit: number = 50,
): Promise<HistoryRow[]> {
  return withHomeRows(await db.getAllAsync<StoredHistoryRow & { home_currency: unknown }>(
    `${SELECT_HISTORY_SQL} WHERE trip_id = ? ORDER BY created_at DESC LIMIT ?`,
    tripId,
    limit,
  ));
}

/** アクティブ旅行スコープの件数（trip_id 完全一致のみ） */
export async function getHistoryCountForTrip(
  db: SQLiteDatabase,
  tripId: number,
): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM conversion_history WHERE trip_id = ?',
    tripId,
  );
  return result?.count ?? 0;
}

/**
 * 旅行ごとの候補/購入済み件数・合計をSQLで集計する（表示用の取得上限に依存しない）。
 * 端数は`sumBudgetTotals`と同じく行ごとに丸める（`ROUND`）。
 */
const BUDGET_GROUP_SQL = `
  SELECT trip_id, is_purchased, COUNT(*) AS count, SUM(ROUND(jpy_amount)) AS total
  FROM conversion_history`;

/**
 * 小数の基準通貨（USD・EUR・GBP・THB）の旅行の合計を、行を読み直して最小単位の整数で足した値に置き換える
 * （GX-06 段階 c-2・設計書 §12-2 S7）。SQL の `ROUND(jpy_amount)` は小数の基準通貨を整数に丸めてしまい、
 * `ROUND(x,2)`・`SUM` も JS の丸めと一致しないため、この旅行の合計には SQL の値を使わない。
 * - 読むのは `is_purchased, jpy_amount` だけ・**件数の上限なし**（表示用の 50／500件の上限を使わない）
 * - 件数も同じ読み出しの行数にする（合計と件数を1回の読み出しにそろえる。どちらも同じ行の集まりなので値は SQL の COUNT と同じ）
 * - 終了済みの旅行も対象（旅行の状態で絞らない）
 */
async function fractionalTripTotals(
  db: SQLiteDatabase,
  tripId: number,
  home: CurrencyCode,
): Promise<BudgetTotals | null> {
  const rows = await db.getAllAsync<BudgetInputRow>(
    'SELECT is_purchased, jpy_amount FROM conversion_history WHERE trip_id = ?',
    tripId,
  );
  return rows.length === 0 ? null : sumBudgetTotalsInMinorUnits(rows, minorUnitsFor(home));
}

/**
 * 全旅行の集計。基準通貨が0桁の旅行（既存の旅行はすべて JPY）は `BUDGET_GROUP_SQL` の値のまま。
 * 旅行は `trips` を直接読む（終了済み・アーカイブ済みも含む。`getAllTrips` の絞り込みに依存しない）。
 * `trip_id` が NULL の記録はどの旅行にも入らない。旅行が見つからない記録は JPY と読む（§11 C1）ので SQL の値のまま
 */
export async function getBudgetTotalsByTrip(db: SQLiteDatabase): Promise<Map<number, BudgetTotals>> {
  const rows = await db.getAllAsync<BudgetGroupRow>(
    `${BUDGET_GROUP_SQL} WHERE trip_id IS NOT NULL GROUP BY trip_id, is_purchased`,
  );
  const map = budgetTotalsByTripFromGroupRows(rows);
  const trips = await db.getAllAsync<{ id: number; target_currency: unknown }>(
    'SELECT id, target_currency FROM trips',
  );
  for (const trip of trips) {
    const home = fractionalHomeCurrency(trip.target_currency);
    if (!home) continue;
    const totals = await fractionalTripTotals(db, trip.id, home);
    if (totals) map.set(trip.id, totals);
    else map.delete(trip.id);
  }
  return map;
}

/** 1旅行分の集計。行が無ければ全て0。基準通貨が0桁の旅行は `BUDGET_GROUP_SQL` の値のまま */
export async function getBudgetTotalsForTrip(db: SQLiteDatabase, tripId: number): Promise<BudgetTotals> {
  const rows = await db.getAllAsync<BudgetGroupRow>(
    `${BUDGET_GROUP_SQL} WHERE trip_id = ? GROUP BY trip_id, is_purchased`,
    tripId,
  );
  const trip = await db.getFirstAsync<{ target_currency: unknown }>(
    'SELECT target_currency FROM trips WHERE id = ?',
    tripId,
  );
  const home = fractionalHomeCurrency(trip?.target_currency);
  if (home) return (await fractionalTripTotals(db, tripId, home)) ?? { ...EMPTY_BUDGET_TOTALS };
  return budgetTotalsByTripFromGroupRows(rows).get(tripId) ?? { ...EMPTY_BUDGET_TOTALS };
}

/**
 * 写真URIの一覧（重複なし・NULL除外）。全削除の**後**に写真fileを片付けるために使う。
 * `tripId`がnullなら全件。表示用の取得上限（500件）に依存せず、削除対象の全行から集める
 * （上限外の行の写真が孤児fileとして残らないようにする）。
 */
export async function getImageUris(db: SQLiteDatabase, tripId: number | null): Promise<string[]> {
  const rows = tripId == null
    ? await db.getAllAsync<{ image_uri: string }>(
        'SELECT DISTINCT image_uri FROM conversion_history WHERE image_uri IS NOT NULL',
      )
    : await db.getAllAsync<{ image_uri: string }>(
        'SELECT DISTINCT image_uri FROM conversion_history WHERE trip_id = ? AND image_uri IS NOT NULL',
        tripId,
      );
  return rows.map((r) => r.image_uri);
}

/** アクティブ旅行の履歴を削除（他旅行・未分類データは触らない） */
export async function clearHistoryForTrip(
  db: SQLiteDatabase,
  tripId: number,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM conversion_history WHERE trip_id = ?',
    tripId,
  );
}

/** 履歴を1件追加 */
export async function insertHistory(
  db: SQLiteDatabase,
  entry: Omit<StoredHistoryRow, 'id' | 'created_at' | 'is_purchased' | 'purchased_at' | 'updated_at' | 'memo' | 'image_uri' | 'entry_date' | 'category'>,
  memo?: string,
  imageUri?: string,
  isPurchased?: boolean,
  category?: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `INSERT INTO conversion_history (currency, foreign_amount, jpy_amount, rate_used, trip_id, memo, image_uri, is_purchased, purchased_at, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.currency,
    entry.foreign_amount,
    entry.jpy_amount,
    entry.rate_used,
    entry.trip_id ?? null,
    memo ?? null,
    imageUri ?? null,
    isPurchased ? 1 : 0,
    isPurchased ? now : null,
    category ?? null,
  );
}

/** 購入ステータスを更新 */
export async function markPurchased(
  db: SQLiteDatabase,
  id: number,
  isPurchased: boolean,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET is_purchased = ?, purchased_at = ?, updated_at = ? WHERE id = ?`,
    isPurchased ? 1 : 0,
    isPurchased ? now : null,
    now,
    id,
  );
}

/** 金額を更新（JPYモード用: foreign_amount と jpy_amount を同じ値で上書き） */
export async function updateAmount(
  db: SQLiteDatabase,
  id: number,
  foreignAmount: number,
  jpyAmount: number,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET foreign_amount = ?, jpy_amount = ?, updated_at = ? WHERE id = ?`,
    foreignAmount,
    jpyAmount,
    now,
    id,
  );
}

/** メモを更新 */
export async function updateMemo(
  db: SQLiteDatabase,
  id: number,
  memo: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET memo = ?, updated_at = ? WHERE id = ?`,
    memo,
    now,
    id,
  );
}

/** 買い物カテゴリーを更新（null で未分類へ戻す。値は`config/categories.ts`のidのみ） */
export async function updateCategory(
  db: SQLiteDatabase,
  id: number,
  category: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET category = ?, updated_at = ? WHERE id = ?`,
    category,
    now,
    id,
  );
}

/** 履歴を1件削除 */
export async function deleteHistory(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM conversion_history WHERE id = ?', id);
}

/** 全履歴を削除 */
export async function clearHistory(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM conversion_history');
}

/** 画像URIを更新（null で画像削除） */
export async function updateImageUri(
  db: SQLiteDatabase,
  id: number,
  imageUri: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET image_uri = ?, updated_at = ? WHERE id = ?`,
    imageUri,
    now,
    id,
  );
}

/** カレンダー表示用の日付を更新（"YYYY-MM-DD" または null） */
export async function updateEntryDate(
  db: SQLiteDatabase,
  id: number,
  entryDate: string | null,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `UPDATE conversion_history SET entry_date = ?, updated_at = ? WHERE id = ?`,
    entryDate,
    now,
    id,
  );
}
