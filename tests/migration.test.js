// migration.test.js — a phone that already has the OLD tables (from before
// the group fund and before sync) gets the new columns added on startup,
// and its existing rows keep working. Runs the real src/db code on an in-memory SQLite.
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDb, initDatabase } from '../src/db/database.js';
import { listExpenses, listPayments } from '../src/db/queries.js';
import { computeBalances } from '../src/logic/split.js';

// The tables exactly as the app created them before the group fund
// (no fund_holder_id, from_fund or type columns).
const OLD_TABLES = `
  CREATE TABLE groups (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE members (
    id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL, name TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE expenses (
    id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL DEFAULT 'other', split_type TEXT NOT NULL DEFAULT 'equal',
    payers TEXT NOT NULL, participants TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE payments (
    id TEXT PRIMARY KEY NOT NULL, group_id TEXT NOT NULL,
    from_member_id TEXT NOT NULL, to_member_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0, synced INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO groups (id, name, created_at, updated_at) VALUES ('g', 'Old trip', 1, 1);
  INSERT INTO expenses (id, group_id, amount, payers, participants, created_at, updated_at)
    VALUES ('e', 'g', 600, '[{"member_id":"a","amount":600}]', '[{"member_id":"a","share":600}]', 1, 1);
  INSERT INTO payments (id, group_id, from_member_id, to_member_id, amount, created_at, updated_at)
    VALUES ('p', 'g', 'b', 'a', 100, 1, 1);
`;

function columnsOf(table) {
  return getDb()
    .getAllSync(`PRAGMA table_info(${table})`)
    .map((c) => c.name);
}

test('migration: old tables get the new columns, old rows get the defaults', () => {
  getDb().execSync(OLD_TABLES);

  initDatabase(); // what the app runs on startup

  assert.ok(columnsOf('groups').includes('fund_holder_id'));
  assert.ok(columnsOf('expenses').includes('from_fund'));
  assert.ok(columnsOf('payments').includes('type'));

  // Old rows: not a fund expense, and an ordinary settlement.
  assert.equal(listExpenses('g')[0].from_fund, 0);
  assert.equal(listPayments('g')[0].type, 'settlement');
  assert.equal(getDb().getFirstSync('SELECT fund_holder_id FROM groups').fund_holder_id, null);
  // Old expenses were never edited (as far as "Edited by" is concerned).
  assert.equal(listExpenses('g')[0].edited_at, null);
});

test('migration: sync columns are added; old payments become confirmed and still count', () => {
  for (const table of ['groups', 'members', 'expenses', 'payments']) {
    assert.ok(columnsOf(table).includes('created_by'), `${table}.created_by`);
    assert.ok(columnsOf(table).includes('updated_by'), `${table}.updated_by`);
  }
  for (const column of ['status', 'confirmed_at', 'confirmed_by']) {
    assert.ok(columnsOf('payments').includes(column), `payments.${column}`);
  }
  for (const column of ['online', 'last_seq', 'my_member_id', 'simplify_debts']) {
    assert.ok(columnsOf('groups').includes(column), `groups.${column}`);
  }

  // The old payment (b paid a 100) is confirmed, so it still moves money.
  const [payment] = listPayments('g');
  assert.equal(payment.status, 'confirmed');
  const balances = computeBalances([{ id: 'a' }, { id: 'b' }], listExpenses('g'), [payment]);
  assert.deepEqual(balances, { a: -100, b: 100 });

  // The old group only lives on this phone until it's put online.
  const group = getDb().getFirstSync('SELECT online, last_seq, simplify_debts FROM groups');
  assert.deepEqual(group, { online: 0, last_seq: 0, simplify_debts: 1 });
});

test('migration: running startup again changes nothing', () => {
  const before = columnsOf('payments');
  initDatabase();
  assert.deepEqual(columnsOf('payments'), before);
});
