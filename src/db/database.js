// database.js — opens Hisaab's local SQLite database and creates the tables.
//
// Everything is saved on the phone first (offline-first), so this database is
// the app's source of truth. We use expo-sqlite's SYNC API: calls return
// results straight away instead of promises, which keeps the code simple.
//
// Other files get the open database with getDb(). Screens should not use it
// directly — they call the functions in queries.js instead.

import * as SQLite from 'expo-sqlite';
import { ADDED_COLUMNS, ALL_TABLES } from './schema';

// The file name of the database on the phone.
const DATABASE_NAME = 'hisaab.db';

// The single open connection, shared by the whole app. Opened on first use.
let db = null;

// Return the open database, opening it the first time it's needed.
export function getDb() {
  if (db === null) {
    db = SQLite.openDatabaseSync(DATABASE_NAME);
  }
  return db;
}

// Run once when the app starts (see App.js). Safe to call again: every table
// is created with "IF NOT EXISTS", and columns are only added if missing,
// so existing data is never touched.
export function initDatabase() {
  const database = getDb();

  // WAL ("write-ahead log") mode makes writes faster and lets reads happen
  // while a write is in progress. It's the setting expo-sqlite recommends.
  database.execSync('PRAGMA journal_mode = WAL;');

  // Create all the tables in one transaction, so we never end up with only
  // some of them if something goes wrong halfway.
  database.withTransactionSync(() => {
    for (const createTableSql of ALL_TABLES) {
      database.execSync(createTableSql);
    }

    // Bring tables made by an older version of the app up to date.
    for (const [table, column, definition] of ADDED_COLUMNS) {
      addColumnIfMissing(database, table, column, definition);
    }
  });
}

// Add one column to a table, unless it's already there.
//
// PRAGMA table_info lists a table's columns ({ name, type, ... } per
// column). A brand-new install already has every column (they're in the
// CREATE TABLE statements), so this does nothing there; an older install
// gets the column added, and existing rows get its DEFAULT value.
// table/column/definition come from schema.js, never from user input, so
// putting them into the SQL text is safe.
function addColumnIfMissing(database, table, column, definition) {
  const columns = database.getAllSync(`PRAGMA table_info(${table})`);
  if (columns.some((c) => c.name === column)) return;
  database.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
