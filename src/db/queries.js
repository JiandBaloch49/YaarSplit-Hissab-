// queries.js — every read and write the app does on the database.
//
// Screens call these functions and never write SQL themselves. The main
// kinds of function:
//   addX(...)       insert a new row (id and timestamps are filled in here)
//   listX(...)      return the live rows (deleted = 0)
//   renameX(...)    change a name (groups, members)
//   deleteX(id)     SOFT delete: set deleted = 1 — rows are never removed
//                   (deleteMember / deleteGroup refuse if not settled up)
//   restoreX(id)    undo a soft delete (expenses, payments — for "Undo")
//   setSimplifyDebts(groupId, on)   the group's "Simplify debts" setting
//
// Group fund: see "Group fund" below and fundSummary() in split.js.
//
// Every change sets updated_at to now, updated_by to me, and synced back to
// 0, then calls notifyLocalChange() so the sync engine uploads it soon
// (see changes.js and src/sync/engine.js).
//
// Online groups (shared through the server) have rules: who may rename,
// delete, confirm a payment... The SERVER decides: it checks everything
// again and puts back anything that wasn't allowed. We check the same rules
// here first only so the user gets a clear message straight away, instead
// of seeing their change bounce back later. Groups that only live on this
// phone have no accounts, so there every action is allowed.
//
// Functions that can be refused return { ok: true, ... } or
// { ok: false, errors } (a list of messages to show).
//
// Expenses store payers/participants as JSON text in SQLite. This file is the
// only place that converts: JSON.stringify when saving, JSON.parse when
// loading. Everywhere else in the app they are always real arrays.

import * as Crypto from 'expo-crypto';
import { getDb } from './database';
import { notifyLocalChange } from './changes';
import {
  PAYMENT_TYPES,
  computeBalances,
  fundSummary,
  prepareExpense,
  summarizeGroup,
} from '../logic/split';
import { formatRupees } from '../logic/format';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Timestamps are milliseconds since 1970 (Date.now()), stored as INTEGER.
function now() {
  return Date.now();
}

// A "refused" result with one message.
function refuse(message) {
  return { ok: false, errors: [message] };
}

// The group a row belongs to. `table` always comes from this file (never
// from user input), so it's safe to put it into the SQL string. The id is
// passed as a ? parameter.
function groupIdOf(table, id) {
  if (table === 'groups') return id;
  return getDb().getFirstSync(`SELECT group_id FROM ${table} WHERE id = ?`, [id])?.group_id ?? null;
}

/**
 * Who am I in this group?
 *   online    1 if the group is shared through the server, else 0
 *   meId      my member id (members.id), or null in a local group
 *   isAdmin   true if I'm an admin there — and always true in a local
 *             group, where there are no accounts and so no rules
 * Screens use this to hide buttons the server would refuse anyway.
 */
export function getMe(groupId) {
  const group = getDb().getFirstSync('SELECT online, my_member_id FROM groups WHERE id = ?', [groupId]);
  if (!group || !group.online) return { online: 0, meId: null, isAdmin: true };
  const me = group.my_member_id
    ? getDb().getFirstSync('SELECT role FROM members WHERE id = ?', [group.my_member_id])
    : null;
  return { online: 1, meId: group.my_member_id, isAdmin: me?.role === 'admin' };
}

// The member id to save in created_by / updated_by: me, or NULL in a group
// that only lives on this phone.
function actor(groupId) {
  return getMe(groupId).meId;
}

// The rule for group settings (rename, fund holder, delete, removing
// someone): admins only. Returns a message if refused, else null.
function adminOnly(groupId) {
  return getMe(groupId).isAdmin ? null : 'Only a group admin can do that.';
}

// The rule for changing an expense: its creator, or an admin.
// Returns a message if refused, else null.
function checkExpenseOwner(expense) {
  const { meId, isAdmin } = getMe(expense.group_id);
  if (isAdmin || expense.created_by === meId) return null;
  return 'Only the person who added this expense, or an admin, can change it.';
}

// Soft-delete one row in any table.
//   deleted = 1     hide it from normal queries
//   updated_at      record when it changed (and updated_by: who did it)
//   synced = 0      the change hasn't been sent to the server yet
// Same safety note as groupIdOf about `table`.
function softDelete(table, id) {
  const groupId = groupIdOf(table, id);
  getDb().runSync(
    `UPDATE ${table} SET deleted = 1, updated_at = ?, updated_by = ?, synced = 0 WHERE id = ?`,
    [now(), actor(groupId), id]
  );
  notifyLocalChange(groupId);
}

