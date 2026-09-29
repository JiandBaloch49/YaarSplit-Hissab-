// split.js — all the bill-splitting math for Hisaab.
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
//   }
//   payment = { fromId, toId, amount }         // fromId paid toId back
//   balances = { [memberId]: rupees }  // + means they are owed money,
//                                      // - means they owe money
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
