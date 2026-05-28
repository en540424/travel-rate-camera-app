import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * DBマイグレーション
 * SQLiteProvider の onInit に渡す
 */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  // user_version を使ってマイグレーション管理
  const result = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const currentVersion = result?.user_version ?? 0;

  if (currentVersion < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS exchange_rates (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        currency    TEXT    NOT NULL UNIQUE,
        rate        REAL    NOT NULL DEFAULT 0,
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS conversion_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        currency        TEXT    NOT NULL,
        foreign_amount  REAL    NOT NULL,
        jpy_amount      REAL    NOT NULL,
        rate_used       REAL    NOT NULL,
        trip_id         INTEGER,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      PRAGMA user_version = 1;
    `);
  }

  // 将来バージョンアップ時はここに追加
  // if (currentVersion < 2) { ... PRAGMA user_version = 2; }
}
