import type { SQLiteDatabase } from 'expo-sqlite';

import type { CurrencyCode } from '@/constants/currencies';

export interface HistoryRow {
  id: number;
  currency: CurrencyCode;
  foreign_amount: number;
  jpy_amount: number;
  rate_used: number;
  trip_id: number | null;
  created_at: string;
}

/** 無料版の最大保存件数 */
export const FREE_HISTORY_LIMIT = 10;

/** 履歴を新しい順で取得 */
export async function getHistory(
  db: SQLiteDatabase,
  limit: number = 50,
): Promise<HistoryRow[]> {
  return db.getAllAsync<HistoryRow>(
    'SELECT * FROM conversion_history ORDER BY created_at DESC LIMIT ?',
    limit,
  );
}

/** 履歴の総件数を取得 */
export async function getHistoryCount(db: SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM conversion_history',
  );
  return result?.count ?? 0;
}

/** 履歴を1件追加 */
export async function insertHistory(
  db: SQLiteDatabase,
  entry: Omit<HistoryRow, 'id' | 'created_at'>,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO conversion_history (currency, foreign_amount, jpy_amount, rate_used, trip_id)
     VALUES (?, ?, ?, ?, ?)`,
    entry.currency,
    entry.foreign_amount,
    entry.jpy_amount,
    entry.rate_used,
    entry.trip_id ?? null,
  );
}

/** 履歴を1件削除 */
export async function deleteHistory(
  db: SQLiteDatabase,
  id: number,
): Promise<void> {
  await db.runAsync('DELETE FROM conversion_history WHERE id = ?', id);
}

/** 全履歴を削除 */
export async function clearHistory(db: SQLiteDatabase): Promise<void> {
  await db.runAsync('DELETE FROM conversion_history');
}
