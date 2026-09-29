// split.test.js — tests for the pure bill-splitting math in src/logic/split.js.
//
// Uses Node's built-in test runner, so there's nothing to install.
// Run with:  npm test
//
// Each test builds expenses the same way the app will: through
// prepareExpense(), which checks the input and fills in the shares.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitAmount,
  prepareExpense,
  computeBalances,
  settleUp,
  summarizeGroup,
} from '../src/logic/split.js';

const members = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: id }));

// --- Helpers to keep the test cases short ---

// Build a valid expense, or fail the test with the error messages.
function expense(input) {
  const result = prepareExpense(input);
  assert.ok(result.ok, `expected a valid expense, got: ${JSON.stringify(result.errors)}`);
  return result.expense;
}

// Equal split: payers is { A: 600 }, forIds is ['A', 'B', 'C'].
function equal(amount, payers, forIds) {
  return expense({
    amount,
    category: 'food',
    split_type: 'equal',
    payers: Object.entries(payers).map(([member_id, amt]) => ({ member_id, amount: amt })),
    participants: forIds.map((member_id) => ({ member_id })),
  });
}

// Apply transfers to balances; everyone should end up at exactly 0.
function assertSettlesToZero(balances, transfers) {
  const left = { ...balances };
  for (const t of transfers) {
    assert.ok(t.amount > 0, 'transfer amounts must be positive');
    left[t.fromId] += t.amount;
    left[t.toId] -= t.amount;
  }
  for (const id of Object.keys(left)) {
    assert.equal(left[id], 0, `${id} is not settled`);
  }
}

// Transfers as sorted strings like "C->A 500", so order doesn't matter.
function transferList(transfers) {
  return transfers.map((t) => `${t.fromId}->${t.toId} ${t.amount}`).sort();
}

// The first case we ran: 3 meals with different people at each.
function threeMeals() {
  return [
    equal(600, { A: 600 }, ['A', 'B', 'C']),
    equal(800, { B: 800 }, ['A', 'B', 'C', 'D']),
    equal(300, { C: 300 }, ['C', 'D']),
  ];
}

// --- splitAmount ---

test('splitAmount: 1000 among 3 gives 334, 333, 333', () => {
  assert.deepEqual(splitAmount(1000, ['A', 'B', 'C']), { A: 334, B: 333, C: 333 });
});

// --- The original three-meal case ---

test('three meals: balances', () => {
  assert.deepEqual(computeBalances(members, threeMeals(), []), {
    A: 200, B: 400, C: -250, D: -350,
  });
});

test('three meals: settleUp', () => {
  const balances = computeBalances(members, threeMeals(), []);
  const transfers = settleUp(balances);
  assert.deepEqual(transferList(transfers), ['C->A 200', 'C->B 50', 'D->B 350']);
  assertSettlesToZero(balances, transfers);
});

test('payment: D paid B 350 reduces both balances', () => {
  const payments = [{ fromId: 'D', toId: 'B', amount: 350 }];
  const balances = computeBalances(members, threeMeals(), payments);
  // Before the payment: B +400, D -350.
  assert.deepEqual(balances, { A: 200, B: 50, C: -250, D: 0 });
  assertSettlesToZero(balances, settleUp(balances));
});

// --- Expense model cases ---

test('A paid 500 for D only', () => {
  const e = equal(500, { A: 500 }, ['D']);
  assert.deepEqual(computeBalances(members, [e], []), { A: 500, B: 0, C: 0, D: -500 });
});

test('dinner 2000, A paid 1200 + B paid 800, equal among A,B,C,D', () => {
  const e = equal(2000, { A: 1200, B: 800 }, ['A', 'B', 'C', 'D']);
  // Equal shares are calculated and stored when saving.
  assert.deepEqual(
    e.participants.map((p) => p.share),
    [500, 500, 500, 500]
  );
  assert.deepEqual(computeBalances(members, [e], []), { A: 700, B: 300, C: -500, D: -500 });
});

test('dinner: settleUp settles everyone to 0', () => {
  const e = equal(2000, { A: 1200, B: 800 }, ['A', 'B', 'C', 'D']);
  const balances = computeBalances(members, [e], []);
  const transfers = settleUp(balances);
  assert.deepEqual(transferList(transfers), ['C->A 500', 'D->A 200', 'D->B 300']);
  assertSettlesToZero(balances, transfers);
});

test('lunch 1200 paid by C, custom split A 500, B 350, C 350', () => {
  const e = expense({
    amount: 1200,
    category: 'food',
    split_type: 'custom',
    payers: [{ member_id: 'C', amount: 1200 }],
    participants: [
      { member_id: 'A', share: 500 },
      { member_id: 'B', share: 350 },
      { member_id: 'C', share: 350 },
    ],
  });
  assert.deepEqual(computeBalances(members, [e], []), { A: -500, B: -350, C: 850, D: 0 });
});

test('names are not saved in payers/participants (they live in members)', () => {
  for (const split_type of ['equal', 'custom']) {
    const e = expense({
      amount: 1000,
      category: 'food',
      split_type,
      payers: [{ member_id: 'A', name: 'Ali', amount: 1000 }],
      participants: [
        { member_id: 'A', name: 'Ali', share: 500 },
        { member_id: 'B', name: 'Bilal', share: 500 },
      ],
    });
    // Only these exact keys may be stored in the JSON columns.
    for (const p of e.payers) assert.deepEqual(Object.keys(p), ['member_id', 'amount']);
    for (const p of e.participants) assert.deepEqual(Object.keys(p), ['member_id', 'share']);
    assert.ok(!JSON.stringify(e.participants).includes('Bilal'));
  }
});

// --- Rejected expenses (must NOT be saved) ---

