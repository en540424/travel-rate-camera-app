import type { SQLiteDatabase } from 'expo-sqlite';

import { isDuplicateColumnError, planTripsV3 } from '@/db/schema-migration-core';

/**
 * `ALTER TABLE ... ADD COLUMN`を冪等に実行する。
 * 「列が既に存在する」失敗だけを無視し、それ以外（I/O・破損・ロック等）は投げ直す
 * （以前は全例外を握り潰していたため、列が無いままversionだけ進む不整合が固定され得た）。
 */
async function addColumnIfMissing(db: SQLiteDatabase, sql: string): Promise<void> {
  try {
    await db.runAsync(sql);
  } catch (error) {
    if (isDuplicateColumnError(error)) return;
    throw error;
  }
}

async function tableExists(db: SQLiteDatabase, name: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return row != null;
}

async function tableColumns(db: SQLiteDatabase, name: string): Promise<string[] | null> {
  if (!(await tableExists(db, name))) return null;
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${name})`);
  return rows.map((r) => r.name);
}

const TRIPS_V3_CREATE_SQL = `
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
`;

/**
 * v3: tripsテーブルを新スキーマで再作成し、既存データを移行する。
 *
 * **1つのtransactionで実行する**（途中終了しても部分状態が残らない）。
 * さらに、このfix以前のBuildで中断した部分状態（`_trips_old`が残っている等）からも
 * `planTripsV3`の判定で再開できるようにし、**`_trips_old`を無条件にDROPしない**
 * （以前は冒頭の`DROP TABLE IF EXISTS _trips_old`が中断後の再起動でバックアップごと旅行データを消していた）。
 * `PRAGMA user_version`もtransaction内で更新し、成功時だけ進める。
 */
async function migrateToV3(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    const plan = planTripsV3({
      tripsColumns: await tableColumns(db, 'trips'),
      hasTripsOld: await tableExists(db, '_trips_old'),
    });

    switch (plan) {
      case 'rename_and_copy':
        // データは旧スキーマの`trips`にある。残骸の`_trips_old`（通常は存在しない）はrenameの邪魔になるので先に除く
        await db.runAsync('DROP TABLE IF EXISTS _trips_old');
        await db.runAsync('ALTER TABLE trips RENAME TO _trips_old');
        await db.execAsync(TRIPS_V3_CREATE_SQL);
        break;
      case 'resume_copy':
        // 前回の中断で`_trips_old`が残っている。新`trips`が無ければ作り、あればそのまま使う
        if (!(await tableExists(db, 'trips'))) await db.execAsync(TRIPS_V3_CREATE_SQL);
        break;
      case 'fresh_create':
        await db.execAsync(TRIPS_V3_CREATE_SQL);
        break;
      case 'already_migrated':
        break;
    }

    if (plan === 'rename_and_copy' || plan === 'resume_copy') {
      // 旧テーブルのデータを移行（currency → base_currency）。再開時に既にコピー済みの行はidで重複させない
      await db.runAsync(`
        INSERT OR IGNORE INTO trips (id, name, base_currency, budget_jpy, created_at, archived_at)
        SELECT id, name, currency, budget_jpy, created_at, archived_at FROM _trips_old
      `);
      // 最新の未アーカイブ旅行を is_active = 1 に設定（既にactiveがあればそのまま）
      await db.runAsync(`
        UPDATE trips SET is_active = 1
        WHERE (SELECT COUNT(*) FROM trips WHERE is_active = 1) = 0
          AND id = (SELECT id FROM trips WHERE archived_at IS NULL ORDER BY created_at DESC LIMIT 1)
      `);
      await db.runAsync('DROP TABLE _trips_old');
    }

    // conversion_history に新カラムを追加（冪等：既存なら無視。それ以外の失敗はtransactionごと巻き戻す）
    for (const sql of [
      'ALTER TABLE conversion_history ADD COLUMN is_purchased INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE conversion_history ADD COLUMN purchased_at TEXT',
      'ALTER TABLE conversion_history ADD COLUMN updated_at   TEXT',
    ]) {
      await addColumnIfMissing(db, sql);
    }

    await db.runAsync('PRAGMA user_version = 3');
  });
}

/**
 * DBマイグレーション
 * SQLiteProvider の onInit に渡す
 *
 * v1の`PRAGMA journal_mode = WAL`はtransaction内で実行できないため、全体は1つのtransactionで包まない。
 * transactionで保護するのはテーブル再作成を伴うv3のみ（`migrateToV3`）。
 * v4〜v7は列追加1つ＋version更新で、列追加の失敗（重複列以外）はversionを進めずに投げる。
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
    await migrateToV3(db);
  }

  // v4〜v7: 列追加。重複列以外の失敗はversionを進めずに投げる（列が無いままversionだけ進む不整合を作らない）。
  // 既にv7へ到達済みのDBはここを再実行しない。
  if (currentVersion < 4) {
    await addColumnIfMissing(db, 'ALTER TABLE conversion_history ADD COLUMN memo TEXT');
    await db.runAsync('PRAGMA user_version = 4');
  }

  if (currentVersion < 5) {
    await addColumnIfMissing(db, 'ALTER TABLE conversion_history ADD COLUMN image_uri TEXT');
    await db.runAsync('PRAGMA user_version = 5');
  }

  if (currentVersion < 6) {
    await addColumnIfMissing(db, 'ALTER TABLE conversion_history ADD COLUMN entry_date TEXT');
    await db.runAsync('PRAGMA user_version = 6');
  }

  // 買い物カテゴリー。既存recordを一切書き換えないため nullable・DEFAULT無しの追加のみ
  // （既存行は NULL ＝ 未分類。`config/categories.ts`のidだけを保存する）。
  if (currentVersion < 7) {
    await addColumnIfMissing(db, 'ALTER TABLE conversion_history ADD COLUMN category TEXT');
    await db.runAsync('PRAGMA user_version = 7');
  }
}
