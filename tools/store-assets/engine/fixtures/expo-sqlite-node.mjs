// expo-sqlite の非同期API（SQLiteDatabaseの一部）を node:sqlite の上で再現する小さな互換層。
// 目的：アプリ本体のmigration・保存関数をそのまま使って、シミュレーター撮影用のテストデータDBを作ること。
// 実機・利用者のDBには使わない（出力先は呼び出し側が指定する新しいファイルだけ）。
import { DatabaseSync } from 'node:sqlite';

function flatParams(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

export function openExpoSqliteCompat(file) {
  const db = new DatabaseSync(file);
  return {
    _raw: db,
    async execAsync(sql) { db.exec(sql); },
    async runAsync(sql, ...params) {
      const r = db.prepare(sql).run(...flatParams(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    async getFirstAsync(sql, ...params) { return db.prepare(sql).get(...flatParams(params)) ?? null; },
    async getAllAsync(sql, ...params) { return db.prepare(sql).all(...flatParams(params)); },
    async withTransactionAsync(fn) {
      db.exec('BEGIN');
      try { await fn(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async closeAsync() { db.close(); },
  };
}
