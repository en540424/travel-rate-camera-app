import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * DBマイグレーション
 * SQLiteProvider の onInit に渡す
 */
export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
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

  if (currentVersion < 2) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS trips (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        budget_jpy  REAL    NOT NULL DEFAULT 0,
        currency    TEXT    NOT NULL DEFAULT 'USD',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at TEXT
      );

      PRAGMA user_version = 2;
    `);
  }

  if (currentVersion < 3) {
    // trips テーブルを新スキーマで再作成（既存データを保持）
    await db.runAsync('DROP TABLE IF EXISTS _trips_old');
    await db.runAsync('ALTER TABLE trips RENAME TO _trips_old');
    await db.execAsync(`
      CREATE TABLE trips (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        name            TEXT    NOT NULL,
        base_currency   TEXT    NOT NULL DEFAULT 'USD',
        target_currency TEXT    NOT NULL DEFAULT 'JPY',
        manual_rate     REAL    NOT NULL DEFAULT 0,
        budget_jpy      REAL    NOT NULL DEFAULT 0,
        started_at      TEXT,
        ended_at        TEXT,
        is_active       INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        archived_at     TEXT
      );
    `);
    // 旧テーブルのデータを移行（currency → base_currency）
    await db.runAsync(`
      INSERT INTO trips (id, name, base_currency, budget_jpy, created_at, archived_at)
      SELECT id, name, currency, budget_jpy, created_at, archived_at FROM _trips_old
    `);
    // 最新の未アーカイブ旅行を is_active = 1 に設定
    await db.runAsync(`
      UPDATE trips SET is_active = 1
      WHERE id = (
        SELECT id FROM trips WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1
      )
    `);
    await db.runAsync('DROP TABLE _trips_old');

    // conversion_history に新カラムを追加（冪等：既存なら無視）
    for (const sql of [
      'ALTER TABLE conversion_history ADD COLUMN is_purchased INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE conversion_history ADD COLUMN purchased_at TEXT',
      'ALTER TABLE conversion_history ADD COLUMN updated_at   TEXT',
    ]) {
      try { await db.runAsync(sql); } catch { /* already exists */ }
    }

    await db.runAsync('PRAGMA user_version = 3');
  }
}
