// fund.test.js — tests for the group fund maths in src/logic/split.js.
// Run with:  npm test
//
// A group fund is ordinary payments and expenses underneath:
//   putting money in   = payment (type 'contribution') giver → holder
//   a fund expense     = expense with from_fund = 1, paid by the holder
//   returning leftover = payment (type 'return') holder → member
// So every test also checks that computeBalances adds up to exactly 0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalances,
  coverFromFund,
  fundSummary,
  prepareExpense,
  suggestReturns,
} from '../src/logic/split.js';

const members = ['A', 'B', 'C', 'D'].map((id) => ({ id, name: id }));
const group = { id: 'G', fund_holder_id: 'A' };

// Events need a time so fundSummary can put them in order. Each call to
// tick() gives the next minute.
let clock = 0;
const tick = () => (clock += 60000);

// Money into the fund: `from` gives `amount` to the holder A.
function putIn(from, amount) {
  return { id: `in-${from}-${clock}`, fromId: from, toId: 'A', amount, type: 'contribution', created_at: tick() };
}

// An equal-split expense, built through prepareExpense like the app does.
// With fromFund, the holder A pays (that's what the app enforces).
function spend(amount, payer, forIds, fromFund) {
  const result = prepareExpense({
    amount,
    category: 'food',
    split_type: 'equal',
    payers: [{ member_id: payer, amount }],
    participants: forIds.map((member_id) => ({ member_id })),
  });
  assert.ok(result.ok, JSON.stringify(result.errors));
  return { ...result.expense, id: `exp-${clock}`, from_fund: fromFund ? 1 : 0, created_at: tick() };
}

function assertSumsToZero(balances) {
  const total = Object.values(balances).reduce((a, b) => a + b, 0);
  assert.equal(total, 0, `balances should add up to 0, got ${total}`);
}

// Everyone puts in 1000, A holds the money.
function everyonePutsIn1000() {
  return ['A', 'B', 'C', 'D'].map((id) => putIn(id, 1000));
}

// --- Your case 1 ---------------------------------------------------------

test('fund: everyone puts in 1000, dinner 3000 from the fund for all 4', () => {
  const payments = everyonePutsIn1000();
  const expenses = [spend(3000, 'A', ['A', 'B', 'C', 'D'], true)];

  const fund = fundSummary(group, expenses, payments);
  assert.equal(fund.holderId, 'A');
  assert.equal(fund.totalIn, 4000);
  assert.equal(fund.totalSpent, 3000);
  assert.equal(fund.holderExtra, 0);
  assert.equal(fund.left, 1000);
  assert.deepEqual(fund.contributions, { A: 1000, B: 1000, C: 1000, D: 1000 });

  const balances = computeBalances(members, expenses, payments);
  assert.deepEqual(balances, { A: -750, B: 250, C: 250, D: 250 });
  assertSumsToZero(balances);
});

// --- Your case 2 ---------------------------------------------------------

test('fund: a 1500 expense when only 1000 is left — holder pays 500 extra', () => {
  const payments = everyonePutsIn1000();
  const expenses = [
    spend(3000, 'A', ['A', 'B', 'C', 'D'], true),
    spend(1500, 'A', ['A', 'B', 'C', 'D'], true), // 375 each
  ];

  const fund = fundSummary(group, expenses, payments);
  assert.equal(fund.totalIn, 4000);
  assert.equal(fund.totalSpent, 4000); // the fund can't spend more than it had
  assert.equal(fund.holderExtra, 500); // A paid the rest from their own pocket
  assert.equal(fund.left, 0);

  // The second expense: 1000 from the fund, 500 extra, nothing left after.
  const last = fund.history[fund.history.length - 1];
  assert.deepEqual(
    { kind: last.kind, fromFund: last.fromFund, extra: last.extra, left: last.left },
    { kind: 'out', fromFund: 1000, extra: 500, left: 0 }
  );

  // A put in 1000 + 500 extra = 1500, and ate 750 + 375 = 1125 → gets 375.
  // B, C, D each put in 1000 and ate 1125 → owe 125.
  const balances = computeBalances(members, expenses, payments);
  assert.deepEqual(balances, { A: 375, B: -125, C: -125, D: -125 });
  assertSumsToZero(balances);
});

// --- Your case 3 ---------------------------------------------------------

