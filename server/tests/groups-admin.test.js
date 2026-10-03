// groups-admin.test.js — expense permissions, admin roles, the
// simplify_debts setting, and the history between two members.
// Run with:  cd server && npm test

import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  auth,
  createAccount,
  joinAs,
  sampleGroup,
  startTestDb,
  stopTestDb,
  uploadGroup,
} from './helpers.js';
import { Expense, Member } from '../src/models.js';

before(startTestDb);
after(stopTestDb);

// A group where A (admin), B and C all have accounts.
async function setup() {
  const group = await uploadGroup();
  const bilal = await joinAs(group, 'B');
  const chand = await joinAs(group, 'C');
  return { group, ids: group.ids, A: group.token, B: bilal.token, C: chand.token };
}

// An equal-split expense: `payer` paid `amount` for `forLetters`.
function expenseBody(ids, payer, amount, forLetters) {
  return {
    description: 'Chai',
    amount,
    category: 'tea',
    split_type: 'equal',
    payers: [{ member_id: ids[payer], amount }],
    participants: forLetters.map((l) => ({ member_id: ids[l] })),
    from_fund: 0,
  };
}

function addExpense(ids, token, body) {
  return api()
    .post(`/groups/${ids.group}/expenses`)
    .set(auth(token))
    .send({ id: randomUUID(), ...body });
}

describe('expenses: only the creator or an admin can change them', () => {
  test('any member can add one; it records who created it', async () => {
    const { ids, B } = await setup();
    const res = await addExpense(ids, B, expenseBody(ids, 'B', 300, ['A', 'B', 'C'])).expect(201);
    assert.equal(res.body.expense.created_by, ids.B);
    assert.equal(res.body.expense.updated_by, ids.B);
    assert.deepEqual(
      res.body.expense.participants.map((p) => p.share),
      [100, 100, 100]
    );
  });

  test('another member editing or deleting it → 403', async () => {
    const { ids, B, C } = await setup();
    const made = await addExpense(ids, B, expenseBody(ids, 'B', 300, ['A', 'B', 'C'])).expect(201);
    const url = `/groups/${ids.group}/expenses/${made.body.expense.id}`;

    const res = await api().put(url).set(auth(C)).send(expenseBody(ids, 'B', 1, ['C'])).expect(403);
    assert.match(res.body.error, /Only the person who added this expense, or an admin/);
    await api().delete(url).set(auth(C)).expect(403);

    // Unchanged.
    const stored = await Expense.findById(made.body.expense.id).lean();
    assert.deepEqual([stored.amount, stored.deleted], [300, 0]);
  });

  test('the creator can edit; updated_by and the seq change', async () => {
    const { ids, B } = await setup();
    const made = await addExpense(ids, B, expenseBody(ids, 'B', 300, ['A', 'B', 'C'])).expect(201);
    const res = await api()
      .put(`/groups/${ids.group}/expenses/${made.body.expense.id}`)
      .set(auth(B))
      .send(expenseBody(ids, 'B', 1000, ['A', 'B', 'C']))
      .expect(200);
    assert.deepEqual(
      res.body.expense.participants.map((p) => p.share),
      [334, 333, 333]
    );
    assert.equal(res.body.expense.updated_by, ids.B);
    assert.ok(res.body.expense.seq > made.body.expense.seq);
  });

  test("an admin can edit and delete someone else's expense", async () => {
    const { ids, A, B } = await setup();
    const made = await addExpense(ids, B, expenseBody(ids, 'B', 300, ['A', 'B', 'C'])).expect(201);
    const url = `/groups/${ids.group}/expenses/${made.body.expense.id}`;

    const edited = await api().put(url).set(auth(A)).send(expenseBody(ids, 'B', 600, ['B', 'C'])).expect(200);
    assert.deepEqual([edited.body.expense.created_by, edited.body.expense.updated_by], [ids.B, ids.A]);

    const deleted = await api().delete(url).set(auth(A)).expect(200);
    assert.equal(deleted.body.expense.deleted, 1);
    assert.equal(deleted.body.expense.updated_by, ids.A);

    // Soft delete: still stored; can't be edited or deleted again.
    assert.ok(await Expense.exists({ _id: made.body.expense.id }));
    await api().put(url).set(auth(A)).send(expenseBody(ids, 'B', 600, ['B'])).expect(404);
    await api().delete(url).set(auth(A)).expect(404);
  });

  test('uploaded expenses belong to the uploader: others can\'t change them', async () => {
    const { ids, B, group } = await setup();
    const url = `/groups/${ids.group}/expenses/${group.body.expenses[0].id}`;
    await api().delete(url).set(auth(B)).expect(403);
  });

  test('checks: bad money, removed or unknown members, duplicates, outsiders', async () => {
    const { ids, A } = await setup();
    const bad = await addExpense(ids, A, { ...expenseBody(ids, 'A', 300, ['A']), amount: 299 }).expect(400);
    assert.ok(bad.body.errors.includes('Payers add up to 300 but the total is 299 (1 too much).'));
    await addExpense(ids, A, expenseBody(ids, 'A', 300, ['A', 'D'])).expect(400); // D was removed
    await api()
      .post(`/groups/${ids.group}/expenses`)
      .set(auth(A))
      .send(expenseBody(ids, 'A', 300, ['A'])) // no id
      .expect(400);

    const id = randomUUID();
    await addExpense(ids, A, { id, ...expenseBody(ids, 'A', 300, ['A']) }).expect(201);
    await addExpense(ids, A, { id, ...expenseBody(ids, 'A', 300, ['A']) }).expect(409);

    const outsider = await createAccount();
    await addExpense(ids, outsider.token, expenseBody(ids, 'A', 300, ['A'])).expect(403);
  });
});

