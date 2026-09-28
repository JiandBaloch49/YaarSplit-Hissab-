// queries.js — every read and write the app does on the database.
//
// Screens call these functions and never write SQL themselves. Each table
// gets three kinds of function:
//   addX(...)       insert a new row (id and timestamps are filled in here)
//   listX(...)      return the live rows (deleted = 0)
//   deleteX(id)     SOFT delete: set deleted = 1 — rows are never removed
//                   (deleteMember refuses if the member isn't settled up)
//
// Expenses store payers/participants as JSON text in SQLite. This file is the
// only place that converts: JSON.stringify when saving, JSON.parse when
// loading. Everywhere else in the app they are always real arrays.

import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { prepareExpense, computeBalances } from '../logic/split';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Timestamps are milliseconds since 1970 (Date.now()), stored as INTEGER.
function now() {
  return Date.now();
}

// Soft-delete one row in any table.
//   deleted = 1     hide it from normal queries
//   updated_at      record when it changed
//   synced = 0      the change hasn't been sent anywhere yet
// `table` always comes from this file (never from user input), so it's safe
// to put it into the SQL string. The id is passed as a ? parameter.
function softDelete(table, id) {
  getDb().runSync(
    `UPDATE ${table} SET deleted = 1, updated_at = ?, synced = 0 WHERE id = ?`,
    [now(), id]
  );
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

// Create a group. Returns the new group row.
export function addGroup(name) {
  const time = now();
  const group = { id: Crypto.randomUUID(), name, created_at: time, updated_at: time };
  getDb().runSync(
    'INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [group.id, group.name, group.created_at, group.updated_at]
  );
  return group;
}

// All live groups, oldest first.
//
// About "ORDER BY created_at, rowid" (used in every list below): two rows
// saved in the same millisecond have the same created_at. rowid is SQLite's
// hidden row counter, which goes up with every insert on this phone, so it
// breaks the tie in the order the rows were added.
export function listGroups() {
  return getDb().getAllSync(
    'SELECT * FROM groups WHERE deleted = 0 ORDER BY created_at, rowid'
  );
}

// Note: this only hides the group itself. Its members, expenses and payments
// stay as they are — they can only be reached through the group anyway.
export function deleteGroup(id) {
  softDelete('groups', id);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// Add a person to a group. Returns the new member row.
export function addMember(groupId, name) {
  const time = now();
  const member = {
    id: Crypto.randomUUID(),
    group_id: groupId,
    name,
    created_at: time,
    updated_at: time,
  };
  getDb().runSync(
    'INSERT INTO members (id, group_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [member.id, member.group_id, member.name, member.created_at, member.updated_at]
  );
  return member;
}

// Live members of one group, in the order they were added.
export function listMembers(groupId) {
  return getDb().getAllSync(
    'SELECT * FROM members WHERE group_id = ? AND deleted = 0 ORDER BY created_at, rowid',
    [groupId]
  );
}

/**
 * Soft-delete a member — but only if they are fully settled up.
 *
 * If they still owe money (or are still owed money), deleting them would hide
 * that debt, so we refuse and explain why.
 *
 * Returns ONE of:
 *   { ok: true }            — deleted
 *   { ok: false, errors }   — not deleted; show these messages
 *
 * Old expenses that mention this member keep their member_id, so balances
 * from past meals still add up after they're gone.
 */
export function deleteMember(id) {
  const member = getDb().getFirstSync(
    'SELECT * FROM members WHERE id = ? AND deleted = 0',
    [id]
  );
  if (!member) {
    return { ok: false, errors: ['That member no longer exists.'] };
  }

  // Work out this member's balance from everything in their group.
  // + means they are owed money, - means they owe money (see split.js).
  const balances = computeBalances(
    listMembers(member.group_id),
    listExpenses(member.group_id),
    listPayments(member.group_id)
  );
  const balance = balances[id] || 0;

  if (balance < 0) {
    return { ok: false, errors: [`${member.name} still owes ${-balance}. Settle up first.`] };
  }
  if (balance > 0) {
    return { ok: false, errors: [`${member.name} is still owed ${balance}. Settle up first.`] };
  }

  softDelete('members', id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

// Turn a raw database row into the shape the rest of the app uses:
// payers/participants go from JSON text back into real arrays.
function expenseFromRow(row) {
  return {
    ...row,
    payers: JSON.parse(row.payers),
    participants: JSON.parse(row.participants),
  };
}

/**
 * Save a new expense.
 *
 * `input` is what the Add Expense screen collects (see prepareExpense in
 * src/logic/split.js): { description, amount, category, split_type, payers,
 * participants }.
 *
 * It ALWAYS goes through prepareExpense() first. That checks everything
 * (totals add up, whole rupees, ...) and works out each person's share.
 *
 * Returns ONE of:
 *   { ok: true,  expense }  — saved; `expense` is the new row (arrays, not JSON)
 *   { ok: false, errors }   — nothing was saved; show these messages
 */
export function addExpense(groupId, input) {
  const result = prepareExpense(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  // prepareExpense() returns clean payers/participants: only member_id and
  // amount/share, no names — so names never end up inside the stored JSON.
  const prepared = result.expense;
  const time = now();
  const expense = {
    id: Crypto.randomUUID(),
    group_id: groupId,
    description: prepared.description || '',
    amount: prepared.amount,
    category: prepared.category,
    split_type: prepared.split_type,
    payers: prepared.payers,
    participants: prepared.participants,
    created_at: time,
    updated_at: time,
    deleted: 0,
    synced: 0,
  };

  getDb().runSync(
    `INSERT INTO expenses
       (id, group_id, description, amount, category, split_type,
        payers, participants, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expense.id,
      expense.group_id,
      expense.description,
      expense.amount,
      expense.category,
      expense.split_type,
      JSON.stringify(expense.payers), // array → JSON text for SQLite
      JSON.stringify(expense.participants), // array → JSON text for SQLite
      expense.created_at,
      expense.updated_at,
    ]
  );

  return { ok: true, expense };
}

// Live expenses of one group, newest first, with payers/participants as arrays.
export function listExpenses(groupId) {
  const rows = getDb().getAllSync(
    'SELECT * FROM expenses WHERE group_id = ? AND deleted = 0 ORDER BY created_at DESC, rowid DESC',
    [groupId]
  );
  return rows.map(expenseFromRow);
}

export function deleteExpense(id) {
  softDelete('expenses', id);
}

// ---------------------------------------------------------------------------
// Payments (one member paying another back)
// ---------------------------------------------------------------------------

// The database columns are from_member_id / to_member_id, but split.js
// (computeBalances, settleUp) uses { fromId, toId, amount }. We convert here
// so a payment from listPayments() can be passed straight to computeBalances.
function paymentFromRow(row) {
  const { from_member_id, to_member_id, ...rest } = row;
  return { ...rest, fromId: from_member_id, toId: to_member_id };
}

/**
 * Record that `fromId` paid `toId` back `amount` rupees.
 *
 * Returns ONE of:
 *   { ok: true,  payment }  — saved
 *   { ok: false, errors }   — nothing was saved; show these messages
 */
export function addPayment(groupId, { fromId, toId, amount }) {
  // Basic checks, so a bad value becomes a readable message instead of a
  // crash from the table's CHECK (amount > 0).
  const errors = [];
  if (!Number.isInteger(amount) || amount <= 0) {
    errors.push('Amount must be a whole number of rupees, more than 0.');
  }
  if (!fromId || !toId) {
    errors.push('Pick who paid and who received the money.');
  } else if (fromId === toId) {
    errors.push('Someone can’t pay themselves.');
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const time = now();
  const payment = {
    id: Crypto.randomUUID(),
    group_id: groupId,
    fromId,
    toId,
    amount,
    created_at: time,
    updated_at: time,
    deleted: 0,
    synced: 0,
  };
  getDb().runSync(
    `INSERT INTO payments
       (id, group_id, from_member_id, to_member_id, amount, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [payment.id, groupId, fromId, toId, amount, time, time]
  );
  return { ok: true, payment };
}

// Live payments of one group, newest first, as { fromId, toId, amount, ... }.
export function listPayments(groupId) {
  const rows = getDb().getAllSync(
    'SELECT * FROM payments WHERE group_id = ? AND deleted = 0 ORDER BY created_at DESC, rowid DESC',
    [groupId]
  );
  return rows.map(paymentFromRow);
}

export function deletePayment(id) {
  softDelete('payments', id);
}
