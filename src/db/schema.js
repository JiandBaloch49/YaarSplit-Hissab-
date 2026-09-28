// schema.js — the SQL that creates Hisaab's tables.
//
// This file only holds SQL text; it doesn't open the database. database.js
// runs these statements every time the app starts ("IF NOT EXISTS" makes that
// safe to repeat — existing tables and their data are left alone).
//
// Every table follows the same rules (see CLAUDE.md):
//   id          TEXT UUID made on the phone (expo-crypto randomUUID)
//   created_at  when the row was made   (milliseconds, Date.now())
//   updated_at  when it last changed    (milliseconds, Date.now())
//   deleted     0/1 — soft delete, rows are never really removed
//   synced      0/1 — set back to 0 whenever the row changes
//
// There are no FOREIGN KEY constraints on purpose. Rows are never hard-deleted
// (so nothing can be left dangling), and a future sync may receive rows in any
// order — e.g. an expense before the member it mentions — which foreign keys
// would reject.

// A group of friends who split bills together.
export const CREATE_GROUPS_TABLE = `
  CREATE TABLE IF NOT EXISTS groups (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,

    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced       INTEGER NOT NULL DEFAULT 0
  );
`;

// One person in a group.
export const CREATE_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS members (
    id           TEXT PRIMARY KEY NOT NULL,
    group_id     TEXT NOT NULL,   -- which group they belong to (groups.id)
    name         TEXT NOT NULL,

    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced       INTEGER NOT NULL DEFAULT 0
  );
`;

// category and split_type have no CHECK constraints on purpose:
// prepareExpense() in src/logic/split.js is the ONE place that decides which
// values are allowed (see CATEGORIES / SPLIT_TYPES there).
export const CREATE_EXPENSES_TABLE = `
  CREATE TABLE IF NOT EXISTS expenses (
    id           TEXT PRIMARY KEY NOT NULL,
    group_id     TEXT NOT NULL,   -- which group this expense belongs to
    description  TEXT NOT NULL DEFAULT '',

    -- Total in whole rupees. Never a decimal.
    amount       INTEGER NOT NULL CHECK (amount > 0),

    -- e.g. 'food', 'tea' — allowed values live in split.js
    category     TEXT NOT NULL DEFAULT 'other',

    -- 'equal' or 'custom' — allowed values live in split.js
    split_type   TEXT NOT NULL DEFAULT 'equal',

    -- JSON text: who paid and how much. Amounts add up to "amount".
    --   [{"member_id": "...", "amount": 1200}, {"member_id": "...", "amount": 800}]
    payers       TEXT NOT NULL,

    -- JSON text: who the expense was FOR and each person's share.
    -- Shares add up to "amount". For equal splits they are calculated with
    -- splitAmount() when saving, so they are always stored, never re-worked.
    --   [{"member_id": "...", "share": 500}, ...]
    participants TEXT NOT NULL,

    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced       INTEGER NOT NULL DEFAULT 0
  );
`;

// Money paid back directly from one member to another ("settling up").
export const CREATE_PAYMENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS payments (
    id             TEXT PRIMARY KEY NOT NULL,
    group_id       TEXT NOT NULL,
    from_member_id TEXT NOT NULL,   -- who paid the money back
    to_member_id   TEXT NOT NULL,   -- who received it

    -- Whole rupees. Never a decimal.
    amount         INTEGER NOT NULL CHECK (amount > 0),

    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    synced         INTEGER NOT NULL DEFAULT 0
  );
`;

// Every CREATE statement, in the order database.js runs them.
export const ALL_TABLES = [
  CREATE_GROUPS_TABLE,
  CREATE_MEMBERS_TABLE,
  CREATE_EXPENSES_TABLE,
  CREATE_PAYMENTS_TABLE,
];
