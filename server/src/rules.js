// rules.js — "who may change what", shared by the routes.
//
// The same rule must give the same answer whether a change arrives through
// its own endpoint (e.g. POST .../payments/:id/confirm) or through a
// phone's sync push (routes/push.js). So each rule lives here once, and
// both places call it. Every function either returns quietly (allowed) or
// throws an HttpError explaining why not.

import { Member } from './models.js';
import { HttpError } from './errors.js';

/**
 * Only the person who added an expense, or an admin, can edit or delete it.
 * `me` is the caller's member document (req.member).
 */
export function checkExpenseOwner(expense, me) {
  if (expense.created_by !== me._id && me.role !== 'admin') {
    throw new HttpError(403, 'Only the person who added this expense, or an admin, can change it.');
  }
}

/**
 * The same payment rules the app's addPayment() has (src/db/queries.js):
 *   settlement   — can't pay yourself
 *   contribution — must go TO the fund holder
 *   return       — must come FROM the fund holder
 */
export function checkFundRules(payment, group) {
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

/**
 * You can only record money YOU gave or YOU got. Returns the status a new
 * payment starts with:
 *   the receiver records it ("X paid me")  → 'confirmed' at once
 *   the payer records it ("I paid X")      → 'pending'
 */
export function initialPaymentStatus(payment, me) {
  if (payment.to_member_id === me._id) return 'confirmed';
  if (payment.from_member_id === me._id) return 'pending';
  throw new HttpError(403, 'You can only record a payment you made or received.');
}

/**
 * May `me` confirm or reject this payment? Returns how they'd confirm it:
 *   'receiver' — I am the receiver
 *   'admin'    — the receiver has no account, and I'm an admin
 * Otherwise throws 403.
 */
export async function whoMayAnswer(payment, me) {
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
 * Check one answer to a pending payment and return the fields to save.
 *   action 'confirm' / 'reject' — the receiver (or an admin, see whoMayAnswer)
 *   action 'cancel'             — only the payer
 * Only pending payments can be answered (409 otherwise).
 */
export async function answerChanges(payment, action, me, now) {
  if (payment.status !== 'pending') {
    throw new HttpError(409, `This payment is already ${payment.status}.`);
  }
  if (action === 'cancel') {
    if (payment.from_member_id !== me._id) {
      throw new HttpError(403, 'Only the person who paid can cancel this payment.');
    }
    return { status: 'cancelled' };
  }
  const by = await whoMayAnswer(payment, me);
  return action === 'confirm'
    ? { status: 'confirmed', confirmed_at: now, confirmed_by: by }
    : { status: 'rejected' };
}

/** Group settings (name, fund holder, deleting it...) are for admins only. */
export function checkAdmin(me) {
  if (me.role !== 'admin') throw new HttpError(403, 'Only a group admin can do that.');
}
