// validate.js — checks an uploaded group before anything is saved.
//
// The phone already checks everything, but the server can't trust that: an
// old app version, a bug or a hand-made request could send bad data, and
// that bad data would then spread to every friend's phone. So the server
// repeats the checks and rejects the whole upload if anything is wrong.
//
// The money checks are NOT rewritten here. They come from ./logic/split.js,
// an exact copy of the app's src/logic/split.js (a test makes sure the two
// files stay identical), so the phone and the server can never disagree
// about what a valid expense is.

import { prepareExpense, PAYMENT_TYPES } from './logic/split.js';

// --- Small helpers ---

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Ids come from randomUUID() on the phone. We don't insist on the exact
// UUID format (old or test data may differ), just a sensible string.
function isId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

// Timestamps are milliseconds from Date.now(): whole numbers, 0 or more.
function isTimestamp(value) {
  return Number.isInteger(value) && value >= 0;
}

// Whole rupees, more than 0.
function isPositiveRupees(value) {
  return Number.isInteger(value) && value > 0;
}

// Checks shared by every row: id, timestamps, deleted flag.
// `where` names the row in error messages, e.g. "members[2]".
function checkBase(row, where, errors) {
  if (!row || typeof row !== 'object') {
    errors.push(`${where}: must be an object.`);
    return false;
  }
  if (!isId(row.id)) errors.push(`${where}: id is missing.`);
  if (!isTimestamp(row.created_at)) errors.push(`${where}: created_at must be a timestamp.`);
  if (!isTimestamp(row.updated_at)) errors.push(`${where}: updated_at must be a timestamp.`);
  if (row.deleted !== 0 && row.deleted !== 1) errors.push(`${where}: deleted must be 0 or 1.`);
  return true;
}

// Add an error for every id that appears more than once in a list of rows.
function checkUniqueIds(rows, listName, errors) {
  const seen = new Set();
  for (const row of rows) {
    if (row && seen.has(row.id)) errors.push(`${listName}: id ${row.id} appears more than once.`);
    if (row) seen.add(row.id);
  }
}

/**
 * Check a whole group upload (the body of POST /groups):
 *   {
 *     group:    { id, name, fund_holder_id, created_at, updated_at, deleted },
 *     members:  [{ id, group_id, name, created_at, updated_at, deleted }],
 *     expenses: [{ id, group_id, description, amount, category, split_type,
 *                  payers: [{ member_id, amount }],
 *                  participants: [{ member_id, share }],
 *                  from_fund, created_at, updated_at, deleted }],
 *     payments: [{ id, group_id, from_member_id, to_member_id, amount, type,
 *                  created_at, updated_at, deleted }],
 *   }
 * payers/participants are arrays here (the phone parses its JSON columns
 * before sending). Deleted rows are included too, so deletions sync.
 *
 * Returns ONE of:
 *   { ok: true, data }     — valid; `data` is cleaned up and ready to save
 *   { ok: false, errors }  — list of messages; save NOTHING
 */
