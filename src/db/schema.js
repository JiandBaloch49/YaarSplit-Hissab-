// schema.js — the SQL that creates YaarSplit's tables.
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
// Every table also has created_by / updated_by: the member id (members.id)
// of who made the row and who changed it last. They are NULL in groups that
// only live on this phone (nobody has an account there); the server fills
// them in once the group is online.
//
// There are no FOREIGN KEY constraints on purpose. Rows are never hard-deleted
// (so nothing can be left dangling), and a future sync may receive rows in any
// order — e.g. an expense before the member it mentions — which foreign keys
// would reject.

// A group of friends who split bills together.
export const CREATE_GROUPS_TABLE = `
  CREATE TABLE IF NOT EXISTS groups (
    id             TEXT PRIMARY KEY NOT NULL,
    name           TEXT NOT NULL,

    -- The member holding the group fund's cash (members.id), or NULL when
    -- the group has no fund. Can only change while the fund is at 0.
    fund_holder_id TEXT,

    -- 1 = "Settle up" shows the short simplified list, 0 = each person pays
    -- back exactly who they owe. Only admins change it (on the server).
    simplify_debts INTEGER NOT NULL DEFAULT 1,

    -- Sync state. These three are ONLY for this phone: they are never sent
    -- to the server, and changing them does not set synced = 0.
    --   online        1 = the group is on the server and syncs
    --   last_seq      the server's seq number we've pulled up to (see
    --                 src/sync/engine.js)
    --   my_member_id  which member of this group is me (members.id), once
    --                 the group is online
    online         INTEGER NOT NULL DEFAULT 0,
    last_seq       INTEGER NOT NULL DEFAULT 0,
    my_member_id   TEXT,

    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    synced         INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT,
    updated_by     TEXT
  );
`;

// One person in a group.
export const CREATE_MEMBERS_TABLE = `
  CREATE TABLE IF NOT EXISTS members (
    id           TEXT PRIMARY KEY NOT NULL,
    group_id     TEXT NOT NULL,   -- which group they belong to (groups.id)
    name         TEXT NOT NULL,

    -- Set by the SERVER only (this phone never changes them): the account
    -- linked to this member slot, its @username (both NULL until someone
    -- accepts an invite for the slot), and 'admin' or 'member'.
    account_id   TEXT,
    username     TEXT,
    role         TEXT NOT NULL DEFAULT 'member',

    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced       INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT,
    updated_by   TEXT
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

    -- 1 = paid from the group fund. The payer is then always the fund
    -- holder (queries.js makes sure of that).
    from_fund    INTEGER NOT NULL DEFAULT 0,

    -- When its contents were last edited (milliseconds), or NULL if never.
    -- Not the same as updated_at, which also moves on delete / restore and
    -- when the server first receives it. Shown as "Edited by Bilal, 3:20 PM".
    edited_at    INTEGER,

    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    deleted      INTEGER NOT NULL DEFAULT 0,
    synced       INTEGER NOT NULL DEFAULT 0,
    created_by   TEXT,
    updated_by   TEXT
  );
`;

// Money handed directly from one member to another: paying someone back,
// putting money into the group fund, or the fund holder returning leftover.
export const CREATE_PAYMENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS payments (
    id             TEXT PRIMARY KEY NOT NULL,
    group_id       TEXT NOT NULL,
    from_member_id TEXT NOT NULL,   -- who gave the money
    to_member_id   TEXT NOT NULL,   -- who received it

    -- Whole rupees. Never a decimal.
    amount         INTEGER NOT NULL CHECK (amount > 0),

    -- 'settlement' (paying back), 'contribution' (into the group fund) or
    -- 'return' (leftover out of the fund). Allowed values live in split.js
    -- (PAYMENT_TYPES), same as categories.
    type           TEXT NOT NULL DEFAULT 'settlement',

    -- 'pending', 'confirmed', 'rejected' or 'cancelled' (PAYMENT_STATUSES
    -- in split.js). Only confirmed payments count in balances. In a group
    -- that only lives on this phone every payment is confirmed straight
    -- away; online, the receiver confirms (see addPayment in queries.js).
    -- The DEFAULT is 'confirmed' so payments saved before this column
    -- existed keep counting exactly as they did.
    status         TEXT NOT NULL DEFAULT 'confirmed',
    confirmed_at   INTEGER,         -- when it was confirmed
    confirmed_by   TEXT,            -- 'receiver' or 'admin' (set online)

    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    deleted        INTEGER NOT NULL DEFAULT 0,
    synced         INTEGER NOT NULL DEFAULT 0,
    created_by     TEXT,
    updated_by     TEXT
  );
`;

// Columns added after the first release. Phones that already have the
// tables need these added with ALTER TABLE ("CREATE TABLE IF NOT EXISTS"
// never changes a table that already exists). database.js adds any that are
// missing. New columns MUST have a DEFAULT (or allow NULL) so old rows get
// a sensible value.
//   [table, column, column definition]
export const ADDED_COLUMNS = [
  ['groups', 'fund_holder_id', 'TEXT'],
  ['expenses', 'from_fund', 'INTEGER NOT NULL DEFAULT 0'],
  ['payments', 'type', "TEXT NOT NULL DEFAULT 'settlement'"],

  // Phase 6b: accounts and sync.
  ['groups', 'simplify_debts', 'INTEGER NOT NULL DEFAULT 1'],
  ['groups', 'online', 'INTEGER NOT NULL DEFAULT 0'],
  ['groups', 'last_seq', 'INTEGER NOT NULL DEFAULT 0'],
  ['groups', 'my_member_id', 'TEXT'],
  ['members', 'account_id', 'TEXT'],
  ['members', 'username', 'TEXT'],
  ['members', 'role', "TEXT NOT NULL DEFAULT 'member'"],
  // Payments saved before statuses existed were real money changing hands,
  // so they become 'confirmed' (the DEFAULT fills in every existing row).
  ['payments', 'status', "TEXT NOT NULL DEFAULT 'confirmed'"],
  ['payments', 'confirmed_at', 'INTEGER'],
  ['payments', 'confirmed_by', 'TEXT'],
  ['groups', 'created_by', 'TEXT'],
  ['groups', 'updated_by', 'TEXT'],
  ['members', 'created_by', 'TEXT'],
  ['members', 'updated_by', 'TEXT'],
  ['expenses', 'created_by', 'TEXT'],
  ['expenses', 'updated_by', 'TEXT'],
  ['payments', 'created_by', 'TEXT'],
  ['payments', 'updated_by', 'TEXT'],

  // Phase 6b-2: "Edited by Bilal, 3:20 PM". Old rows: NULL = never edited.
  ['expenses', 'edited_at', 'INTEGER'],
];

// Every CREATE statement, in the order database.js runs them.
export const ALL_TABLES = [
  CREATE_GROUPS_TABLE,
  CREATE_MEMBERS_TABLE,
  CREATE_EXPENSES_TABLE,
  CREATE_PAYMENTS_TABLE,
];