// Undo a soft delete: the row comes back exactly as it was (deleted = 0).
// Same safety note as groupIdOf about `table`.
function restore(table, id) {
  const groupId = groupIdOf(table, id);
  getDb().runSync(
    `UPDATE ${table} SET deleted = 0, updated_at = ?, updated_by = ?, synced = 0 WHERE id = ?`,
    [now(), actor(groupId), id]
  );
  notifyLocalChange(groupId);
}

// Change the name of a live row in `groups` or `members`.
// Same safety note as groupIdOf about `table`.
function rename(table, id, name) {
  const groupId = groupIdOf(table, id);
  getDb().runSync(
    `UPDATE ${table} SET name = ?, updated_at = ?, updated_by = ?, synced = 0
      WHERE id = ? AND deleted = 0`,
    [name, now(), actor(groupId), id]
  );
  notifyLocalChange(groupId);
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

// Create a group. Returns the new group row.
// It only lives on this phone until "Put group online" (src/sync/engine.js).
export function addGroup(name) {
  const time = now();
  const group = { id: Crypto.randomUUID(), name, created_at: time, updated_at: time, online: 0 };
  getDb().runSync(
    'INSERT INTO groups (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [group.id, group.name, group.created_at, group.updated_at]
  );
  notifyLocalChange(group.id);
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

// One live group by id, or null if it's gone.
export function getGroup(id) {
  return getDb().getFirstSync('SELECT * FROM groups WHERE id = ? AND deleted = 0', [id]);
}

/**
 * Groups shared through the server in which I know who I am — the ones the
 * "Me" screen covers. (A group that only lives on this phone has no "me".)
 * Returns group rows, oldest first.
 */
export function listMyGroups() {
  return getDb().getAllSync(
    `SELECT * FROM groups
      WHERE deleted = 0 AND online = 1 AND my_member_id IS NOT NULL
      ORDER BY created_at, rowid`
  );
}

/**
 * Turn the group's "Simplify debts" setting on (true) or off (false).
 *   on   settle-up shows the fewest payments (settleUp in split.js)
 *   off  each person pays back exactly who they owe (pairwiseDebts)
 * Online: admins only. Returns { ok: true } or { ok: false, errors }.
 */
export function setSimplifyDebts(groupId, on) {
  const refused = adminOnly(groupId);
  if (refused) return refuse(refused);
  getDb().runSync(
    `UPDATE groups SET simplify_debts = ?, updated_at = ?, updated_by = ?, synced = 0
      WHERE id = ? AND deleted = 0`,
    [on ? 1 : 0, now(), actor(groupId), groupId]
  );
  notifyLocalChange(groupId);
  return { ok: true };
}

// Online: admins only. Returns { ok: true } or { ok: false, errors }.
export function renameGroup(id, name) {
  const refused = adminOnly(id);
  if (refused) return refuse(refused);
  rename('groups', id, name);
  return { ok: true };
}

/**
 * Soft-delete a group — but only if everyone in it is settled up, so no
 * debt disappears along with it. Online: admins only.
 *
 * Returns ONE of:
 *   { ok: true }            — deleted
 *   { ok: false, errors }   — not deleted; show these messages
 *
 * This only hides the group itself. Its members, expenses and payments stay
 * as they are — they can only be reached through the group anyway.
 */
export function deleteGroup(id) {
  const refused = adminOnly(id);
  if (refused) return refuse(refused);

  const { toSettle } = summarizeGroup(listMembers(id), listExpenses(id), listPayments(id));
  if (toSettle > 0) {
    return {
      ok: false,
      errors: [`${formatRupees(toSettle)} is still to be settled. Settle up first.`],
    };
  }
  softDelete('groups', id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// Add a person to a group. Returns the new member row.
// Anyone in the group may add a friend. (Linking that friend's account to
// the new slot happens later, on the server, through an invite.)
export function addMember(groupId, name) {
  const time = now();
  const by = actor(groupId);
  const member = {
    id: Crypto.randomUUID(),
    group_id: groupId,
    name,
    created_at: time,
    updated_at: time,
  };
  getDb().runSync(
    `INSERT INTO members (id, group_id, name, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [member.id, member.group_id, member.name, member.created_at, member.updated_at, by, by]
  );
  notifyLocalChange(groupId);
  return member;
}

// Live members of one group, in the order they were added.
export function listMembers(groupId) {
  return getDb().getAllSync(
    'SELECT * FROM members WHERE group_id = ? AND deleted = 0 ORDER BY created_at, rowid',
    [groupId]
  );
}

// Online: an admin, or the member renaming their own slot.
// Returns { ok: true } or { ok: false, errors }.
export function renameMember(id, name) {
  const { meId, isAdmin } = getMe(groupIdOf('members', id));
  if (!isAdmin && id !== meId) return refuse('Only an admin can rename someone else.');
  rename('members', id, name);
  return { ok: true };
}

// Members of a group with these ids, INCLUDING removed ones (deleted = 1).
//
// For showing or editing an old expense: it may mention someone who has since been
// removed. The form needs their name so it can keep them in the expense —
// otherwise saving would silently drop them and change everyone's balance.
export function listMembersByIds(groupId, ids) {
  if (ids.length === 0) return [];
  // One "?" per id: "id IN (?, ?, ?)". The ids themselves are passed as
  // parameters, never pasted into the SQL text.
  const placeholders = ids.map(() => '?').join(', ');
  return getDb().getAllSync(
    `SELECT * FROM members WHERE group_id = ? AND id IN (${placeholders}) ORDER BY created_at, rowid`,
    [groupId, ...ids]
  );
}

/**
 * Soft-delete a member — but only if they are fully settled up.
 *
 * If they still owe money (or are still owed money), deleting them would hide
 * that debt, so we refuse and explain why. Online, only admins can remove
 * someone, and not someone who joined with an account.
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

  const refused = adminOnly(member.group_id);
  if (refused) return refuse(refused);
  // Someone with an account has to be taken out of the group first (an
  // admin action on the server that the app doesn't offer yet), so the
  // slot can't just vanish under them.
  if (member.account_id) {
    return refuse(`${member.name} has joined with an account, so they can’t be removed here yet.`);
  }

  // The fund holder has the group's cash, so they can't just disappear.
  const group = getGroup(member.group_id);
  if (group && group.fund_holder_id === id) {
    return {
      ok: false,
      errors: [`${member.name} holds the group fund. Change the fund holder first.`],
    };
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
export function expenseFromRow(row) {
  return {
    ...row,
    payers: JSON.parse(row.payers),
    participants: JSON.parse(row.participants),
  };
}

// Fund expenses are ALWAYS paid by the fund holder, for the full amount —
// whatever the screen sent. (If the fund doesn't have enough, the holder
// covers the rest; fundSummary() in split.js works out that split.)
//
// Returns { ok: true, input } with payers filled in, or { ok: false, errors }.
function applyFundPayer(groupId, input) {
  if (!input.from_fund) return { ok: true, input: { ...input, from_fund: 0 } };

  const group = getGroup(groupId);
  if (!group || !group.fund_holder_id) {
    return {
      ok: false,
      errors: ['This group has no fund. Turn off “Paid from group fund” or start a fund first.'],
    };
  }
  return {
    ok: true,
    input: {
      ...input,
      from_fund: 1,
      payers: [{ member_id: group.fund_holder_id, amount: input.amount }],
    },
  };
}

/**
 * Save a new expense.
 *
 * `input` is what the Add Expense screen collects (see prepareExpense in
 * src/logic/split.js): { description, amount, category, split_type, payers,
 * participants, from_fund }.
 *
 * It ALWAYS goes through prepareExpense() first. That checks everything
 * (totals add up, whole rupees, ...) and works out each person's share.
 * With from_fund, the payer is set to the fund holder first.
 * Anyone in the group may add one.
 *
 * Returns ONE of:
 *   { ok: true,  expense }  — saved; `expense` is the new row (arrays, not JSON)
 *   { ok: false, errors }   — nothing was saved; show these messages
 */
export function addExpense(groupId, rawInput) {
  const fund = applyFundPayer(groupId, rawInput);
  if (!fund.ok) return fund;

  const result = prepareExpense(fund.input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  // prepareExpense() returns clean payers/participants: only member_id and
  // amount/share, no names — so names never end up inside the stored JSON.
  const prepared = result.expense;
  const time = now();
  const by = actor(groupId);
  const expense = {
    id: Crypto.randomUUID(),
    group_id: groupId,
    description: prepared.description || '',
    amount: prepared.amount,
    category: prepared.category,
    split_type: prepared.split_type,
    payers: prepared.payers,
    participants: prepared.participants,
    from_fund: prepared.from_fund,
    created_at: time,
    updated_at: time,
    deleted: 0,
    synced: 0,
    created_by: by,
    updated_by: by,
  };

  getDb().runSync(
    `INSERT INTO expenses
       (id, group_id, description, amount, category, split_type,
        payers, participants, from_fund, created_at, updated_at,
        created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      expense.id,
      expense.group_id,
      expense.description,
      expense.amount,
      expense.category,
      expense.split_type,
      JSON.stringify(expense.payers), // array → JSON text for SQLite
      JSON.stringify(expense.participants), // array → JSON text for SQLite
      expense.from_fund,
      expense.created_at,
      expense.updated_at,
      by,
      by,
    ]
  );

  notifyLocalChange(groupId);
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

// One live expense by id (arrays, not JSON), or null if it's gone.
// Used to pre-fill the form when editing.
export function getExpense(id) {
  const row = getDb().getFirstSync('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [id]);
  return row ? expenseFromRow(row) : null;
}

/**
 * May I edit or delete this expense? (Its creator or an admin, online.)
 * Returns null if yes, or the message to show.
 */
export function expenseChangeRefusal(expense) {
  return checkExpenseOwner(expense);
}

/**
 * Save changes to an existing expense.
 *
 * Works exactly like addExpense(): the new values ALWAYS go through
 * prepareExpense() first, and nothing is saved if it finds problems.
 * Online, only its creator or an admin may change it.
 * On success, updated_at and edited_at are set to now and synced goes back
 * to 0 (the change hasn't been sent anywhere yet). id, group_id and created_at never
 * change, so the expense keeps its place in the list.
 *
 * Returns ONE of:
 *   { ok: true,  expense }  — saved; the updated expense (arrays, not JSON)
 *   { ok: false, errors }   — nothing was saved; show these messages
 */
export function updateExpense(id, rawInput) {
  const existing = getExpense(id);
  if (!existing) {
    return { ok: false, errors: ['This expense was deleted, so it can’t be edited.'] };
  }
  const refused = checkExpenseOwner(existing);
  if (refused) return refuse(refused);

  const fund = applyFundPayer(existing.group_id, rawInput);
  if (!fund.ok) return fund;

  const result = prepareExpense(fund.input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  const prepared = result.expense;
  const time = now();
  const { changes } = getDb().runSync(
    `UPDATE expenses
        SET description = ?, amount = ?, category = ?, split_type = ?,
            payers = ?, participants = ?, from_fund = ?,
            edited_at = ?, updated_at = ?, updated_by = ?, synced = 0
      WHERE id = ? AND deleted = 0`,
    [
      prepared.description || '',
      prepared.amount,
      prepared.category,
      prepared.split_type,
      JSON.stringify(prepared.payers), // array → JSON text for SQLite
      JSON.stringify(prepared.participants),
      prepared.from_fund,
      time, // edited_at
      time, // updated_at
      actor(existing.group_id),
      id,
    ]
  );

  // changes = how many rows the UPDATE touched. 0 means the expense was
  // deleted (or never existed), so there was nothing to save into.
  if (changes === 0) {
    return { ok: false, errors: ['This expense was deleted, so it can’t be edited.'] };
  }
  notifyLocalChange(existing.group_id);
  return { ok: true, expense: getExpense(id) };
}

// Online: the expense's creator or an admin.
// Returns { ok: true } or { ok: false, errors }.
export function deleteExpense(id) {
  const expense = getExpense(id);
  if (!expense) return refuse('This expense was already deleted.');
  const refused = checkExpenseOwner(expense);
  if (refused) return refuse(refused);
  softDelete('expenses', id);
  return { ok: true };
}

// Undo deleteExpense (the "Undo" button after deleting). Only reachable
// right after a delete that was allowed, so it needs no check of its own.
export function restoreExpense(id) {
  restore('expenses', id);
}

// ---------------------------------------------------------------------------
// Payments (one member paying another back)
// ---------------------------------------------------------------------------

// The database columns are from_member_id / to_member_id, but split.js
// (computeBalances, settleUp) uses { fromId, toId, amount, status }. We
// convert here so a payment from listPayments() can be passed straight to
// computeBalances.
function paymentFromRow(row) {
  const { from_member_id, to_member_id, ...rest } = row;
  return { ...rest, fromId: from_member_id, toId: to_member_id };
}

/**
 * Record that `fromId` gave `toId` `amount` rupees.
 *
 * `type` (see PAYMENT_TYPES in split.js):
 *   'settlement'   (default) paying someone back
 *   'contribution' putting money into the group fund — toId must be the
 *                  fund holder. The holder may put in their own money, so
 *                  fromId === toId is allowed here.
 *   'return'       the holder handing leftover fund money back — fromId
 *                  must be the holder. toId === holder means "the holder
 *                  keeps it" (their own share).
 *
 * Status (only confirmed payments count in balances):
 *   - group only on this phone → 'confirmed' straight away (there are no
 *     accounts, so nobody else could confirm it)
 *   - online, I'm the receiver ("X paid me") → 'confirmed'
 *   - online, I'm the payer ("I paid X") → 'pending' until X confirms
 *   - online, I'm neither → refused: only the two people involved can
 *     record a payment (the server's rule)
 *
 * Returns ONE of:
 *   { ok: true,  payment }  — saved
 *   { ok: false, errors }   — nothing was saved; show these messages
 */
export function addPayment(groupId, { fromId, toId, amount, type = 'settlement' }) {
  // Basic checks, so a bad value becomes a readable message instead of a
  // crash from the table's CHECK (amount > 0).
  const errors = [];
  if (!Number.isInteger(amount) || amount <= 0) {
    errors.push('Amount must be a whole number of rupees, more than 0.');
  }
  if (!PAYMENT_TYPES.includes(type)) {
    errors.push(`Payment type must be one of: ${PAYMENT_TYPES.join(', ')}.`);
  }

  if (!fromId || !toId) {
    errors.push(
      type === 'contribution' ? 'Pick who is giving the money.' : 'Pick who paid and who received the money.'
    );
  } else if (type === 'settlement' && fromId === toId) {
    errors.push('Someone can’t pay themselves.');
  } else if (type !== 'settlement') {
    // Fund money must go to / come from whoever holds the fund.
    const holderId = getGroup(groupId)?.fund_holder_id;
    if (!holderId) {
      errors.push('This group has no fund.');
    } else if (type === 'contribution' && toId !== holderId) {
      errors.push('Money for the fund must go to the fund holder.');
    } else if (type === 'return' && fromId !== holderId) {
      errors.push('Only the fund holder can hand back fund money.');
    }
  }

  // Work out the status (see above).
  const { online, meId } = getMe(groupId);
  let status = 'confirmed';
  let confirmedBy = null;
  if (online && errors.length === 0) {
    if (toId === meId) {
      confirmedBy = 'receiver';
    } else if (fromId === meId) {
      status = 'pending';
    } else {
      errors.push('You can only record a payment you made or received.');
    }
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
    type,
    status,
    confirmed_at: status === 'confirmed' ? time : null,
    confirmed_by: confirmedBy,
    created_at: time,
    updated_at: time,
    deleted: 0,
    synced: 0,
    created_by: meId,
    updated_by: meId,
  };
  getDb().runSync(
    `INSERT INTO payments
       (id, group_id, from_member_id, to_member_id, amount, type,
        status, confirmed_at, confirmed_by,
        created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payment.id,
      groupId,
      fromId,
      toId,
      amount,
      type,
      status,
      payment.confirmed_at,
      confirmedBy,
      time,
      time,
      meId,
      meId,
    ]
  );
  notifyLocalChange(groupId);
  return { ok: true, payment };
}

// Live payments of one group, newest first, as { fromId, toId, amount, ... }.
// Every status is included (pending ones are shown, waiting for an answer);
// split.js only counts the confirmed ones.
export function listPayments(groupId) {
  const rows = getDb().getAllSync(
    'SELECT * FROM payments WHERE group_id = ? AND deleted = 0 ORDER BY created_at DESC, rowid DESC',
    [groupId]
  );
  return rows.map(paymentFromRow);
}

// Only in groups that live on this phone. Once a group is online, payments
// are cancelled or rejected instead (see answerPayment), never deleted, so
// the other person always sees what happened.
// Returns { ok: true } or { ok: false, errors }.
export function deletePayment(id) {
  if (getMe(groupIdOf('payments', id)).online) {
    return refuse('Shared payments can’t be deleted. Cancel or reject it instead.');
  }
  softDelete('payments', id);
  return { ok: true };
}

// Undo deletePayment (the "Undo" button after deleting).
export function restorePayment(id) {
  restore('payments', id);
}

/**
 * Which answers can I give to this payment right now? (Online groups.)
 * Returns { confirm, reject, cancel }, each true or false. The same rules
 * as the server's routes/payments.js:
 *   - only a pending payment can be answered
 *   - the receiver confirms or rejects; if the receiver has no account yet,
 *     an admin does it for them
 *   - only the payer cancels
 */
export function paymentActions(payment) {
  const none = { confirm: false, reject: false, cancel: false };
  if (payment.status !== 'pending') return none;
  const { online, meId, isAdmin } = getMe(payment.group_id);
  if (!online) return none;

  const receiver = getDb().getFirstSync('SELECT * FROM members WHERE id = ?', [payment.toId]);
  const receiverHasAccount = Boolean(receiver && !receiver.deleted && receiver.account_id);
  const mayAnswer = receiverHasAccount ? payment.toId === meId : isAdmin;
  return { confirm: mayAnswer, reject: mayAnswer, cancel: payment.fromId === meId };
}

/**
 * Answer a pending payment. `action` is 'confirm', 'reject' or 'cancel'.
 * The new status syncs to the server, which checks the rules again.
 * Returns { ok: true } or { ok: false, errors }.
 */
export function answerPayment(id, action) {
  const row = getDb().getFirstSync('SELECT * FROM payments WHERE id = ? AND deleted = 0', [id]);
  if (!row) return refuse('That payment no longer exists.');
  const payment = paymentFromRow(row);
  if (!paymentActions(payment)[action]) {
    return refuse(
      payment.status === 'pending'
        ? 'You can’t answer this payment.'
        : `This payment is already ${payment.status}.`
    );
  }

  const status = { confirm: 'confirmed', reject: 'rejected', cancel: 'cancelled' }[action];
  // Confirmed by the receiver themselves, or by an admin for a receiver who
  // has no account yet (paymentActions only allowed one of those).
  const receiver = getDb().getFirstSync('SELECT account_id FROM members WHERE id = ?', [payment.toId]);
  const confirmedBy = action === 'confirm' ? (receiver?.account_id ? 'receiver' : 'admin') : null;
  const time = now();

  getDb().runSync(
    `UPDATE payments
        SET status = ?, confirmed_at = ?, confirmed_by = ?,
            updated_at = ?, updated_by = ?, synced = 0
      WHERE id = ?`,
    [status, action === 'confirm' ? time : null, confirmedBy, time, actor(payment.group_id), id]
  );
  notifyLocalChange(payment.group_id);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Group fund
// ---------------------------------------------------------------------------

// The fund's numbers for a group (see fundSummary in split.js), or null if
// the group has no fund.
export function getFund(groupId) {
  const group = getGroup(groupId);
  if (!group || !group.fund_holder_id) return null;
  return fundSummary(group, listExpenses(groupId), listPayments(groupId));
}

/**
 * Start a fund, change who holds it, or end it (holderId = null).
 *
 * Changing the holder is only allowed while the fund is at Rs 0 — otherwise
 * the cash is in one person's pocket but the app would say it's in another's.
 * Online: admins only.
 *
 * Returns { ok: true } or { ok: false, errors }.
 */
export function setFundHolder(groupId, holderId) {
  const refused = adminOnly(groupId);
  if (refused) return refuse(refused);

  const fund = getFund(groupId);
  if (fund && fund.left !== 0) {
    return {
      ok: false,
      errors: [
        `The fund still has ${formatRupees(fund.left)}. Return the leftover first, then change the holder.`,
      ],
    };
  }
  getDb().runSync(
    `UPDATE groups SET fund_holder_id = ?, updated_at = ?, updated_by = ?, synced = 0
      WHERE id = ? AND deleted = 0`,
    [holderId, now(), actor(groupId), groupId]
  );
  notifyLocalChange(groupId);
  return { ok: true };
}
