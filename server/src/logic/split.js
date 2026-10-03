// split.js — all the bill-splitting math for YaarSplit.
//
// Every function here is PURE: it takes plain data in and returns plain data
// out. No database, no UI, no side effects. That makes the math easy to read
// and easy to test on its own.
//
// Money is always whole rupees (integers). We never use decimals, so there are
// no rounding surprises like 333.3333...
//
// Data shapes used below:
//   member  = { id, name }
//   expense = {
//     amount,                                  // total, whole rupees
//     category,                                // one of CATEGORIES
//     split_type,                              // 'equal' or 'custom'
//     payers:       [{ member_id, amount }],   // who paid, and how much
//     participants: [{ member_id, share }],    // who it was FOR, and their share
//     from_fund,                               // 1 = paid from the group fund
//   }
//   payment = { fromId, toId, amount, type, status }  // fromId gave toId money
//   balances = { [memberId]: rupees }  // + means they are owed money,
//                                      // - means they owe money
//
// Payment status (see PAYMENT_STATUSES): only CONFIRMED payments move money
// in balances, fund totals and debts. A pending payment is just "X says they
// paid" until the receiver confirms it.
//
// Group fund: friends give cash to one member (the fund holder), who pays
// expenses from it. This needs NO special balance maths:
//   - putting money in  = a payment from the giver to the holder
//   - a fund expense    = an expense paid by the holder
//   - returning leftover = a payment from the holder back to a member
// computeBalances treats all of these as ordinary payments/expenses. Only
// fundSummary() looks at the payment `type`, to track the cash in the fund.
//
// Note: payers and participants don't have to overlap. "A paid the mechanic
// for D's bike" is payers [A], participants [D].
//
// payers/participants use snake_case `member_id` because that is exactly how
// they are stored as JSON in the database — no renaming needed.

// Allowed values for expense.category.
export const CATEGORIES = ['food', 'tea', 'transport', 'repair', 'shopping', 'other'];

// Allowed values for expense.split_type.
//   equal  — the total is divided evenly with splitAmount()
//   custom — the user types an exact share for each person
export const SPLIT_TYPES = ['equal', 'custom'];

// Allowed values for payment.type.
//   settlement   — paying someone back (the normal "Mark as paid")
//   contribution — putting money into the group fund (giver → holder)
//   return       — the holder giving leftover fund money back (holder → member)
export const PAYMENT_TYPES = ['settlement', 'contribution', 'return'];

// Allowed values for payment.status.
//   pending   — the payer recorded it; waiting for the receiver
//   confirmed — the receiver (or an admin, if the receiver has no account)
//               said "yes, I got it". Only these count.
//   rejected  — the receiver said "I never got this"
//   cancelled — the payer took it back before it was confirmed
export const PAYMENT_STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];

/**
 * Does this payment count as money that really changed hands?
 * Only confirmed ones do.
 *
 * A payment with NO status at all also counts: those are rows saved on a
 * phone before payments had a status (the app gets the column in phase 6b).
 * The server always stores a status, so this never lets a pending payment
 * through there.
 */
export function isConfirmed(payment) {
  return (payment.status ?? 'confirmed') === 'confirmed';
}

// Helper: is this a whole number of rupees, 0 or more?
function isRupees(value) {
  return Number.isInteger(value) && value >= 0;
}

// Helper: add up one field across a list, e.g. sum(payers, 'amount').
function sum(list, field) {
  let total = 0;
  for (const item of list) total += item[field];
  return total;
}

// Helper: explain how far off a sum is, e.g. "50 short" or "50 too much".
function describeGap(got, expected) {
  const gap = got - expected;
  return gap < 0 ? `${-gap} short` : `${gap} too much`;
}

// Helper: find member ids that appear more than once in a list.
function findDuplicates(list) {
  const seen = new Set();
  const dupes = new Set();
  for (const item of list) {
    if (seen.has(item.member_id)) dupes.add(item.member_id);
    seen.add(item.member_id);
  }
  return [...dupes];
}

