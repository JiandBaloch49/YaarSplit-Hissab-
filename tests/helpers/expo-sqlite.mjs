// expo-sqlite.mjs — a stand-in for expo-sqlite, for tests only.
//
// The app's database code (src/db) uses expo-sqlite, which only runs on a
// phone. For tests we give it the same sync functions, backed by Node's
// built-in SQLite (node:sqlite) — a real SQLite, so the SQL really runs.
// Each test file runs in its own process, so each gets a fresh, empty
// in-memory database.
//
// Pretend phones: the sync test needs TWO phones in one process. The app
// opens its database once and keeps it, so instead of one database we hand
// back a "switchboard" that forwards every call to the database of the
// current phone, named by globalThis.testPhone (see tests/helpers/phones.mjs).
// Tests that never set it all use one phone called "default".
//
// Only the functions the app uses are here:
//   execSync, runSync, getAllSync, getFirstSync, withTransactionSync

import { DatabaseSync } from 'node:sqlite';

const databases = new Map(); // phone name → DatabaseSync

function current() {
  const phone = globalThis.testPhone ?? 'default';
  if (!databases.has(phone)) databases.set(phone, new DatabaseSync(':memory:'));
  return databases.get(phone);
}

export function openDatabaseSync() {
  return {
    execSync(sql) {
      current().exec(sql);
    },
    runSync(sql, params = []) {
      const result = current().prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    getAllSync(sql, params = []) {
      // node:sqlite returns objects with no prototype; spread them into
      // normal objects so assert.deepEqual compares them like the app sees.
      return current().prepare(sql).all(...params).map((row) => ({ ...row }));
    },
    getFirstSync(sql, params = []) {
      const row = current().prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
    withTransactionSync(task) {
      const db = current();
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
