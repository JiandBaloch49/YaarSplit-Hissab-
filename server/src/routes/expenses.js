// routes/expenses.js — adding, editing and deleting expenses.
//
//   POST   /groups/:groupId/expenses              (member) add one
//   PUT    /groups/:groupId/expenses/:expenseId   (creator or admin) edit
//   DELETE /groups/:groupId/expenses/:expenseId   (creator or admin) soft delete
//
// Any member can add an expense. Only the person who created it, or an
// admin, can change or delete it. Every change records updated_by, and goes
// through saveWithSeqs so other phones pull it.

import express from 'express';
import { Expense, toApp } from '../models.js';
import { saveWithSeqs } from '../seq.js';
import { requireAccount, requireMember } from '../auth.js';
import { isId, isTimestamp, validateExpense } from '../validate.js';
import { liveMemberIds } from '../groupData.js';
import { HttpError } from '../errors.js';

export function expenseRoutes() {
  const router = express.Router();
  const member = [requireAccount, requireMember];

  // --- POST /groups/:groupId/expenses ---
  // Body: { id, description, amount, category, split_type, payers,
  //         participants, from_fund, created_at? }
  // `id` is the UUID the phone gave it (offline-first: the phone saves it
  // locally first). created_at defaults to now.
  // Reply 201: { expense }
  router.post('/groups/:groupId/expenses', member, async (req, res) => {
    const id = req.body?.id;
    if (!isId(id)) throw new HttpError(400, 'id is missing.');
    const result = validateExpense(req.body, await liveMemberIds(req.group._id));
    if (!result.ok) throw new HttpError(400, 'The expense has problems.', result.errors);
    if (await Expense.exists({ _id: id })) throw new HttpError(409, 'This expense was already added.');

    const now = Date.now();
    const doc = {
      _id: id,
      group_id: req.group._id,
      ...result.data,
      created_at: isTimestamp(req.body.created_at) ? req.body.created_at : now,
      updated_at: now,
      deleted: 0,
      created_by: req.member._id,
      updated_by: req.member._id,
    };
    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      await Expense.create([{ ...doc, seq }], { session });
    });

    res.status(201).json({ expense: toApp(await Expense.findById(id).lean()) });
  });

  // --- PUT /groups/:groupId/expenses/:expenseId  (creator or admin) ---
  // Body: the same fields as POST (without id/created_at). The whole
  // expense is checked again, exactly like a new one.
  // Reply: { expense }
  router.put('/groups/:groupId/expenses/:expenseId', member, async (req, res) => {
    const expense = await loadChangeableExpense(req);
    const result = validateExpense(req.body, await liveMemberIds(req.group._id));
    if (!result.ok) throw new HttpError(400, 'The expense has problems.', result.errors);

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      const { matchedCount } = await Expense.updateOne(
        { _id: expense._id, deleted: 0 }, // not if it was deleted meanwhile
        { $set: { ...result.data, updated_at: Date.now(), updated_by: req.member._id, seq } },
        { session }
      );
      if (matchedCount === 0) throw new HttpError(404, 'That expense was deleted.');
    });

    res.json({ expense: toApp(await Expense.findById(expense._id).lean()) });
  });

  // --- DELETE /groups/:groupId/expenses/:expenseId  (creator or admin) ---
  // A SOFT delete: deleted = 1 with a new seq, so the deletion reaches every
  // phone. Nothing is really removed.
  // Reply: { expense }
  router.delete('/groups/:groupId/expenses/:expenseId', member, async (req, res) => {
    const expense = await loadChangeableExpense(req);

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      const { matchedCount } = await Expense.updateOne(
        { _id: expense._id, deleted: 0 },
        { $set: { deleted: 1, updated_at: Date.now(), updated_by: req.member._id, seq } },
        { session }
      );
      if (matchedCount === 0) throw new HttpError(404, 'That expense was already deleted.');
    });

    res.json({ expense: toApp(await Expense.findById(expense._id).lean()) });
  });

  return router;
}

/**
 * The live expense in the URL, if the caller may change it:
 * they created it, or they're an admin. Otherwise 404 / 403.
 */
async function loadChangeableExpense(req) {
  const expense = await Expense.findOne({
    _id: req.params.expenseId,
    group_id: req.group._id,
    deleted: 0,
  }).lean();
  if (!expense) throw new HttpError(404, 'No such expense in this group.');

  const isCreator = expense.created_by === req.member._id;
  if (!isCreator && req.member.role !== 'admin') {
    throw new HttpError(403, 'Only the person who added this expense, or an admin, can change it.');
  }
  return expense;
}
