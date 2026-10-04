// routes/push.js — a phone uploads the changes it made (offline or not).
//
//   POST /groups/:groupId/push   (member)
//
// The app saves everything on the phone first. Its sync engine
// (src/sync/engine.js in the app) later sends every row it changed, as the
// WHOLE row, and this route works out what changed compared with the
// server's copy and whether the caller may make that change.
//
// Body:  { changes: [{ table, row }, ...] }   at most MAX_CHANGES
//   table  'groups', 'members', 'expenses' or 'payments'
//   row    the phone's row, in the same shape /changes sends back
//          (payers/participants as arrays). Phone-only fields (synced,
//          online, last_seq...) and server-only fields (seq, account_id,
//          role...) are ignored.
//
// Reply: { results: [...] } — one per change, in the same order:
//   { table, id, ok: true,  row }                       accepted
//   { table, id, ok: false, status, error, errors?, row } refused
// `row` is the server's version after the change (null if the server has
// none, e.g. a refused new expense). The phone saves it over its own copy:
// on a refusal that "restores the server's version", and on success it
// picks up what the server decided (a payment's status, created_by...).
// `status` is the HTTP code the matching endpoint would have used (400 bad
// data, 403 not allowed, 404 gone, 409 conflict).
//
// Each change is checked and saved ON ITS OWN, in order: one refused change
// doesn't stop the others. The phone sends members before expenses, so an
// expense can mention a member added in the same push.
//
// The rules are the same as the single-row endpoints (they share rules.js):
//   groups    only admins change the name, fund holder, simplify_debts or
//             delete it; the holder only changes while the fund is at Rs 0;
//             deleting needs everyone settled up
//   members   anyone in the group may add a member slot; renaming: an admin
//             or the member themselves; removing: an admin, only if the slot
//             has no account linked, isn't the fund holder and is settled up
//   expenses  anyone may add one; only its creator or an admin may edit,
//             delete or restore it; every expense passes prepareExpense()
//   payments  only the payer or receiver records one (the server decides
//             its status); afterwards only the status may change, by the
//             usual confirm / reject / cancel rules. Payments are never
//             edited or deleted once on the server.
// Every write goes through saveWithSeqs(), so other phones pull it.

import express from 'express';
import { Expense, Group, Member, Payment, toApp } from '../models.js';
import { saveWithSeqs } from '../seq.js';
import { requireAccount, requireMember } from '../auth.js';
import { isId, isNonEmptyString, isTimestamp, validateExpense, validatePayment } from '../validate.js';
import { liveMemberIds, loadForSplit } from '../groupData.js';
import { computeBalances, fundSummary, summarizeGroup } from '../logic/split.js';
import {
  answerChanges,
  checkAdmin,
  checkExpenseOwner,
  checkFundRules,
  initialPaymentStatus,
} from '../rules.js';
import { HttpError } from '../errors.js';

// More than this per request and the phone sends the rest in a second push.
export const MAX_CHANGES = 200;

const MODELS = { groups: Group, members: Member, expenses: Expense, payments: Payment };

export function pushRoutes() {
  const router = express.Router();

  router.post('/groups/:groupId/push', requireAccount, requireMember, async (req, res) => {
    const changes = req.body?.changes;
    if (!Array.isArray(changes)) throw new HttpError(400, 'changes must be a list.');
    if (changes.length > MAX_CHANGES) {
      throw new HttpError(400, `Send at most ${MAX_CHANGES} changes at a time.`);
    }

    const results = [];
    for (const change of changes) {
      const table = change?.table;
      const row = change?.row;
      const id = row?.id;
      try {
        if (!MODELS[table]) throw new HttpError(400, 'table must be groups, members, expenses or payments.');
        if (!row || typeof row !== 'object' || !isId(id)) throw new HttpError(400, 'row.id is missing.');
        await APPLY[table](req, row);
        results.push({ table, id, ok: true, row: await serverRow(table, id, req.group._id) });
      } catch (error) {
        // A refusal on purpose: report it and carry on with the next change.
        // Anything else is a real failure (e.g. the database is down): stop,
        // so the phone keeps its changes and tries again later.
        if (!(error instanceof HttpError)) throw error;
        results.push({
          table,
          id: typeof id === 'string' ? id : null,
          ok: false,
          status: error.status,
          error: error.message,
          ...(error.errors ? { errors: error.errors } : {}),
          row: MODELS[table] && isId(id) ? await serverRow(table, id, req.group._id) : null,
        });
      }
    }
    res.json({ results });
  });

  return router;
}

