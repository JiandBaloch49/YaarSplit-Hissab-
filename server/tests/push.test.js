// push.test.js — POST /groups/:groupId/push, the phone's sync upload.
// Every change in a push is judged on its own with the same rules as the
// single-row endpoints. Refused changes come back with the reason AND the
// server's version, so the phone can put it back.
// Run with:  cd server && npm test

import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, createAccount, joinAs, startTestDb, stopTestDb, uploadGroup } from './helpers.js';

before(startTestDb);
after(stopTestDb);

// The sample group (see helpers.js): A is admin, B (Bilal) has an account
// too, C has none, D was removed. Everything uploaded was created by A.
async function setup() {
  const group = await uploadGroup();
  const bilal = await joinAs(group, 'B');
  return { group, ids: group.ids, A: group.token, B: bilal.token };
}

// Send a push and return the results list.
async function push(ids, token, changes) {
  const res = await api().post(`/groups/${ids.group}/push`).set(auth(token)).send({ changes }).expect(200);
  return res.body.results;
}

// Everything in the group, as a phone would pull it.
async function pull(ids, token) {
  const res = await api().get(`/groups/${ids.group}/changes?since=0`).set(auth(token)).expect(200);
  return res.body;
}

const now = () => Date.now();

// A new expense row as the phone stores it: `payer` paid `amount`, split
// equally (shares already worked out) between `forIds`.
function expenseRow(ids, payer, amount, forIds, extra = {}) {
  const share = amount / forIds.length; // tests use amounts that divide evenly
  return {
    id: randomUUID(),
    group_id: ids.group,
    description: 'Chai',
    amount,
    category: 'tea',
    split_type: 'equal',
    payers: [{ member_id: ids[payer], amount }],
    participants: forIds.map((x) => ({ member_id: ids[x], share })),
    from_fund: 0,
    created_at: now(),
    updated_at: now(),
    deleted: 0,
    ...extra,
  };
}

function paymentRow(ids, from, to, amount, extra = {}) {
  return {
    id: randomUUID(),
    group_id: ids.group,
    from_member_id: ids[from],
    to_member_id: ids[to],
    amount,
    type: 'settlement',
    status: 'pending',
    created_at: now(),
    updated_at: now(),
    deleted: 0,
    ...extra,
  };
}

