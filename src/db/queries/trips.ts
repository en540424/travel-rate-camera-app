import type { SQLiteDatabase } from 'expo-sqlite';

import type { CurrencyCode } from '@/constants/currencies';

export interface TripRow {
  id: number;
  name: string;
  base_currency: CurrencyCode;
  target_currency: string;
  manual_rate: number;
  budget_jpy: number;
  started_at: string | null;
  ended_at: string | null;
  is_active: 0 | 1;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** アクティブな旅行（archived_at IS NULL）を新しい順・is_active 優先で取得 */
export async function getActiveTrips(db: SQLiteDatabase): Promise<TripRow[]> {
  return db.getAllAsync<TripRow>(
    'SELECT * FROM trips WHERE archived_at IS NULL ORDER BY is_active DESC, created_at DESC',
  );
}

/** 旅行を1件取得 */
export async function getTripById(
  db: SQLiteDatabase,
  id: number,
): Promise<TripRow | null> {
  return db.getFirstAsync<TripRow>('SELECT * FROM trips WHERE id = ?', id);
}

/** 旅行を新規作成 */
export async function insertTrip(
  db: SQLiteDatabase,
  trip: Pick<TripRow, 'name' | 'budget_jpy' | 'base_currency' | 'manual_rate'>,
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO trips (name, budget_jpy, base_currency, manual_rate) VALUES (?, ?, ?, ?)`,
    trip.name,
    trip.budget_jpy,
    trip.base_currency,
    trip.manual_rate,
  );
  return result.lastInsertRowId;
}

/** 旅行を更新（updated_at は自動設定） */
export async function updateTrip(
  db: SQLiteDatabase,
  id: number,
  trip: Partial<Pick<TripRow, 'name' | 'budget_jpy' | 'base_currency' | 'manual_rate' | 'started_at' | 'ended_at' | 'is_active'>>,
): Promise<void> {
  const fields = Object.keys(trip) as (keyof typeof trip)[];
  if (fields.length === 0) return;
  const setClauses = [...fields.map((f) => `${f} = ?`), "updated_at = datetime('now')"].join(', ');
  const values = fields.map((f) => trip[f] as string | number | null);
  await db.runAsync(
    `UPDATE trips SET ${setClauses} WHERE id = ?`,
    ...values,
    id,
  );
}

/** 全旅行の is_active を解除し、指定旅行を is_active = 1 にする */
export async function setActiveTrip(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync("UPDATE trips SET is_active = 0, updated_at = datetime('now')");
  await db.runAsync("UPDATE trips SET is_active = 1, updated_at = datetime('now') WHERE id = ?", id);
}

/** 旅行をアーカイブ（論理削除） */
export async function archiveTrip(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync(
    "UPDATE trips SET archived_at = datetime('now'), is_active = 0, updated_at = datetime('now') WHERE id = ?",
    id,
  );
}
