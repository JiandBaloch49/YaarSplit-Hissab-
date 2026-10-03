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

import express from 'express';
import { Member, Payment, toApp } from '../models.js';
import { saveWithSeqs } from '../seq.js';
import { requireAccount, requireMember } from '../auth.js';
import { isId, isTimestamp, validatePayment } from '../validate.js';
import { liveMemberIds } from '../groupData.js';
import { HttpError } from '../errors.js';

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

    // You can only record money YOU gave or YOU got.
    const isPayer = payment.from_member_id === req.member._id;
    const isReceiver = payment.to_member_id === req.member._id;
    if (!isPayer && !isReceiver) {
      throw new HttpError(403, 'You can only record a payment you made or received.');
    }
    if (await Payment.exists({ _id: id })) throw new HttpError(409, 'This payment was already added.');

    const now = Date.now();
    const doc = {
      _id: id,
      group_id: req.group._id,
      ...payment,
      // The receiver saying "X paid me" needs nobody else's word.
      status: isReceiver ? 'confirmed' : 'pending',
      confirmed_at: isReceiver ? now : null,
      confirmed_by: isReceiver ? 'receiver' : null,
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
      if (payment.status !== 'pending') {
        throw new HttpError(409, `This payment is already ${payment.status}.`);
      }

      const now = Date.now();
      let changes;
      if (action === 'cancel') {
        if (payment.from_member_id !== req.member._id) {
          throw new HttpError(403, 'Only the person who paid can cancel this payment.');
        }
        changes = { status: 'cancelled' };
      } else {
        const by = await whoMayAnswer(payment, req.member);
        changes =
          action === 'confirm'
            ? { status: 'confirmed', confirmed_at: now, confirmed_by: by }
            : { status: 'rejected' };
      }

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

/**
 * May `me` confirm or reject this payment? Returns how they'd confirm it:
 *   'receiver' — I am the receiver
 *   'admin'    — the receiver has no account, and I'm an admin
 * Otherwise throws 403.
 */
async function whoMayAnswer(payment, me) {
  const receiver = await Member.findOne({ _id: payment.to_member_id, group_id: payment.group_id }).lean();
  const receiverHasAccount = Boolean(receiver && receiver.deleted === 0 && receiver.account_id);

  if (receiverHasAccount) {
    if (receiver._id === me._id) return 'receiver';
    throw new HttpError(403, `Only ${receiver.name} can confirm or reject a payment to them.`);
  }
  if (me.role === 'admin') return 'admin';
  throw new HttpError(403, 'The receiver has no account yet, so only an admin can confirm or reject this.');
}

/**
 * The same payment rules the app's addPayment() has (src/db/queries.js):
 *   settlement   — can't pay yourself
 *   contribution — must go TO the fund holder
 *   return       — must come FROM the fund holder
 */
function checkFundRules(payment, group) {
  const { type, from_member_id: fromId, to_member_id: toId } = payment;
  if (type === 'settlement') {
    if (fromId === toId) throw new HttpError(400, 'Someone can’t pay themselves.');
    return;
  }
  const holderId = group.fund_holder_id;
  if (!holderId) throw new HttpError(400, 'This group has no fund.');
  if (type === 'contribution' && toId !== holderId) {
    throw new HttpError(400, 'Money for the fund must go to the fund holder.');
  }
  if (type === 'return' && fromId !== holderId) {
    throw new HttpError(400, 'Only the fund holder can hand back fund money.');
  }
}
