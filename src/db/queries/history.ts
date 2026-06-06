import type { SQLiteDatabase } from 'expo-sqlite';

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
}

/** 無料版の最大保存件数 */
export const FREE_HISTORY_LIMIT = 10;

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
  entry: Omit<HistoryRow, 'id' | 'created_at' | 'is_purchased' | 'purchased_at' | 'updated_at' | 'memo' | 'image_uri' | 'entry_date'>,
  memo?: string,
  imageUri?: string,
  isPurchased?: boolean,
): Promise<void> {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  await db.runAsync(
    `INSERT INTO conversion_history (currency, foreign_amount, jpy_amount, rate_used, trip_id, memo, image_uri, is_purchased, purchased_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.currency,
    entry.foreign_amount,
    entry.jpy_amount,
    entry.rate_used,
    entry.trip_id ?? null,
    memo ?? null,
    imageUri ?? null,
    isPurchased ? 1 : 0,
    isPurchased ? now : null,
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
