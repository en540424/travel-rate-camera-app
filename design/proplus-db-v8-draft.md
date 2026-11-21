# Pro+ DB v8 下書き（未適用・Human承認H-P5待ち）

> **このSQLはどこからも実行されない。** `src/db/schema.ts` の `migrateDatabase` には繋いでいない。
> DBスキーマ・migrationはAGENTS.md／AI_CONTEXT.mdの禁止領域で、設計書（Vault `旅レートカメラ_ProPlus中核3機能_技術設計・原価制御_2026-11-04` §3-2・§10工程6・§11 H-P5）がHuman承認とdb-guardianの確認を前提にしている。
> 作成：2026-11-21（branch `feat/proplus-core-and-store-assets`）。

## 現状（承認前の暫定）

Pro+のデータ（場所・記録との紐付け・予定）は既存DB（`travelrate.db`）とは別のJSONファイル（`documentDirectory/proplus/proplus-v1.json`）に保存している（`src/lib/proplus/proplus-storage.ts`）。
既存のテーブル・migration・保存処理・削除処理には触れていない。状態の形は下のv8の列と1対1で、`exportForMigration`（`src/lib/proplus/proplus-store-core.ts`）が移行用の行を作る（テスト済み）。

## v8の案（既存の表へ列を足さない）

```sql
-- user_version 7 → 8。既存の trips / conversion_history / exchange_rates は変更しない
CREATE TABLE IF NOT EXISTS places (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT    NOT NULL UNIQUE,
  name            TEXT    NOT NULL,              -- 利用者が入力した店名（地図検索の結果は保存しない）
  lat             REAL,
  lng             REAL,
  coord_source    TEXT CHECK (coord_source IN ('device_gps','manual')),
  apple_place_id  TEXT,                          -- 保存可（Attachment 6 §2.5の対象外）。iOS 18+
  memo            TEXT    NOT NULL DEFAULT '',
  trip_id         INTEGER,                       -- 最初に登録した旅行（場所は旅行に固定しない）
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  deleted_at      TEXT
);
CREATE TABLE IF NOT EXISTS record_places (
  history_id      INTEGER NOT NULL UNIQUE,       -- conversion_history.id（外部キー制約は付けない：既存の削除処理を変えないため）
  place_uuid      TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS trip_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid            TEXT    NOT NULL UNIQUE,
  trip_id         INTEGER NOT NULL,
  kind            TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  starts_local    TEXT    NOT NULL,              -- 'YYYY-MM-DD' または 'YYYY-MM-DDTHH:mm'（現地の壁時計）
  ends_local      TEXT,
  tz_iana         TEXT    NOT NULL,
  all_day         INTEGER NOT NULL DEFAULT 0,
  place_uuid      TEXT,
  memo            TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id, starts_local);
```

## 承認時に決めること

1. v8の採用（このまま／列の変更）とdb-guardianの確認
2. JSONからの移行：v8の作成後に1回だけ `exportForMigration` の行を入れ、成功したらJSONを `proplus-v1.json.migrated` へ改名（削除しない）
3. 履歴の一括削除（`clearHistoryForTrip`・`clearHistory`）の後の `record_places` の整理を、既存の削除処理へ足すか、読み取り時の除外（現在の方式）で続けるか（設計書§3-2）
