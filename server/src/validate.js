// validate.js — checks data from phones before anything is saved.
//
// The phone already checks everything, but the server can't trust that: an
// old app version, a bug or a hand-made request could send bad data, and
// that bad data would then spread to every friend's phone. So the server
// repeats the checks and rejects the request if anything is wrong.
//
// The money checks are NOT rewritten here. They come from ./logic/split.js,
// an exact copy of the app's src/logic/split.js (a test makes sure the two
// files stay identical), so the phone and the server can never disagree
// about what a valid expense is.
//
// Every validate...() function returns ONE of:
//   { ok: true, data }     — valid; `data` is cleaned up and ready to save
//   { ok: false, errors }  — list of messages; save NOTHING

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

// Checks shared by every uploaded row: id, timestamps, deleted flag.
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

// Error messages start with "<where>: " for rows in a list (an upload) and
// with nothing for a single row (one expense sent on its own).
const prefix = (where) => (where ? `${where}: ` : '');

/**
 * The money and member checks for ONE expense. Adds messages to `errors`.
 * `memberIds` is a Set of the member ids allowed in it.
 * Returns the fields to save (shares worked out by prepareExpense), or null.
 */
function checkExpenseFields(expense, memberIds, where, errors) {
  const p = prefix(where);
  const before = errors.length;

  if (expense.from_fund !== 0 && expense.from_fund !== 1) {
    errors.push(`${p}from_fund must be 0 or 1.`);
  }
  if (expense.description !== undefined && typeof expense.description !== 'string') {
    errors.push(`${p}description must be text.`);
  }

  // payers/participants must be lists of objects, or prepareExpense()
  // (written for the app's own tidy data) could crash on them.
  const isListOfObjects = (list) =>
    Array.isArray(list) && list.every((item) => item && typeof item === 'object');
  if (!isListOfObjects(expense.payers) || !isListOfObjects(expense.participants)) {
    errors.push(`${p}payers and participants must be lists.`);
    return null;
  }

  // Everyone who paid or ate must be in this group.
  for (const person of [...expense.payers, ...expense.participants]) {
    if (!memberIds.has(person.member_id)) {
      errors.push(`${p}${person.member_id} is not a member of this group.`);
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
    for (const message of result.errors) errors.push(`${p}${message}`);
    return null;
  }
  if (errors.length > before) return null;

  // Save the shares prepareExpense worked out. For equal splits it
  // recalculates them with splitAmount(), exactly like the phone did, so
  // this is the same data the phone has — just guaranteed correct.
  return {
    description: expense.description ?? '',
    amount: expense.amount,
    category: expense.category,
    split_type: expense.split_type,
    payers: result.expense.payers,
    participants: result.expense.participants,
    from_fund: expense.from_fund,
  };
}

/**
 * The checks for ONE payment. Adds messages to `errors`.
 * Returns the fields to save, or null.
 */
function checkPaymentFields(payment, memberIds, where, errors) {
  const p = prefix(where);
  const before = errors.length;
  if (!memberIds.has(payment.from_member_id)) {
    errors.push(`${p}from_member_id is not a member of this group.`);
  }
  if (!memberIds.has(payment.to_member_id)) {
    errors.push(`${p}to_member_id is not a member of this group.`);
  }
  // Any amount above 0 is fine: paying back part of a debt is allowed.
  if (!isPositiveRupees(payment.amount)) {
    errors.push(`${p}amount must be a whole number of rupees, more than 0.`);
  }
  if (!PAYMENT_TYPES.includes(payment.type)) {
    errors.push(`${p}type must be one of: ${PAYMENT_TYPES.join(', ')}.`);
  }
  if (errors.length > before) return null;
  return {
    from_member_id: payment.from_member_id,
    to_member_id: payment.to_member_id,
    amount: payment.amount,
    type: payment.type,
  };
}

/**
 * Check a whole group upload (the body of POST /groups):
 *   {
 *     my_member_id: which member the uploader is (becomes the admin),
 *     group:    { id, name, fund_holder_id, simplify_debts?,
 *                 created_at, updated_at, deleted },
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
 * simplify_debts is 0 or 1 and defaults to 1 (on).
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
    if (group.simplify_debts !== undefined && group.simplify_debts !== 0 && group.simplify_debts !== 1) {
      errors.push('group: simplify_debts must be 0 or 1.');
    }
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

  // The uploader must say which (live) member they are: that slot gets
  // linked to their account and becomes the group's first admin.
  const me = members.find((m) => m?.id === body.my_member_id);
  if (!me || me.deleted !== 0) {
    errors.push('my_member_id must be one of the live members.');
  }

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
    const fields = checkExpenseFields(expense, memberIds, where, errors);
    // edited_at: when it was edited on the phone before going online (or
    // null). Anything that isn't a timestamp is simply dropped.
    const editedAt = isTimestamp(expense.edited_at) ? expense.edited_at : null;
    if (fields) cleanExpenses.push({ ...pickBase(expense), group_id: groupId, ...fields, edited_at: editedAt });
  });

  // --- Payments ---
  const cleanPayments = [];
  payments.forEach((payment, i) => {
    const where = `payments[${i}]`;
    if (!checkBase(payment, where, errors)) return;
    if (payment.group_id !== groupId) errors.push(`${where}: belongs to a different group.`);
    const fields = checkPaymentFields(payment, memberIds, where, errors);
    if (fields) cleanPayments.push({ ...pickBase(payment), group_id: groupId, ...fields });
  });

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      myMemberId: me.id,
      group: {
        ...pickBase(group),
        name: group.name,
        fund_holder_id: fundHolderId,
        simplify_debts: group.simplify_debts ?? 1,
      },
      members: members.map((m) => ({ ...pickBase(m), group_id: groupId, name: m.name })),
      expenses: cleanExpenses,
      payments: cleanPayments,
    },
  };
}

// Keep only the shared fields we know about, so nothing unexpected is stored.
function pickBase(row) {
  return { id: row.id, created_at: row.created_at, updated_at: row.updated_at, deleted: row.deleted };
}

/**
 * Check ONE new or edited expense (POST / PUT .../expenses):
 *   { description, amount, category, split_type, payers, participants,
 *     from_fund }
 * `liveMemberIds` is a Set of the group's LIVE member ids: a new or edited
 * expense can't include someone who was removed.
 * from_fund defaults to 0.
 */
export function validateExpense(body, liveMemberIds) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Send the expense as JSON.'] };
  const errors = [];
  const fields = checkExpenseFields({ from_fund: 0, ...body }, liveMemberIds, '', errors);
  return fields ? { ok: true, data: fields } : { ok: false, errors };
}

/**
 * Check ONE new payment (POST .../payments):
 *   { from_member_id, to_member_id, amount, type }
 * type defaults to 'settlement'. Both people must be live members.
 * Who may record it, and the fund rules, are checked in the payment routes.
 */
export function validatePayment(body, liveMemberIds) {
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Send the payment as JSON.'] };
  const errors = [];
  const fields = checkPaymentFields({ type: 'settlement', ...body }, liveMemberIds, '', errors);
  return fields ? { ok: true, data: fields } : { ok: false, errors };
}

/**
 * Usernames: 3–20 characters, lower-case letters, digits and "_".
 * People type them with or without the "@" and in any case, so
 * normalizeUsername("@Nisar ") → "nisar". Returns '' for non-text.
 */
export function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^@/, '').toLowerCase();
}

export function isValidUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

export { isId, isTimestamp, isNonEmptyString };