/**
 * Check a new/edited expense and fill in the shares, ready to save.
 *
 * Input (what the Add Expense screen collects):
 *   {
 *     amount, category, split_type,
 *     payers:       [{ member_id, amount }],
 *     participants: equal  → [{ member_id }]          (shares get calculated)
 *                   custom → [{ member_id, share }]   (shares typed by user,
 *                                                      each more than 0)
 *     A participant may also carry a `name`; it's only used to make error
 *     messages readable ("Remove Bilal or give them a share.").
 *   }
 *
 * Returns ONE of:
 *   { ok: true,  expense }   — valid; participants all have a `share` now
 *   { ok: false, errors }    — list of messages to show; do NOT save
 *
 * Other fields on the input (description, date, ...) are passed through.
 */
export function prepareExpense(input) {
  const errors = [];
  const { amount, category, split_type } = input;
  const payers = input.payers || [];
  const participants = input.participants || [];

  // --- Total ---
  // If the total itself is missing or wrong, checks that compare against it
  // (payer amounts, custom share sums) would only repeat the same problem in
  // a more confusing way — so those are skipped until the total is fixed.
  const totalOk = isRupees(amount) && amount > 0;
  if (!totalOk) {
    errors.push('Total must be a whole number of rupees, more than 0.');
  }

  // --- Category and split type ---
  if (!CATEGORIES.includes(category)) {
    errors.push(`Category must be one of: ${CATEGORIES.join(', ')}.`);
  }
  if (!SPLIT_TYPES.includes(split_type)) {
    errors.push(`Split type must be one of: ${SPLIT_TYPES.join(', ')}.`);
  }

  // --- Payers: at least one, whole rupees, adding up to the total ---
  // (Amount checks skipped when the total is bad: with one payer, their
  // amount IS the total, so it would just be the total error twice.)
  if (payers.length === 0) {
    errors.push('Pick at least one person who paid.');
  } else if (!totalOk) {
    // Already reported above.
  } else if (!payers.every((p) => isRupees(p.amount) && p.amount > 0)) {
    errors.push('Each payer amount must be a whole number of rupees, more than 0.');
  } else if (sum(payers, 'amount') !== amount) {
    const paid = sum(payers, 'amount');
    errors.push(
      `Payers add up to ${paid} but the total is ${amount} (${describeGap(paid, amount)}).`
    );
  }
  if (findDuplicates(payers).length > 0) {
    errors.push('The same person is listed as a payer more than once.');
  }

  // --- Participants: at least one, no duplicates ---
  if (participants.length === 0) {
    errors.push('Pick at least one person this expense is for.');
  }
  if (findDuplicates(participants).length > 0) {
    errors.push('The same person is listed more than once in the split.');
  }

  // --- Custom split: every share typed, more than 0, adding up to the total ---
  if (split_type === 'custom' && participants.length > 0) {
    // Someone with a 0 share didn't have anything, so they shouldn't be in
    // the split at all. Name each one so the user knows who to fix.
    const zeroShares = participants.filter((p) => p.share === 0);

    if (!participants.every((p) => isRupees(p.share))) {
      errors.push('Each share must be a whole number of rupees.');
    } else if (zeroShares.length > 0) {
      for (const p of zeroShares) {
        errors.push(`Remove ${p.name || p.member_id} or give them a share.`);
      }
    } else if (totalOk && sum(participants, 'share') !== amount) {
      const shared = sum(participants, 'share');
      errors.push(
        `Shares add up to ${shared} but the total is ${amount} (${describeGap(shared, amount)}).`
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // --- Valid: work out the final participant list with shares ---
  let finalParticipants;
  if (split_type === 'equal') {
    // Ignore any shares passed in and calculate them fresh.
    const shares = splitAmount(amount, participants.map((p) => p.member_id));
    finalParticipants = participants.map((p) => ({
      member_id: p.member_id,
      share: shares[p.member_id],
    }));
  } else {
    // Custom: keep exactly what the user typed.
    finalParticipants = participants.map((p) => ({
      member_id: p.member_id,
      share: p.share,
    }));
  }

  return {
    ok: true,
    expense: {
      ...input,
      payers: payers.map((p) => ({ member_id: p.member_id, amount: p.amount })),
      participants: finalParticipants,
    },
  };
}

/**
 * Split a whole-rupee amount among participants so the shares add up EXACTLY
 * to the amount.
 *
 * Example: splitAmount(1000, ['A', 'B', 'C']) → { A: 334, B: 333, C: 333 }
 *
 * How: everyone gets the rounded-down share (1000 / 3 → 333). That leaves a
 * few leftover rupees (1000 - 333*3 = 1). We hand those out one at a time to
 * the first people in the list.
 */
export function splitAmount(amount, participantIds) {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error('amount must be a whole number of rupees (0 or more)');
  }
  if (!participantIds || participantIds.length === 0) {
    throw new Error('need at least one participant to split between');
  }

  const count = participantIds.length;
  const baseShare = Math.floor(amount / count); // everyone gets at least this
  let leftover = amount - baseShare * count; // always less than count

  const shares = {};
  for (const id of participantIds) {
    // The first `leftover` people get one extra rupee each.
    if (leftover > 0) {
      shares[id] = baseShare + 1;
      leftover -= 1;
    } else {
      shares[id] = baseShare;
    }
  }
  return shares;
}

/**
 * Work out each member's balance from all expenses and payments.
 *
 * - For an expense: each payer gets +their amount (they fronted the money),
 *   and each participant gets -their share (it was spent on them).
 *   Shares are already stored on the expense (see prepareExpense), so no
 *   splitting happens here.
 * - For a payment from X to Y: X gets +amount (X paid off some debt), and
 *   Y gets -amount (Y received money, so is owed less).
 *   Only CONFIRMED payments count (see isConfirmed); pending, rejected and
 *   cancelled ones are skipped, so passing every payment is fine.
 *
 * The caller should pass only live rows (deleted = 0), with the payers and
 * participants JSON already parsed into arrays.
 * All balances together always add up to 0.
 */
export function computeBalances(members, expenses, payments) {
  // Start everyone at 0 so members with no activity still show up.
  const balances = {};
  for (const member of members) {
    balances[member.id] = 0;
  }

  // Small helper so a missing id doesn't produce NaN.
  function add(id, rupees) {
    balances[id] = (balances[id] || 0) + rupees;
  }

  for (const expense of expenses) {
    for (const payer of expense.payers) {
      add(payer.member_id, payer.amount);
    }
    for (const participant of expense.participants) {
      add(participant.member_id, -participant.share);
    }
  }

  for (const payment of payments) {
    if (!isConfirmed(payment)) continue; // not real (yet)
    add(payment.fromId, payment.amount);
    add(payment.toId, -payment.amount);
  }

  return balances;
}

/**
 * Turn balances into a short list of "who pays whom" transfers.
 *
 * Greedy method: repeatedly take the person who owes the most (biggest
 * debtor) and the person owed the most (biggest creditor). The debtor pays the
 * creditor as much as possible (the smaller of the two amounts). One of them
 * is now settled; repeat until everyone is at 0.
 *
 * Returns: [{ fromId, toId, amount }, ...]
 * Input is not modified.
 */
export function settleUp(balances) {
  // Work on a copy so we don't change the caller's object.
  const remaining = { ...balances };
  const transfers = [];

  while (true) {
    const ids = Object.keys(remaining);

    // Biggest debtor = most negative balance.
    // Biggest creditor = most positive balance.
    // Ties are broken by id so the result is always the same.
    let debtorId = null;
    let creditorId = null;
    for (const id of ids) {
      const value = remaining[id];
      if (value < 0) {
        if (
          debtorId === null ||
          value < remaining[debtorId] ||
          (value === remaining[debtorId] && id < debtorId)
        ) {
          debtorId = id;
        }
      } else if (value > 0) {
        if (
          creditorId === null ||
          value > remaining[creditorId] ||
          (value === remaining[creditorId] && id < creditorId)
        ) {
          creditorId = id;
        }
      }
    }

    // Nobody owes or nobody is owed → we're done.
    if (debtorId === null || creditorId === null) break;

    const amount = Math.min(-remaining[debtorId], remaining[creditorId]);
    transfers.push({ fromId: debtorId, toId: creditorId, amount });

    remaining[debtorId] += amount; // debtor owes less now
    remaining[creditorId] -= amount; // creditor is owed less now
  }

  return transfers;
}

/**
 * Who owes whom because of ONE expense, as [{ fromId, toId, amount }].
 *
 * We treat the expense as a tiny group of its own: payers +amount,
 * participants -share, then settle it with settleUp(). With one payer (the
 * usual case) that is simply "every other participant owes the payer their
 * share". With several payers, settleUp decides who pays back which payer,
 * always the same way, in whole rupees.
 */
function expenseDebts(expense) {
  const net = {};
  for (const payer of expense.payers) {
    net[payer.member_id] = (net[payer.member_id] || 0) + payer.amount;
  }
  for (const participant of expense.participants) {
    net[participant.member_id] = (net[participant.member_id] || 0) - participant.share;
  }
  return settleUp(net);
}

/**
 * Pairwise debts: each person pays back exactly the people they owe, with
 * no "simplifying". Used when a group turns simplify_debts off.
 *
 * Example: A paid 300 for A, B, C and B paid 300 for A, B, C.
 *   settleUp (simplified)  → C pays A 100, C pays B 100
 *   pairwiseDebts          → C pays A 100, C pays B 100 (A and B cancel out)
 * But: A paid 200 for B, and B paid 200 for C.
 *   settleUp (simplified)  → C pays A 200 (B is skipped entirely)
 *   pairwiseDebts          → B pays A 200, C pays B 200
 *
 * How:
 *   1. Every expense becomes debts between people (see expenseDebts).
 *   2. A confirmed payment X → Y cancels that much of X's debt to Y. (If X
 *      didn't owe Y that much, Y now owes X the difference.)
 *   3. For each pair, debts in both directions cancel: if A owes B 300 and
 *      B owes A 100, the answer is "A pays B 200".
 *
 * The total each person pays/receives is the same as in settleUp — only
 * WHO pays WHOM differs — so either list settles everyone to exactly 0.
 *
 * Same inputs as computeBalances (live rows; any payment status is fine,
 * only confirmed ones count).
 * Returns [{ fromId, toId, amount }], sorted by fromId then toId.
 */
export function pairwiseDebts(expenses, payments) {
  // net[lo][hi] = how much `lo` owes `hi`, where lo < hi (ids compared as
  // text). A negative number means `hi` owes `lo`. Keeping each pair under
  // one key is what makes the two directions cancel out.
  const net = {};
  function addDebt(fromId, toId, amount) {
    if (fromId === toId) return; // owing yourself means nothing
    const [lo, hi, sign] = fromId < toId ? [fromId, toId, 1] : [toId, fromId, -1];
    net[lo] = net[lo] || {};
    net[lo][hi] = (net[lo][hi] || 0) + sign * amount;
  }

  for (const expense of expenses) {
    for (const debt of expenseDebts(expense)) addDebt(debt.fromId, debt.toId, debt.amount);
  }
  for (const payment of payments) {
    if (!isConfirmed(payment)) continue;
    // X paid Y: the same as Y now owing X that much, which cancels X's debt.
    addDebt(payment.toId, payment.fromId, payment.amount);
  }

  const transfers = [];
  for (const lo of Object.keys(net)) {
    for (const hi of Object.keys(net[lo])) {
      const value = net[lo][hi];
      if (value > 0) transfers.push({ fromId: lo, toId: hi, amount: value });
      if (value < 0) transfers.push({ fromId: hi, toId: lo, amount: -value });
    }
  }
  transfers.sort((x, y) =>
    x.fromId === y.fromId ? (x.toId < y.toId ? -1 : 1) : x.fromId < y.fromId ? -1 : 1
  );
  return transfers;
}

/**
 * The history between two members: every expense and payment involving both
 * of them, oldest first (by created_at), with what is still owed after each.
 *
 *   aId, bId   the two members
 *   expenses   live expenses (any; the ones without both people are skipped)
 *   payments   live payments, any status (only confirmed ones move money)
 *
 * Returns a list of steps:
 *   {
 *     kind,       'expense' or 'payment'
 *     id, created_at,
 *     item,       the expense or payment itself
 *     change,     how much this step adds to what bId owes aId
 *                 (negative = it reduces it, or makes aId owe bId)
 *     remaining,  what bId owes aId AFTER this step
 *                 (negative = aId owes bId that much; 0 = even)
 *   }
 *
 * An expense counts as "involving both" when both appear in it as payer or
 * participant — its change can still be 0 (e.g. both ate, someone else
 * paid). Pending, rejected and cancelled payments between them are listed
 * too, with change 0, so the history shows them.
 *
 * The amounts come from the same per-expense debts as pairwiseDebts, so the
 * last `remaining` always matches the pairwise debt between the two.
 */
export function historyBetween(aId, bId, expenses, payments) {
  const steps = [];

  for (const expense of expenses) {
    const ids = [...expense.payers, ...expense.participants].map((p) => p.member_id);
    if (!ids.includes(aId) || !ids.includes(bId)) continue;

    // Of everything this expense creates, only debts between a and b matter.
    let change = 0;
    for (const debt of expenseDebts(expense)) {
      if (debt.fromId === bId && debt.toId === aId) change += debt.amount;
      if (debt.fromId === aId && debt.toId === bId) change -= debt.amount;
    }
    steps.push({ kind: 'expense', item: expense, change });
  }

  for (const payment of payments) {
    const between =
      (payment.fromId === aId && payment.toId === bId) ||
      (payment.fromId === bId && payment.toId === aId);
    if (!between) continue;

    let change = 0;
    if (isConfirmed(payment)) {
      // b paid a → b owes a less. a paid b → b owes a more (or a owed b).
      change = payment.fromId === bId ? -payment.amount : payment.amount;
    }
    steps.push({ kind: 'payment', item: payment, change });
  }

  // Oldest first. Array sort is stable, so equal times keep the order above
  // (expenses before payments).
  steps.sort((x, y) => x.item.created_at - y.item.created_at);

  let remaining = 0;
  return steps.map(({ kind, item, change }) => {
    remaining += change;
    return { kind, id: item.id, created_at: item.created_at, item, change, remaining };
  });
}

/**
 * Short summary of a group for the Groups list:
 *   { memberCount, totalSpent, toSettle }
 *
 * - totalSpent: all expenses added up (payments aren't spending, so they
 *   don't count).
 * - toSettle: how much money still has to change hands for everyone to be
 *   even. That's the total of everyone who is owed money (positive
 *   balances) — which always equals the total of everyone who owes.
 *   0 means the group is settled up.
 *
 * Same inputs as computeBalances: live rows, JSON already parsed.
 */
export function summarizeGroup(members, expenses, payments) {
  let totalSpent = 0;
  for (const expense of expenses) totalSpent += expense.amount;

  const balances = computeBalances(members, expenses, payments);
  let toSettle = 0;
  for (const balance of Object.values(balances)) {
    if (balance > 0) toSettle += balance;
  }

  return { memberCount: members.length, totalSpent, toSettle };
}

/**
 * How much of an expense the fund can cover, and how much the holder has to
 * pay from their own pocket.
 *
 *   coverFromFund(1000, 1500) → { fromFund: 1000, extra: 500 }
 *   coverFromFund(1000, 300)  → { fromFund: 300,  extra: 0 }
 *   coverFromFund(0, 700)     → { fromFund: 0,    extra: 700 }
 */
export function coverFromFund(left, amount) {
  const fromFund = Math.min(amount, Math.max(left, 0));
  return { fromFund, extra: amount - fromFund };
}

/**
 * Everything about the group fund, worked out from the money going in and
 * out, in the order it happened (by created_at).
 *
 *   group     { fund_holder_id }   (null/undefined = no fund)
 *   expenses  live expenses; the ones with from_fund = 1 spend from the fund
 *   payments  live payments; 'contribution' adds to the fund, 'return' takes
 *             leftover back out. 'settlement' payments are ignored here, and
 *             so are payments that aren't confirmed.
 *
 * Returns:
 *   {
 *     holderId,        who holds the cash now
 *     totalIn,         all money put in
 *     totalSpent,      money spent FROM THE FUND (never more than was in it)
 *     totalReturned,   leftover given back
 *     holderExtra,     what holders paid from their own pocket when a fund
 *                      expense was bigger than what was left
 *     left,            cash still in the fund, with the holder
 *     contributions,   { [memberId]: rupees put in }
 *     history,         one entry per event, oldest first:
 *                      { kind: 'in' | 'out' | 'return', id, created_at,
 *                        memberId, amount, fromFund, extra, left, expense }
 *                      `left` is the running amount after that event.
 *   }
 *
 * Why an expense can be bigger than the fund: if the fund runs out, the
 * holder pays the rest themselves. The expense is still saved as paid by the
 * holder for the full amount, so balances stay right — this function just
 * splits it into "from the fund" and "extra".
 */
export function fundSummary(group, expenses, payments) {
  // Collect every fund event, then put them in time order.
  const events = [];
  for (const payment of payments) {
    // Like computeBalances: money only counts once the receiver confirmed it.
    if (!isConfirmed(payment)) continue;
    if (payment.type === 'contribution' || payment.type === 'return') {
      events.push({ kind: payment.type === 'contribution' ? 'in' : 'return', item: payment });
    }
  }
  for (const expense of expenses) {
    if (expense.from_fund) events.push({ kind: 'out', item: expense });
  }
  // Array sort is stable, so events with the same time keep their order.
  events.sort((a, b) => a.item.created_at - b.item.created_at);

  let left = 0;
  let totalIn = 0;
  let totalSpent = 0;
  let totalReturned = 0;
  let holderExtra = 0;
  const contributions = {};
  const history = [];

  for (const { kind, item } of events) {
    const entry = { kind, id: item.id, created_at: item.created_at, amount: item.amount };

    if (kind === 'in') {
      // Money in: from the giver, to the holder.
      left += item.amount;
      totalIn += item.amount;
      contributions[item.fromId] = (contributions[item.fromId] || 0) + item.amount;
      entry.memberId = item.fromId;
    } else if (kind === 'return') {
      // Leftover out: from the holder, back to a member.
      left -= item.amount;
      totalReturned += item.amount;
      entry.memberId = item.toId;
    } else {
      // A fund expense: the fund pays what it can, the holder the rest.
      const { fromFund, extra } = coverFromFund(left, item.amount);
      left -= fromFund;
      totalSpent += fromFund;
      holderExtra += extra;
      entry.memberId = item.payers[0]?.member_id; // the holder who paid
      entry.fromFund = fromFund;
      entry.extra = extra;
      entry.expense = item;
    }

    entry.left = left;
    history.push(entry);
  }

  return {
    holderId: group.fund_holder_id || null,
    totalIn,
    totalSpent,
    totalReturned,
    holderExtra,
    left,
    contributions,
    history,
  };
}

/**
 * Suggest how the holder should hand back the money left in the fund, based
 * on balances.
 *
 * People who are owed money (positive balance) get paid back first, biggest
 * first, each up to what they're owed. Whatever is left after that is the
 * holder's own money, so the holder keeps it (a "return" to themselves).
 *
 *   left 1000, holder A, balances { A: -750, B: 250, C: 250, D: 250 }
 *   → [{ toId: 'B', amount: 250 }, { toId: 'C', amount: 250 },
 *      { toId: 'D', amount: 250 }, { toId: 'A', amount: 250 }]
 *
 * Returns [{ toId, amount }]. Every return comes from the holder.
 */
export function suggestReturns(left, holderId, balances) {
  const returns = [];
  let remaining = left;

  // Everyone owed money except the holder, biggest first (ties by id, so the
  // result is always the same).
  const owed = Object.keys(balances)
    .filter((id) => id !== holderId && balances[id] > 0)
    .sort((a, b) => balances[b] - balances[a] || (a < b ? -1 : 1));

  for (const id of owed) {
    if (remaining <= 0) break;
    const amount = Math.min(balances[id], remaining);
    returns.push({ toId: id, amount });
    remaining -= amount;
  }

  // The rest belongs to the holder.
  if (remaining > 0) returns.push({ toId: holderId, amount: remaining });
  return returns;
}