test('fund: a contribution, a normal expense by B, and a settlement together', () => {
  const payments = [
    putIn('B', 1000), // B gives the holder A 1000 for the fund
    { id: 'settle', fromId: 'A', toId: 'B', amount: 200, type: 'settlement', created_at: tick() },
  ];
  // B pays lunch 800 for A and B from their own pocket (not the fund).
  const expenses = [spend(800, 'B', ['A', 'B'], false)];

  // Only the contribution touches the fund: the settlement and the normal
  // expense are ignored by fundSummary.
  const fund = fundSummary(group, expenses, payments);
  assert.equal(fund.totalIn, 1000);
  assert.equal(fund.totalSpent, 0);
  assert.equal(fund.left, 1000);
  assert.deepEqual(fund.contributions, { B: 1000 });
  assert.equal(fund.history.length, 1);

  // A: -1000 (holds B's money) - 400 (lunch share) + 200 (paid B back) = -1200
  // B: +1000 + 800 - 400 - 200 = +1200
  const balances = computeBalances(members, expenses, payments);
  assert.deepEqual(balances, { A: -1200, B: 1200, C: 0, D: 0 });
  assertSumsToZero(balances);
});

// --- Returning leftover --------------------------------------------------

test('returning leftover: suggestions settle everyone and empty the fund', () => {
  const payments = everyonePutsIn1000();
  const expenses = [spend(3000, 'A', ['A', 'B', 'C', 'D'], true)];
  const before = computeBalances(members, expenses, payments);

  // Fund has 1000 left: 250 each to B, C, D; A keeps their own 250.
  const returns = suggestReturns(1000, 'A', before);
  assert.deepEqual(returns, [
    { toId: 'B', amount: 250 },
    { toId: 'C', amount: 250 },
    { toId: 'D', amount: 250 },
    { toId: 'A', amount: 250 },
  ]);

  // Record them as 'return' payments from the holder.
  const withReturns = [
    ...payments,
    ...returns.map((r) => ({
      id: `ret-${r.toId}`,
      fromId: 'A',
      toId: r.toId,
      amount: r.amount,
      type: 'return',
      created_at: tick(),
    })),
  ];

  const fund = fundSummary(group, expenses, withReturns);
  assert.equal(fund.left, 0);
  assert.equal(fund.totalReturned, 1000);

  const after = computeBalances(members, expenses, withReturns);
  assert.deepEqual(after, { A: 0, B: 0, C: 0, D: 0 });
  assertSumsToZero(after);
});

test('suggestReturns: pays the most-owed first and stops when the money runs out', () => {
  // Only 300 left, but B is owed 400 and C 100.
  assert.deepEqual(suggestReturns(300, 'A', { A: -500, B: 400, C: 100 }), [
    { toId: 'B', amount: 300 },
  ]);
  // Nothing left → nothing to return.
  assert.deepEqual(suggestReturns(0, 'A', { A: -100, B: 100 }), []);
});

// --- Small pieces --------------------------------------------------------

test('coverFromFund splits an expense into fund money and the holder’s extra', () => {
  assert.deepEqual(coverFromFund(1000, 1500), { fromFund: 1000, extra: 500 });
  assert.deepEqual(coverFromFund(1000, 300), { fromFund: 300, extra: 0 });
  assert.deepEqual(coverFromFund(0, 700), { fromFund: 0, extra: 700 });
});

test('fundSummary goes by time, not by list order', () => {
  // listExpenses/listPayments come newest first; the fund must still be
  // worked out oldest first. Here the expense is listed before the money
  // that was put in earlier.
  const money = putIn('B', 500);
  const lunch = spend(400, 'A', ['A', 'B'], true);
  const fund = fundSummary(group, [lunch], [money]);
  assert.deepEqual(
    fund.history.map((h) => [h.kind, h.left]),
    [
      ['in', 500],
      ['out', 100],
    ]
  );
  assert.equal(fund.holderExtra, 0);
});

test('fundSummary with no fund events is all zeros', () => {
  const fund = fundSummary({ fund_holder_id: null }, [], []);
  assert.deepEqual(fund, {
    holderId: null,
    totalIn: 0,
    totalSpent: 0,
    totalReturned: 0,
    holderExtra: 0,
    left: 0,
    contributions: {},
    history: [],
  });
});
