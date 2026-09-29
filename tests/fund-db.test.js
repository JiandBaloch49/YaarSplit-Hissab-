// fund-db.test.js — the group fund through the REAL database code
// (src/db/queries.js), running on an in-memory SQLite.
// See tests/helpers for how expo-sqlite is swapped out in tests.
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../src/db/database.js';
import {
  addExpense,
  addGroup,
  addMember,
  addPayment,
  deleteMember,
  getFund,
  listExpenses,
  listMembers,
  listPayments,
  setFundHolder,
} from '../src/db/queries.js';
import { computeBalances } from '../src/logic/split.js';

initDatabase();

// A fresh group with members A, B, C, D and A holding the fund.
// Returns { groupId, ids: { A: '...', B: '...', ... } }.
function groupWithFund() {
  const groupId = addGroup('Trip').id;
  const ids = {};
  for (const name of ['A', 'B', 'C', 'D']) ids[name] = addMember(groupId, name).id;
  assert.deepEqual(setFundHolder(groupId, ids.A), { ok: true });
  return { groupId, ids };
}

function putIn(groupId, fromId, toId, amount) {
  const result = addPayment(groupId, { fromId, toId, amount, type: 'contribution' });
  assert.ok(result.ok, JSON.stringify(result.errors));
}

// Balances from what's saved in the database, by member NAME.
function balancesByName(groupId) {
  const members = listMembers(groupId);
  const balances = computeBalances(members, listExpenses(groupId), listPayments(groupId));
  const byName = {};
  for (const m of members) byName[m.name] = balances[m.id];
  const total = Object.values(byName).reduce((a, b) => a + b, 0);
  assert.equal(total, 0, 'balances should add up to 0');
  return byName;
}

test('db: everyone puts in 1000, dinner 3000 from the fund', () => {
  const { groupId, ids } = groupWithFund();
  for (const name of ['A', 'B', 'C', 'D']) putIn(groupId, ids[name], ids.A, 1000);

  const result = addExpense(groupId, {
    description: 'Dinner',
    amount: 3000,
    category: 'food',
    split_type: 'equal',
    from_fund: 1,
    payers: [], // the screen doesn't need to send a payer for fund expenses
    participants: Object.values(ids).map((member_id) => ({ member_id })),
  });
  assert.ok(result.ok, JSON.stringify(result.errors));

  assert.equal(getFund(groupId).left, 1000);
  assert.deepEqual(balancesByName(groupId), { A: -750, B: 250, C: 250, D: 250 });
});

test('db: a fund expense is always paid by the holder, whatever the screen sends', () => {
  const { groupId, ids } = groupWithFund();
  putIn(groupId, ids.B, ids.A, 500);

  // The screen (wrongly) says B paid — the fund holder A must be saved.
  const result = addExpense(groupId, {
    amount: 400,
    category: 'tea',
    split_type: 'equal',
    from_fund: 1,
    payers: [{ member_id: ids.B, amount: 400 }],
    participants: [{ member_id: ids.A }, { member_id: ids.B }],
  });
  assert.ok(result.ok);
  const [saved] = listExpenses(groupId);
  assert.deepEqual(saved.payers, [{ member_id: ids.A, amount: 400 }]);
  assert.equal(saved.from_fund, 1);
});

test('db: when the fund runs short, the expense still saves and balances stay right', () => {
  const { groupId, ids } = groupWithFund();
  for (const name of ['A', 'B', 'C', 'D']) putIn(groupId, ids[name], ids.A, 1000);
  const everyone = Object.values(ids).map((member_id) => ({ member_id }));
  const spend = (amount) =>
    addExpense(groupId, { amount, category: 'food', split_type: 'equal', from_fund: 1, participants: everyone });

  assert.ok(spend(3000).ok);
  assert.ok(spend(1500).ok); // only 1000 left: A pays 500 out of pocket

  const fund = getFund(groupId);
  assert.equal(fund.left, 0);
  assert.equal(fund.holderExtra, 500);
  assert.deepEqual(balancesByName(groupId), { A: 375, B: -125, C: -125, D: -125 });
});

test('db: "Paid from group fund" without a fund is refused', () => {
  const groupId = addGroup('No fund').id;
  const a = addMember(groupId, 'A').id;
  const result = addExpense(groupId, {
    amount: 100,
    category: 'tea',
    split_type: 'equal',
    from_fund: 1,
    participants: [{ member_id: a }],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no fund/);
});

test('db: payment types and who can give to whom', () => {
  const { groupId, ids } = groupWithFund();

  // The holder may put in their own money…
  assert.ok(addPayment(groupId, { fromId: ids.A, toId: ids.A, amount: 100, type: 'contribution' }).ok);
  // …but fund money must go to the holder,
  assert.equal(
    addPayment(groupId, { fromId: ids.B, toId: ids.C, amount: 100, type: 'contribution' }).ok,
    false
  );
  // only the holder can hand money back,
  assert.equal(addPayment(groupId, { fromId: ids.B, toId: ids.C, amount: 50, type: 'return' }).ok, false);
  // nobody settles up with themselves,
  assert.equal(addPayment(groupId, { fromId: ids.B, toId: ids.B, amount: 50 }).ok, false);
  // and the type must be a known one.
  assert.equal(addPayment(groupId, { fromId: ids.B, toId: ids.A, amount: 50, type: 'gift' }).ok, false);

  // A normal settlement still defaults to type 'settlement'.
  assert.ok(addPayment(groupId, { fromId: ids.B, toId: ids.C, amount: 50 }).ok);
  const types = listPayments(groupId).map((p) => p.type).sort();
  assert.deepEqual(types, ['contribution', 'settlement']);
});

test('db: the holder can only change when the fund is at 0', () => {
  const { groupId, ids } = groupWithFund();
  putIn(groupId, ids.B, ids.A, 300);

  const blocked = setFundHolder(groupId, ids.B);
  assert.equal(blocked.ok, false);
  assert.match(blocked.errors[0], /Rs 300/);

  // A hands the 300 back to B; the fund is empty, so B can take over.
  assert.ok(addPayment(groupId, { fromId: ids.A, toId: ids.B, amount: 300, type: 'return' }).ok);
  assert.equal(getFund(groupId).left, 0);
  assert.deepEqual(setFundHolder(groupId, ids.B), { ok: true });
  assert.equal(getFund(groupId).holderId, ids.B);

  // Ending the fund (holder = null) also works at 0.
  assert.deepEqual(setFundHolder(groupId, null), { ok: true });
  assert.equal(getFund(groupId), null);
  assert.deepEqual(balancesByName(groupId), { A: 0, B: 0, C: 0, D: 0 });
});

test('db: the fund holder can’t be removed from the group', () => {
  const { ids } = groupWithFund();
  const result = deleteMember(ids.A);
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /holds the group fund/);
});
