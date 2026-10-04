// routes/payments.js — recording payments, and confirming them.
//
//   POST /groups/:groupId/payments                       (payer or receiver) record one
//   POST /groups/:groupId/payments/:paymentId/confirm    (receiver; admin if no account)
//   POST /groups/:groupId/payments/:paymentId/reject     (receiver; admin if no account)
//   POST /groups/:groupId/payments/:paymentId/cancel     (payer)
//
// The rules (see PAYMENT_STATUSES in split.js):
//   - The payer records "I paid X" → pending. It doesn't count yet.
//   - The receiver records "X paid me" → confirmed at once (they're the one
//     who'd have to confirm it anyway).
//   - Only the receiver (the to_member's account) can confirm or reject.
//     Not even an admin can confirm for a receiver who has an account.
//   - If the receiver has NO account yet, nobody can speak for them, so an
//     admin can confirm or reject instead: saved as confirmed_by 'admin'.
//   - Only the payer can cancel.
//   - Only pending payments can be confirmed, rejected or cancelled.
//   - Any amount above 0 is fine (partial payments).
// Only confirmed payments count in balances (computeBalances in split.js).
// The rules themselves live in rules.js (phones' sync pushes use them too).

import express from 'express';
import { Payment, toApp } from '../models.js';
import { saveWithSeqs } from '../seq.js';
import { requireAccount, requireMember } from '../auth.js';
import { isId, isTimestamp, validatePayment } from '../validate.js';
import { liveMemberIds } from '../groupData.js';
import { HttpError } from '../errors.js';
import { answerChanges, checkFundRules, initialPaymentStatus } from '../rules.js';

export function paymentRoutes() {
  const router = express.Router();
  const member = [requireAccount, requireMember];

  // --- POST /groups/:groupId/payments ---
  // Body: { id, from_member_id, to_member_id, amount, type?, created_at? }
  // `id` is the phone's UUID. type defaults to 'settlement'.
  // Reply 201: { payment }  — status 'pending', or 'confirmed' if the
  //                           receiver recorded it.
  router.post('/groups/:groupId/payments', member, async (req, res) => {
    const id = req.body?.id;
    if (!isId(id)) throw new HttpError(400, 'id is missing.');
    const result = validatePayment(req.body, await liveMemberIds(req.group._id));
    if (!result.ok) throw new HttpError(400, 'The payment has problems.', result.errors);
    const payment = result.data;
    checkFundRules(payment, req.group);

    // You can only record money YOU gave or YOU got. The receiver saying
    // "X paid me" needs nobody else's word, so it's confirmed at once.
    const status = initialPaymentStatus(payment, req.member);
    if (await Payment.exists({ _id: id })) throw new HttpError(409, 'This payment was already added.');

    const now = Date.now();
    const doc = {
      _id: id,
      group_id: req.group._id,
      ...payment,
      status,
      confirmed_at: status === 'confirmed' ? now : null,
      confirmed_by: status === 'confirmed' ? 'receiver' : null,
      created_at: isTimestamp(req.body.created_at) ? req.body.created_at : now,
      updated_at: now,
      deleted: 0,
      created_by: req.member._id,
      updated_by: req.member._id,
    };
    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      await Payment.create([{ ...doc, seq }], { session });
    });

    res.status(201).json({ payment: toApp(await Payment.findById(id).lean()) });
  });

  // --- confirm / reject / cancel ---
  // Reply: { payment }
  //   403 not allowed (see the rules at the top), 404 no such payment,
  //   409 it isn't pending any more.
  for (const action of ['confirm', 'reject', 'cancel']) {
    router.post(`/groups/:groupId/payments/:paymentId/${action}`, member, async (req, res) => {
      const payment = await Payment.findOne({
        _id: req.params.paymentId,
        group_id: req.group._id,
        deleted: 0,
      }).lean();
      if (!payment) throw new HttpError(404, 'No such payment in this group.');

      // Pending? Allowed for me? (See answerChanges in rules.js.)
      const now = Date.now();
      const changes = await answerChanges(payment, action, req.member, now);

      await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
        // status: 'pending' in the filter: if two answers race (say the payer
        // cancels while the receiver confirms), only the first one wins.
        const { matchedCount } = await Payment.updateOne(
          { _id: payment._id, status: 'pending', deleted: 0 },
          { $set: { ...changes, updated_at: now, updated_by: req.member._id, seq } },
          { session }
        );
        if (matchedCount === 0) throw new HttpError(409, 'This payment was answered already.');
      });

      res.json({ payment: toApp(await Payment.findById(payment._id).lean()) });
    });
  }

  return router;
}