/** The server's copy of a row in this group, in the app's shape, or null. */
async function serverRow(table, id, groupId) {
  const filter = table === 'groups' ? { _id: id } : { _id: id, group_id: groupId };
  if (table === 'groups' && id !== groupId) return null;
  const doc = await MODELS[table].findOne(filter).lean();
  return doc ? toApp(doc) : null;
}

// A row's deleted flag must be exactly 0 or 1.
function checkDeletedFlag(row) {
  if (row.deleted !== 0 && row.deleted !== 1) throw new HttpError(400, 'deleted must be 0 or 1.');
}

// A row (other than the group itself) must belong to the group in the URL.
function checkGroupId(row, req) {
  if (row.group_id !== req.group._id) throw new HttpError(400, 'This row belongs to a different group.');
}

// An existing document with this id, but in ANOTHER group: ids are UUIDs,
// so that should never happen; refuse rather than move it.
function checkSameGroup(existing, req) {
  if (existing && existing.group_id !== req.group._id) {
    throw new HttpError(409, 'A row with this id already exists in another group.');
  }
}

// created_at from the phone (when it really happened), or now.
function createdAt(row, now) {
  return isTimestamp(row.created_at) ? row.created_at : now;
}

// payers / participants compared as text, keeping only the fields that
// matter, so { member_id, amount } from the phone equals the stored copy.
function sameList(a, b, field) {
  const clean = (list) => JSON.stringify((list ?? []).map((x) => [x.member_id, x[field]]));
  return clean(a) === clean(b);
}

// ---------------------------------------------------------------------------
// One function per table. Each one either saves the change (through
// saveWithSeqs) or throws an HttpError saying why not. Doing nothing is fine
// too: a row that already matches the server (e.g. sent twice after a lost
// reply) changes nothing.
// ---------------------------------------------------------------------------

