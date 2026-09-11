/**
 * `db/schema-migration-core.ts`の検証（`node --test src/db/schema-migration-core.test.mjs`）。
 *
 * Fable 5.1 / Codex独立監査（2026-09-11、HEAD dbd99ce）S2-9：
 * v3中断後の再起動でバックアップ（`_trips_old`）を消してしまう経路と、
 * ALTER例外の一括握り潰しによる「列が無いままversionだけ進む」不整合の再発防止。
 */
import { equal } from 'node:assert/strict';
import { test } from 'node:test';

import { isDuplicateColumnError, planTripsV3 } from './schema-migration-core.ts';

const OLD_COLUMNS = ['id', 'name', 'budget_jpy', 'currency', 'created_at', 'archived_at'];
const NEW_COLUMNS = ['id', 'name', 'base_currency', 'target_currency', 'manual_rate', 'budget_jpy', 'started_at', 'ended_at', 'is_active', 'created_at', 'updated_at', 'archived_at'];

test('planTripsV3: 旧スキーマ（v2直後）→ rename_and_copy（通常経路）', () => {
  equal(planTripsV3({ tripsColumns: OLD_COLUMNS, hasTripsOld: false }), 'rename_and_copy');
});

test('planTripsV3: rename後に中断（tripsなし・_trips_oldあり）→ resume_copy（バックアップを消さない）', () => {
  equal(planTripsV3({ tripsColumns: null, hasTripsOld: true }), 'resume_copy');
});

test('planTripsV3: 新trips作成後に中断（新スキーマ・_trips_oldあり）→ resume_copy', () => {
  equal(planTripsV3({ tripsColumns: NEW_COLUMNS, hasTripsOld: true }), 'resume_copy');
});

test('planTripsV3: コピー・旧削除まで済んだがversion更新前に中断（新スキーマ・_trips_oldなし）→ already_migrated', () => {
  equal(planTripsV3({ tripsColumns: NEW_COLUMNS, hasTripsOld: false }), 'already_migrated');
});

test('planTripsV3: tripsも_trips_oldも無い → fresh_create（防御分岐）', () => {
  equal(planTripsV3({ tripsColumns: null, hasTripsOld: false }), 'fresh_create');
});

test('planTripsV3: 旧スキーマ＋_trips_old（通常到達しない）→ データは旧trips側なので rename_and_copy', () => {
  equal(planTripsV3({ tripsColumns: OLD_COLUMNS, hasTripsOld: true }), 'rename_and_copy');
});

test('isDuplicateColumnError: SQLiteの重複列エラーだけをtrueにする', () => {
  equal(isDuplicateColumnError(new Error('duplicate column name: memo')), true);
  equal(isDuplicateColumnError(new Error('Error code 1: duplicate column name: category')), true);
  equal(isDuplicateColumnError('DUPLICATE COLUMN NAME: image_uri'), true);
});

test('isDuplicateColumnError: 重複列以外（I/O・破損・ロック）はfalse（握り潰さない）', () => {
  equal(isDuplicateColumnError(new Error('database is locked')), false);
  equal(isDuplicateColumnError(new Error('disk I/O error')), false);
  equal(isDuplicateColumnError(new Error('database disk image is malformed')), false);
  equal(isDuplicateColumnError(null), false);
  equal(isDuplicateColumnError(undefined), false);
  equal(isDuplicateColumnError({}), false);
});
