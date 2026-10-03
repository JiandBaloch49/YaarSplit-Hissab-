// groupData.js — small read helpers several routes share.

import { Expense, Member, Payment, toApp, toSplitPayment } from './models.js';

/** The ids of a group's LIVE members, as a Set. */
export async function liveMemberIds(groupId) {
  const members = await Member.find({ group_id: groupId, deleted: 0 }, { _id: 1 }).lean();
  return new Set(members.map((m) => m._id));
}

/**
 * A group's live members, expenses and payments, in the shapes split.js
 * expects — ready for computeBalances, settleUp, pairwiseDebts and
 * historyBetween. Payments of EVERY status are included: those functions
 * only count the confirmed ones, and the history lists the rest too.
 */
export async function loadForSplit(groupId) {
  const live = { group_id: groupId, deleted: 0 };
  const [members, expenses, payments] = await Promise.all([
    Member.find(live).sort({ created_at: 1 }).lean(),
    Expense.find(live).sort({ created_at: 1 }).lean(),
    Payment.find(live).sort({ created_at: 1 }).lean(),
  ]);
  return {
    members: members.map(toApp),
    expenses: expenses.map(toApp),
    payments: payments.map(toSplitPayment),
  };
}
