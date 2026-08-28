import type { SQLiteDatabase } from 'expo-sqlite';

import { FREE_LIMITS } from '@/config/limits';
import type { CurrencyCode } from '@/constants/currencies';

export interface HistoryRow {
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

/** 無料版の最大保存件数（config/limits.ts の FREE_LIMITS.saves を正とする） */
export const FREE_HISTORY_LIMIT = FREE_LIMITS.saves;

/** 履歴を新しい順で取得（全件） */
export async function getHistory(
  db: SQLiteDatabase,
  limit: number = 50,
): Promise<HistoryRow[]> {
  return db.getAllAsync<HistoryRow>(
    'SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT ?',
    limit,
  );
}

/**
 * idで1件だけ取得する（trip_idによる絞り込みなし）。
 *
 * `item-detail.tsx` / `item-edit.tsx`のfallback専用。calendarタブは`useAllHistory()`で
 * 全旅行の記録を表示するが、詳細/編集画面は`useHistory()`（activeTripで絞り込み済み）から
 * idを探すため、activeTrip以外の旅行の記録を開くと見つからない。その場合だけこの関数で
 * 1件読み直す（`useAllHistory()`を丸ごと使うと2000件+全旅行の取得が毎回走ってしまうため、
 * 「見つからなかった時だけ」の単発読み取りに留める）。
 */
export async function getHistoryById(db: SQLiteDatabase, id: number): Promise<HistoryRow | null> {
  const row = await db.getFirstAsync<HistoryRow>(
    'SELECT * FROM conversion_history WHERE id = ?',
    id,
  );
  return row ?? null;
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
  return db.getAllAsync<HistoryRow>(
    'SELECT * FROM conversion_history WHERE trip_id = ? ORDER BY created_at DESC LIMIT ?',
    tripId,
    limit,
  );
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
  entry: Omit<HistoryRow, 'id' | 'created_at' | 'is_purchased' | 'purchased_at' | 'updated_at' | 'memo' | 'image_uri' | 'entry_date' | 'category'>,
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