export function validateGroupUpload(body) {
  const errors = [];
  const group = body?.group;
  const members = body?.members ?? [];
  const expenses = body?.expenses ?? [];
  const payments = body?.payments ?? [];

  // --- The group itself ---
  if (checkBase(group, 'group', errors)) {
    if (!isNonEmptyString(group.name)) errors.push('group: name is missing.');
  }
  if (!Array.isArray(members) || !Array.isArray(expenses) || !Array.isArray(payments)) {
    errors.push('members, expenses and payments must be lists.');
    return { ok: false, errors };
  }
  if (members.length === 0) errors.push('A group needs at least one member.');

  // If the group is unusable, the per-row checks below would only produce a
  // pile of confusing "wrong group_id" errors, so stop here.
  if (errors.length > 0) return { ok: false, errors };

  const groupId = group.id;
  checkUniqueIds(members, 'members', errors);
  checkUniqueIds(expenses, 'expenses', errors);
  checkUniqueIds(payments, 'payments', errors);

  // Every member id in this group, INCLUDING deleted members: an old
  // (deleted or not) expense may still mention someone who was removed later.
  const memberIds = new Set(members.map((m) => m?.id));

  // --- Members ---
  members.forEach((member, i) => {
    const where = `members[${i}]`;
    if (!checkBase(member, where, errors)) return;
    if (member.group_id !== groupId) errors.push(`${where}: belongs to a different group.`);
    if (!isNonEmptyString(member.name)) errors.push(`${where}: name is missing.`);
  });

  // The fund holder, if there is one, must be a member of this group.
  const fundHolderId = group.fund_holder_id ?? null;
  if (fundHolderId !== null && !memberIds.has(fundHolderId)) {
    errors.push('group: fund_holder_id is not a member of this group.');
  }

  // --- Expenses: the app's own prepareExpense() does the money checks ---
  const cleanExpenses = [];
  expenses.forEach((expense, i) => {
    const where = `expenses[${i}]`;
    if (!checkBase(expense, where, errors)) return;
    if (expense.group_id !== groupId) errors.push(`${where}: belongs to a different group.`);
    if (expense.from_fund !== 0 && expense.from_fund !== 1) {
      errors.push(`${where}: from_fund must be 0 or 1.`);
    }
    if (expense.description !== undefined && typeof expense.description !== 'string') {
      errors.push(`${where}: description must be text.`);
    }

    // payers/participants must be lists of objects, or prepareExpense()
    // (written for the app's own tidy data) could crash on them.
    const isListOfObjects = (list) =>
      Array.isArray(list) && list.every((item) => item && typeof item === 'object');
    if (!isListOfObjects(expense.payers) || !isListOfObjects(expense.participants)) {
      errors.push(`${where}: payers and participants must be lists.`);
      return;
    }

    // Everyone who paid or ate must be in this group.
    for (const person of [...expense.payers, ...expense.participants]) {
      if (!memberIds.has(person.member_id)) {
        errors.push(`${where}: ${person.member_id} is not a member of this group.`);
      }
    }

    const result = prepareExpense({
      amount: expense.amount,
      category: expense.category,
      split_type: expense.split_type,
      payers: expense.payers,
      participants: expense.participants,
    });
    if (!result.ok) {
      for (const message of result.errors) errors.push(`${where}: ${message}`);
      return;
    }

    // Save the shares prepareExpense worked out. For equal splits it
    // recalculates them with splitAmount(), exactly like the phone did, so
    // this is the same data the phone has — just guaranteed correct.
    cleanExpenses.push({
      id: expense.id,
      group_id: groupId,
      description: expense.description ?? '',
      amount: expense.amount,
      category: expense.category,
      split_type: expense.split_type,
      payers: result.expense.payers,
      participants: result.expense.participants,
      from_fund: expense.from_fund,
      created_at: expense.created_at,
      updated_at: expense.updated_at,
      deleted: expense.deleted,
    });
  });

  // --- Payments ---
  payments.forEach((payment, i) => {
    const where = `payments[${i}]`;
    if (!checkBase(payment, where, errors)) return;
    if (payment.group_id !== groupId) errors.push(`${where}: belongs to a different group.`);
    if (!memberIds.has(payment.from_member_id)) {
      errors.push(`${where}: from_member_id is not a member of this group.`);
    }
    if (!memberIds.has(payment.to_member_id)) {
      errors.push(`${where}: to_member_id is not a member of this group.`);
    }
    if (!isPositiveRupees(payment.amount)) {
      errors.push(`${where}: amount must be a whole number of rupees, more than 0.`);
    }
    if (!PAYMENT_TYPES.includes(payment.type)) {
      errors.push(`${where}: type must be one of: ${PAYMENT_TYPES.join(', ')}.`);
    }
  });

  if (errors.length > 0) return { ok: false, errors };

  // Keep only the fields we know about, so nothing unexpected gets stored.
  const pickBase = (row) => ({
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted: row.deleted,
  });

  return {
    ok: true,
    data: {
      group: { ...pickBase(group), name: group.name, fund_holder_id: fundHolderId },
      members: members.map((m) => ({ ...pickBase(m), group_id: groupId, name: m.name })),
      expenses: cleanExpenses,
      payments: payments.map((p) => ({
        ...pickBase(p),
        group_id: groupId,
        from_member_id: p.from_member_id,
        to_member_id: p.to_member_id,
        amount: p.amount,
        type: p.type,
      })),
    },
  };
}