describe('admin roles', () => {
  test('an admin can make another member admin; then they can invite', async () => {
    const { ids, A, B } = await setup();
    const someone = await createAccount();
    const inviteC = () =>
      api()
        .post(`/groups/${ids.group}/invites`)
        .set(auth(B))
        .send({ member_id: ids.C, username: someone.account.username });

    await inviteC().expect(403); // B is not an admin yet (C's slot is taken anyway)
    const res = await api()
      .post(`/groups/${ids.group}/members/${ids.B}/make-admin`)
      .set(auth(A))
      .expect(200);
    assert.equal(res.body.member.role, 'admin');
    assert.equal(res.body.member.updated_by, ids.A);
    await inviteC().expect(409); // allowed now; refused only because C is taken
  });

  test('a normal member cannot make admins or remove people → 403', async () => {
    const { ids, B } = await setup();
    await api().post(`/groups/${ids.group}/members/${ids.C}/make-admin`).set(auth(B)).expect(403);
    await api().post(`/groups/${ids.group}/members/${ids.B}/make-admin`).set(auth(B)).expect(403);
    await api().post(`/groups/${ids.group}/members/${ids.A}/remove`).set(auth(B)).expect(403);
  });

  test('a member without an account cannot be made admin → 409', async () => {
    const group = await uploadGroup();
    await api()
      .post(`/groups/${group.ids.group}/members/${group.ids.C}/make-admin`)
      .set(auth(group.token))
      .expect(409);
  });

  test('removing someone unlinks their account; their history stays', async () => {
    const { ids, A, B } = await setup();
    const before = await api().get(`/groups/${ids.group}/settle-up`).set(auth(A)).expect(200);

    const res = await api().post(`/groups/${ids.group}/members/${ids.B}/remove`).set(auth(A)).expect(200);
    assert.deepEqual([res.body.member.account_id, res.body.member.role], [null, 'member']);
    assert.equal(res.body.member.deleted, 0); // the slot stays

    // B's phone is locked out...
    await api().get(`/groups/${ids.group}/changes`).set(auth(B)).expect(403);
    // ...but nothing about the money changed.
    const after = await api().get(`/groups/${ids.group}/settle-up`).set(auth(A)).expect(200);
    assert.deepEqual(after.body.balances, before.body.balances);
  });

  test('the last admin cannot leave; with two admins one can', async () => {
    const { ids, A, B } = await setup();
    const res = await api().post(`/groups/${ids.group}/members/${ids.A}/remove`).set(auth(A)).expect(409);
    assert.match(res.body.error, /at least one admin/);

    await api().post(`/groups/${ids.group}/members/${ids.B}/make-admin`).set(auth(A)).expect(200);
    await api().post(`/groups/${ids.group}/members/${ids.A}/remove`).set(auth(A)).expect(200);
    assert.equal((await Member.findById(ids.A).lean()).account_id, null);
    // B is the admin now, and the last one.
    await api().post(`/groups/${ids.group}/members/${ids.B}/remove`).set(auth(B)).expect(409);
  });
});