test('rejects custom shares that are 50 short', () => {
  const result = prepareExpense({
    amount: 1200,
    category: 'food',
    split_type: 'custom',
    payers: [{ member_id: 'C', amount: 1200 }],
    participants: [
      { member_id: 'A', share: 500 },
      { member_id: 'B', share: 300 },
      { member_id: 'C', share: 350 },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Shares add up to 1150 but the total is 1200 (50 short).']);
});

test('rejects a custom share of 0', () => {
  const result = prepareExpense({
    amount: 1200,
    category: 'food',
    split_type: 'custom',
    payers: [{ member_id: 'C', amount: 1200 }],
    participants: [
      { member_id: 'A', share: 600 },
      { member_id: 'B', share: 0 },
      { member_id: 'C', share: 600 },
    ],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, ['Remove B or give them a share.']);
});

test('rejects payers over the total and an unknown category', () => {
  const result = prepareExpense({
    amount: 2000,
    category: 'drinks',
    split_type: 'equal',
    payers: [
      { member_id: 'A', amount: 1200 },
      { member_id: 'B', amount: 900 },
    ],
    participants: [{ member_id: 'A' }, { member_id: 'B' }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'Category must be one of: food, tea, transport, repair, shopping, other.',
    'Payers add up to 2100 but the total is 2000 (100 too much).',
  ]);
});

// --- Empty or 0 total: only the total error, nothing repeated ---

const TOTAL_ERROR = 'Total must be a whole number of rupees, more than 0.';

test('empty total with one payer shows only the total error', () => {
  // What the Add Expense screen sends when the amount box is empty:
  // the single payer's amount is the (missing) total.
  const result = prepareExpense({
    amount: NaN,
    category: 'food',
    split_type: 'equal',
    payers: [{ member_id: 'A', amount: NaN }],
    participants: [{ member_id: 'A' }, { member_id: 'B' }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [TOTAL_ERROR]);
});

test('total of 0 with one payer shows only the total error', () => {
  const result = prepareExpense({
    amount: 0,
    category: 'food',
    split_type: 'equal',
    payers: [{ member_id: 'A', amount: 0 }],
    participants: [{ member_id: 'A' }],
  });
  assert.deepEqual(result.errors, [TOTAL_ERROR]);
});

test('empty total with a custom split does not complain about the share sum', () => {
  const result = prepareExpense({
    amount: NaN,
    category: 'food',
    split_type: 'custom',
    payers: [{ member_id: 'A', amount: NaN }],
    participants: [
      { member_id: 'A', share: 300 },
      { member_id: 'B', share: 200 },
    ],
  });
  assert.deepEqual(result.errors, [TOTAL_ERROR]);
});

test('empty total still reports problems that have nothing to do with it', () => {
  const result = prepareExpense({
    amount: NaN,
    category: 'food',
    split_type: 'equal',
    payers: [{ member_id: 'A', amount: NaN }],
    participants: [],
  });
  assert.deepEqual(result.errors, [TOTAL_ERROR, 'Pick at least one person this expense is for.']);
});

// --- Editing: a saved expense goes through prepareExpense() again ---

test('editing: re-preparing a saved expense changes nothing', () => {
  // An expense as it comes back from the database (shares already stored).
  const saved = equal(1000, { A: 1000 }, ['A', 'B', 'C']);
  const again = prepareExpense(saved);
  assert.ok(again.ok);
  assert.deepEqual(again.expense.participants, saved.participants);
  assert.deepEqual(again.expense.payers, saved.payers);
});

test('editing: an equal split is re-worked from the new amount, not the old shares', () => {
  // Saved as 1000 for A, B, C (334/333/333), then edited to 900 for A, B.
  const saved = equal(1000, { A: 1000 }, ['A', 'B', 'C']);
  const edited = prepareExpense({
    ...saved,
    amount: 900,
    payers: [{ member_id: 'A', amount: 900 }],
    // Old shares are still attached — equal split must ignore them.
    participants: saved.participants.filter((p) => p.member_id !== 'C'),
  });
  assert.ok(edited.ok);
  assert.deepEqual(edited.expense.participants, [
    { member_id: 'A', share: 450 },
    { member_id: 'B', share: 450 },
  ]);
});

test('editing: a custom split keeps the newly typed shares', () => {
  const saved = expense({
    amount: 1200,
    category: 'food',
    split_type: 'custom',
    payers: [{ member_id: 'C', amount: 1200 }],
    participants: [
      { member_id: 'A', share: 500 },
      { member_id: 'B', share: 700 },
    ],
  });
  const edited = prepareExpense({
    ...saved,
    participants: [
      { member_id: 'A', share: 600 },
      { member_id: 'B', share: 600 },
    ],
  });
  assert.ok(edited.ok);
  assert.deepEqual(edited.expense.participants, [
    { member_id: 'A', share: 600 },
    { member_id: 'B', share: 600 },
  ]);
});

// --- Group summary (Groups list) ---

test('summarizeGroup: three meals', () => {
  // A +200, B +400 are owed → 600 still has to change hands.
  const summary = summarizeGroup(members, threeMeals(), []);
  assert.deepEqual(summary, { memberCount: 4, totalSpent: 1700, toSettle: 600 });
});

test('summarizeGroup: payments reduce toSettle but not totalSpent', () => {
  const payments = [
    { fromId: 'D', toId: 'B', amount: 350 },
    { fromId: 'C', toId: 'A', amount: 200 },
    { fromId: 'C', toId: 'B', amount: 50 },
  ];
  const summary = summarizeGroup(members, threeMeals(), payments);
  assert.deepEqual(summary, { memberCount: 4, totalSpent: 1700, toSettle: 0 });
});