describe('push: adding things', () => {
  test('a new member and an expense that uses them, in one push', async () => {
    const { ids, B, A } = await setup();
    const zara = { id: randomUUID(), group_id: ids.group, name: 'Zara', created_at: now(), updated_at: now(), deleted: 0 };
    const chai = expenseRow({ ...ids, Z: zara.id }, 'B', 100, ['B', 'Z']);

    const results = await push(ids, B, [
      { table: 'members', row: zara },
      { table: 'expenses', row: chai },
    ]);
    assert.deepEqual(results.map((r) => r.ok), [true, true]);
    // The reply carries the server's version: created_by is decided there.
    assert.equal(results[1].row.created_by, ids.B);
    assert.equal(results[0].row.role, 'member');
    assert.equal(results[0].row.account_id, null);

    // Another phone sees both.
    const pulled = await pull(ids, A);
    assert.ok(pulled.members.some((m) => m.id === zara.id));
    assert.ok(pulled.expenses.some((e) => e.id === chai.id));
  });

  test('sending the same row twice (lost reply) changes nothing the second time', async () => {
    const { ids, B } = await setup();
    const chai = expenseRow(ids, 'B', 100, ['A', 'B']);
    const [first] = await push(ids, B, [{ table: 'expenses', row: chai }]);
    const [second] = await push(ids, B, [{ table: 'expenses', row: chai }]);
    assert.equal(second.ok, true);
    assert.equal(second.row.seq, first.row.seq); // not saved again
  });

  test('a bad expense is refused with the reasons; the rest still saves', async () => {
    const { ids, B } = await setup();
    const bad = expenseRow(ids, 'B', 100, ['A', 'B'], { amount: 99 }); // payers add up to 100
    const good = expenseRow(ids, 'B', 200, ['A', 'B']);
    const [r1, r2] = await push(ids, B, [
      { table: 'expenses', row: bad },
      { table: 'expenses', row: good },
    ]);
    assert.equal(r1.ok, false);
    assert.equal(r1.status, 400);
    assert.ok(r1.errors.length > 0);
    assert.equal(r1.row, null); // nothing on the server to restore
    assert.equal(r2.ok, true);
  });

  test('a payment: the server decides its status', async () => {
    const { ids, A, B } = await setup();
    // B says "I paid A" → pending, even if the phone claimed confirmed.
    const [paid] = await push(ids, B, [{ table: 'payments', row: paymentRow(ids, 'B', 'A', 100, { status: 'confirmed' }) }]);
    assert.equal(paid.row.status, 'pending');
    // A says "B paid me" → confirmed by the receiver.
    const [got] = await push(ids, A, [{ table: 'payments', row: paymentRow(ids, 'B', 'A', 50) }]);
    assert.equal(got.row.status, 'confirmed');
    assert.equal(got.row.confirmed_by, 'receiver');
  });

  test('a payment between two other people is refused', async () => {
    const { ids, B } = await setup();
    const [r] = await push(ids, B, [{ table: 'payments', row: paymentRow(ids, 'C', 'A', 100) }]);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe('push: changing things, and who may', () => {
  test('only the creator or an admin may edit or delete an expense', async () => {
    const s = await setup();
    // "Dinner" was uploaded by A. B edits it → refused, server copy returned.
    const dinner = s.group.body.expenses[0];
    const edited = { ...dinner, description: 'Free dinner' };
    const [r] = await push(s.ids, s.B, [{ table: 'expenses', row: edited }]);
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.row.description, 'Dinner');

    // B's own expense: B may edit, delete and restore it.
    const chai = expenseRow(s.ids, 'B', 100, ['A', 'B']);
    await push(s.ids, s.B, [{ table: 'expenses', row: chai }]);
    const bigger = { ...expenseRow(s.ids, 'B', 300, ['A', 'B']), id: chai.id };
    const [e] = await push(s.ids, s.B, [{ table: 'expenses', row: bigger }]);
    assert.equal(e.ok, true);
    assert.equal(e.row.amount, 300);
    const [d] = await push(s.ids, s.B, [{ table: 'expenses', row: { ...chai, deleted: 1 } }]);
    assert.equal(d.row.deleted, 1);
    const [u] = await push(s.ids, s.B, [{ table: 'expenses', row: { ...chai, deleted: 0 } }]);
    assert.equal(u.ok, true);
    assert.equal(u.row.deleted, 0);

    // The admin may edit anyone's.
    const [a] = await push(s.ids, s.group.token, [{ table: 'expenses', row: { ...chai, description: 'Kahwa' } }]);
    assert.equal(a.ok, true);
    assert.equal(a.row.description, 'Kahwa');
    assert.equal(a.row.updated_by, s.ids.A);
  });

  test('an edit may keep someone who was removed from the group', async () => {
    const s = await setup();
    // D was removed: a NEW expense with D is refused...
    const [withD] = await push(s.ids, s.A, [{ table: 'expenses', row: expenseRow(s.ids, 'A', 200, ['A', 'D']) }]);
    assert.equal(withD.status, 400);
    // ...but editing the uploaded Dinner (A, B, C) keeps working.
    const dinner = s.group.body.expenses[0];
    const [r] = await push(s.ids, s.A, [{ table: 'expenses', row: { ...dinner, description: 'Big dinner' } }]);
    assert.equal(r.ok, true);
  });

  test('payments: only the status moves, by the confirm/reject/cancel rules', async () => {
    const { ids, A, B } = await setup();
    const row = paymentRow(ids, 'B', 'A', 100);
    await push(ids, B, [{ table: 'payments', row }]);

    // B (the payer) can't confirm their own payment.
    const [selfConfirm] = await push(ids, B, [{ table: 'payments', row: { ...row, status: 'confirmed' } }]);
    assert.equal(selfConfirm.status, 403);
    assert.equal(selfConfirm.row.status, 'pending');

    // Nobody can delete or edit it.
    const [del] = await push(ids, B, [{ table: 'payments', row: { ...row, deleted: 1 } }]);
    assert.equal(del.status, 403);
    const [edit] = await push(ids, A, [{ table: 'payments', row: { ...row, amount: 5 } }]);
    assert.equal(edit.status, 409);

    // A (the receiver) confirms.
    const [ok] = await push(ids, A, [{ table: 'payments', row: { ...row, status: 'confirmed' } }]);
    assert.equal(ok.ok, true);
    assert.equal(ok.row.status, 'confirmed');
    assert.equal(ok.row.confirmed_by, 'receiver');

    // Too late to cancel now.
    const [late] = await push(ids, B, [{ table: 'payments', row: { ...row, status: 'cancelled' } }]);
    assert.equal(late.status, 409);
  });

  test('group settings are for admins; the fund holder changes only at Rs 0', async () => {
    const { ids, A, B, group } = await setup();
    const g = { ...group.body.group, name: 'Renamed' };
    const [byB] = await push(ids, B, [{ table: 'groups', row: g }]);
    assert.equal(byB.status, 403);
    assert.equal(byB.row.name, 'Kund Malir trip');

    const [byA] = await push(ids, A, [{ table: 'groups', row: g }]);
    assert.equal(byA.ok, true);
    assert.equal(byA.row.name, 'Renamed');

    // Start a fund held by A, put money in, then try to switch holder.
    await push(ids, A, [{ table: 'groups', row: { ...g, fund_holder_id: ids.A } }]);
    await push(ids, A, [{ table: 'payments', row: paymentRow(ids, 'B', 'A', 500, { type: 'contribution' }) }]);
    const [swap] = await push(ids, A, [{ table: 'groups', row: { ...g, fund_holder_id: ids.B } }]);
    assert.equal(swap.status, 409);
    assert.equal(swap.row.fund_holder_id, ids.A);
  });

  test('members: rename yourself, admins rename others; removing needs settled up', async () => {
    const { ids, A, B, group } = await setup();
    const [Bm, Cm] = [group.body.members[1], group.body.members[2]];

    const [self] = await push(ids, B, [{ table: 'members', row: { ...Bm, name: 'Bilal' } }]);
    assert.equal(self.ok, true);
    const [other] = await push(ids, B, [{ table: 'members', row: { ...Cm, name: 'X' } }]);
    assert.equal(other.status, 403);

    // C still owes money → can't be removed, even by the admin.
    const [owes] = await push(ids, A, [{ table: 'members', row: { ...Cm, deleted: 1 } }]);
    assert.equal(owes.status, 409);
    // B has an account → can't just be deleted.
    const [linked] = await push(ids, A, [{ table: 'members', row: { ...Bm, deleted: 1 } }]);
    assert.equal(linked.status, 409);
    // The phone can never change the account link or role.
    const [sneaky] = await push(ids, B, [{ table: 'members', row: { ...Bm, name: 'Bilal', role: 'admin', account_id: null } }]);
    assert.equal(sneaky.row.role, 'member');
    assert.ok(sneaky.row.account_id);
  });

  test('someone outside the group cannot push at all', async () => {
    const { ids } = await setup();
    const stranger = await createAccount('Stranger');
    await api()
      .post(`/groups/${ids.group}/push`)
      .set(auth(stranger.token))
      .send({ changes: [] })
      .expect(403);
  });
});