describe('simplify_debts and settle-up', () => {
  // A fresh group with no history, then a chain: A paid 200 for B, and
  // B paid 200 for C. Balances: A +200, B 0, C -200.
  async function chainGroup() {
    const { ids, body } = sampleGroup();
    body.expenses = [];
    body.payments = [];
    const admin = await createAccount('A');
    await api().post('/groups').set(auth(admin.token)).send(body).expect(201);
    const group = { ids, body, token: admin.token };
    const bilal = await joinAs(group, 'B');

    await addExpense(ids, admin.token, expenseBody(ids, 'A', 200, ['B'])).expect(201);
    await addExpense(ids, bilal.token, expenseBody(ids, 'B', 200, ['C'])).expect(201);
    return { ids, A: admin.token, B: bilal.token };
  }

  const transfers = (res) => res.body.transfers.map((t) => [t.fromId, t.toId, t.amount]);

  test('on by default: the simplified list (C pays A, B is skipped)', async () => {
    const { ids, A } = await chainGroup();
    const res = await api().get(`/groups/${ids.group}/settle-up`).set(auth(A)).expect(200);
    assert.equal(res.body.simplify_debts, 1);
    assert.deepEqual(transfers(res), [[ids.C, ids.A, 200]]);
  });

  test('an admin turns it off: pairwise debts; a member cannot → 403', async () => {
    const { ids, A, B } = await chainGroup();
    await api().patch(`/groups/${ids.group}/settings`).set(auth(B)).send({ simplify_debts: false }).expect(403);
    await api().patch(`/groups/${ids.group}/settings`).set(auth(A)).send({ simplify_debts: 'no' }).expect(400);

    const res = await api()
      .patch(`/groups/${ids.group}/settings`)
      .set(auth(A))
      .send({ simplify_debts: false })
      .expect(200);
    assert.equal(res.body.group.simplify_debts, 0);
    assert.equal(res.body.group.updated_by, ids.A);

    // Each person pays back exactly who they owe: B → A and C → B.
    const settle = await api().get(`/groups/${ids.group}/settle-up`).set(auth(B)).expect(200);
    assert.equal(settle.body.simplify_debts, 0);
    const expected = [
      [ids.B, ids.A, 200],
      [ids.C, ids.B, 200],
    ].sort((x, y) => (x[0] < y[0] ? -1 : 1)); // pairwiseDebts sorts by payer id
    assert.deepEqual(transfers(settle), expected);

    // The setting syncs to phones like any other group change.
    const changes = await api().get(`/groups/${ids.group}/changes`).set(auth(B)).expect(200);
    assert.equal(changes.body.group.simplify_debts, 0);
  });
});

describe('history between two members', () => {
  test('every expense and payment between them, oldest first, with what is left', async () => {
    const group = await uploadGroup();
    const bilal = await joinAs(group, 'B');
    const { ids } = group;

    // The upload has: Dinner (A paid 1000 for A, B, C) → B owes A 333,
    // and Tea (B paid 150 for B, C) → nothing between A and B.
    // Then: B pays A 300 (confirmed by A), and B says he paid 33 more (pending).
    const paid = await api()
      .post(`/groups/${ids.group}/payments`)
      .set(auth(bilal.token))
      .send({ id: randomUUID(), from_member_id: ids.B, to_member_id: ids.A, amount: 300 })
      .expect(201);
    await api()
      .post(`/groups/${ids.group}/payments/${paid.body.payment.id}/confirm`)
      .set(auth(group.token))
      .expect(200);
    await api()
      .post(`/groups/${ids.group}/payments`)
      .set(auth(bilal.token))
      .send({ id: randomUUID(), from_member_id: ids.B, to_member_id: ids.A, amount: 33 })
      .expect(201);

    const res = await api()
      .get(`/groups/${ids.group}/history/${ids.A}/${ids.B}`)
      .set(auth(bilal.token))
      .expect(200);
    assert.deepEqual(
      res.body.steps.map((s) => [s.kind, s.change, s.remaining, s.item.status ?? null]),
      [
        ['expense', 333, 333, null], // Dinner
        ['payment', -300, 33, 'confirmed'],
        ['payment', 0, 33, 'pending'], // listed, but doesn't count yet
      ]
    );
  });

  test('both must be members of this group', async () => {
    const group = await uploadGroup();
    const url = (a, b) => `/groups/${group.ids.group}/history/${a}/${b}`;
    await api().get(url(group.ids.A, 'stranger')).set(auth(group.token)).expect(404);
    await api().get(url(group.ids.A, group.ids.A)).set(auth(group.token)).expect(404);
    const outsider = await createAccount();
    await api().get(url(group.ids.A, group.ids.B)).set(auth(outsider.token)).expect(403);
  });
});
