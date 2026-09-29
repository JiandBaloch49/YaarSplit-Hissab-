// expo-sqlite.mjs — a stand-in for expo-sqlite, for tests only.
//
// The app's database code (src/db) uses expo-sqlite, which only runs on a
// phone. For tests we give it the same sync functions, backed by Node's
// built-in SQLite (node:sqlite) — a real SQLite, so the SQL really runs.
// Each test file runs in its own process, so each gets a fresh, empty
// in-memory database.
//
// Only the functions the app uses are here:
//   execSync, runSync, getAllSync, getFirstSync, withTransactionSync

import { DatabaseSync } from 'node:sqlite';

export function openDatabaseSync() {
  const db = new DatabaseSync(':memory:');

  return {
    execSync(sql) {
      db.exec(sql);
    },
    runSync(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getAllSync(sql, params = []) {
      // node:sqlite returns objects with no prototype; spread them into
      // normal objects so assert.deepEqual compares them like the app sees.
      return db.prepare(sql).all(...params).map((row) => ({ ...row }));
    },
    getFirstSync(sql, params = []) {
      const row = db.prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
    withTransactionSync(task) {
      db.exec('BEGIN');
      try {
        task();
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