const APPLY = {
  // --- The group itself: name, fund holder, simplify_debts, deleted ---
  async groups(req, row) {
    if (row.id !== req.group._id) throw new HttpError(400, 'This change belongs to a different group.');
    checkDeletedFlag(row);
    const group = req.group;

    const wanted = {
      name: typeof row.name === 'string' ? row.name.trim() : row.name,
      fund_holder_id: row.fund_holder_id ?? null,
      simplify_debts: row.simplify_debts ?? group.simplify_debts,
      deleted: row.deleted,
    };
    const changed = Object.keys(wanted).filter((key) => wanted[key] !== group[key]);
    if (changed.length === 0) return;

    checkAdmin(req.member);
    if (!isNonEmptyString(wanted.name) || wanted.name.length > 100) {
      throw new HttpError(400, 'The group name must be 1 to 100 characters.');
    }
    if (wanted.simplify_debts !== 0 && wanted.simplify_debts !== 1) {
      throw new HttpError(400, 'simplify_debts must be 0 or 1.');
    }

    if (changed.includes('fund_holder_id') || changed.includes('deleted')) {
      const { members, expenses, payments } = await loadForSplit(group._id);
      if (changed.includes('fund_holder_id')) {
        // The cash is in the old holder's pocket, so the holder only changes
        // while the fund is empty (the app's setFundHolder rule).
        const left = group.fund_holder_id ? fundSummary(group, expenses, payments).left : 0;
        if (left !== 0) {
          throw new HttpError(409, 'The fund still has money. Return the leftover first, then change the holder.');
        }
        if (wanted.fund_holder_id !== null && !members.some((m) => m.id === wanted.fund_holder_id)) {
          throw new HttpError(400, 'The fund holder must be someone in this group.');
        }
      }
      if (wanted.deleted === 1 && summarizeGroup(members, expenses, payments).toSettle > 0) {
        throw new HttpError(409, 'Money is still to be settled. Settle up before deleting the group.');
      }
    }

    await saveWithSeqs(group._id, 1, async ([seq], session) => {
      await Group.updateOne(
        { _id: group._id },
        { $set: { ...wanted, updated_at: Date.now(), updated_by: req.member._id, seq } },
        { session }
      );
    });
  },

  // --- Member slots: add, rename, remove (never the account link) ---
  async members(req, row) {
    checkGroupId(row, req);
    checkDeletedFlag(row);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name.length === 0 || name.length > 50) throw new HttpError(400, 'The name must be 1 to 50 characters.');

    const existing = await Member.findById(row.id).lean();
    checkSameGroup(existing, req);
    const me = req.member;
    const now = Date.now();

    if (!existing) {
      // A new friend in the group. Anyone in the group may add one; an
      // account can only be linked to the slot later, through an invite.
      await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
        await Member.create(
          [
            {
              _id: row.id,
              group_id: req.group._id,
              name,
              account_id: null,
              username: null,
              role: 'member',
              created_at: createdAt(row, now),
              updated_at: now,
              deleted: row.deleted,
              created_by: me._id,
              updated_by: me._id,
              seq,
            },
          ],
          { session }
        );
      });
      return;
    }

    const renamed = name !== existing.name;
    const removing = row.deleted === 1 && existing.deleted === 0;
    const restoring = row.deleted === 0 && existing.deleted === 1;
    if (!renamed && !removing && !restoring) return;

    if (renamed && existing._id !== me._id) checkAdmin(me);
    if (removing || restoring) checkAdmin(me);
    if (removing) {
      if (existing.account_id) {
        throw new HttpError(409, `${existing.name} has an account in this group. Remove them from the group first.`);
      }
      if (req.group.fund_holder_id === existing._id) {
        throw new HttpError(409, `${existing.name} holds the group fund. Change the fund holder first.`);
      }
      const { members, expenses, payments } = await loadForSplit(req.group._id);
      if ((computeBalances(members, expenses, payments)[existing._id] || 0) !== 0) {
        throw new HttpError(409, `${existing.name} isn’t settled up yet. Settle up first.`);
      }
    }

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      await Member.updateOne(
        { _id: existing._id },
        { $set: { name, deleted: row.deleted, updated_at: now, updated_by: me._id, seq } },
        { session }
      );
    });
  },

  // --- Expenses: add, edit, delete, restore ---
  async expenses(req, row) {
    checkGroupId(row, req);
    checkDeletedFlag(row);
    const existing = await Expense.findById(row.id).lean();
    checkSameGroup(existing, req);
    const me = req.member;
    const now = Date.now();
    const live = await liveMemberIds(req.group._id);

    if (!existing) {
      // A new expense: anyone in the group, everyone in it a live member.
      const result = validateExpense(row, live);
      if (!result.ok) throw new HttpError(400, 'The expense has problems.', result.errors);
      await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
        await Expense.create(
          [
            {
              _id: row.id,
              group_id: req.group._id,
              ...result.data,
              created_at: createdAt(row, now),
              updated_at: now,
              deleted: row.deleted,
              created_by: me._id,
              updated_by: me._id,
              seq,
            },
          ],
          { session }
        );
      });
      return;
    }

    // Deleted on both sides: nothing to do (any edits to it don't matter).
    if (row.deleted === 1 && existing.deleted === 1) return;

    // Anything different from the server's copy?
    const sameFields =
      (row.description ?? '') === existing.description &&
      row.amount === existing.amount &&
      row.category === existing.category &&
      row.split_type === existing.split_type &&
      (row.from_fund ?? 0) === existing.from_fund &&
      sameList(row.payers, existing.payers, 'amount') &&
      sameList(row.participants, existing.participants, 'share');
    if (sameFields && row.deleted === existing.deleted) return;

    checkExpenseOwner(existing, me);

    let set;
    if (row.deleted === 1) {
      // Deleting: only the flag changes.
      set = { deleted: 1 };
    } else {
      // Editing (or restoring): check it like a new expense. People already
      // in this expense may stay even if they've since been removed from the
      // group — the app keeps them so old balances don't change.
      const allowed = new Set(live);
      for (const p of [...existing.payers, ...existing.participants]) allowed.add(p.member_id);
      const result = validateExpense(row, allowed);
      if (!result.ok) throw new HttpError(400, 'The expense has problems.', result.errors);
      set = { ...result.data, deleted: 0 };
      // A plain restore (the "Undo" after deleting) brings back the same
      // contents: that's not an edit (see edited_at in models.js).
      if (!sameFields) set.edited_at = now;
    }

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      await Expense.updateOne(
        { _id: existing._id },
        { $set: { ...set, updated_at: now, updated_by: me._id, seq } },
        { session }
      );
    });
  },

  // --- Payments: record one, or answer it (confirm / reject / cancel) ---
  async payments(req, row) {
    checkGroupId(row, req);
    checkDeletedFlag(row);
    const existing = await Payment.findById(row.id).lean();
    checkSameGroup(existing, req);
    const me = req.member;
    const now = Date.now();

    if (!existing) {
      const result = validatePayment(row, await liveMemberIds(req.group._id));
      if (!result.ok) throw new HttpError(400, 'The payment has problems.', result.errors);
      const payment = result.data;
      checkFundRules(payment, req.group);

      // The server decides the status (payer → pending, receiver →
      // confirmed), whatever the phone thought. One exception: the payer
      // may already have cancelled it before it was ever uploaded.
      let status = initialPaymentStatus(payment, me);
      if (row.status === 'cancelled' && status === 'pending') status = 'cancelled';

      await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
        await Payment.create(
          [
            {
              _id: row.id,
              group_id: req.group._id,
              ...payment,
              status,
              confirmed_at: status === 'confirmed' ? now : null,
              confirmed_by: status === 'confirmed' ? 'receiver' : null,
              created_at: createdAt(row, now),
              updated_at: now,
              deleted: row.deleted,
              created_by: me._id,
              updated_by: me._id,
              seq,
            },
          ],
          { session }
        );
      });
      return;
    }

    // Once recorded, a payment is never edited or deleted — the other
    // person must always see what happened. Only its status moves on.
    const sameFields =
      row.from_member_id === existing.from_member_id &&
      row.to_member_id === existing.to_member_id &&
      row.amount === existing.amount &&
      (row.type ?? 'settlement') === existing.type;
    if (!sameFields) throw new HttpError(409, 'A payment can’t be changed once it’s recorded.');
    if (row.deleted !== existing.deleted) {
      throw new HttpError(403, 'Payments can’t be deleted. Cancel or reject it instead.');
    }
    if (row.status === existing.status) return;

    const action = { confirmed: 'confirm', rejected: 'reject', cancelled: 'cancel' }[row.status];
    if (!action) throw new HttpError(409, `This payment is already ${existing.status}.`);
    const changes = await answerChanges(existing, action, me, now);

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      // status: 'pending' in the filter: if two answers race, the first wins.
      const { matchedCount } = await Payment.updateOne(
        { _id: existing._id, status: 'pending' },
        { $set: { ...changes, updated_at: now, updated_by: me._id, seq } },
        { session }
      );
      if (matchedCount === 0) throw new HttpError(409, 'This payment was answered already.');
    });
  },
};
