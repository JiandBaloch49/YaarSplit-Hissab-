// payments.test.js — recording payments and confirming them.
// Who may do what is the whole point here, so every rule has a test that
// the wrong person gets 403.
// Run with:  cd server && npm test

import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, createAccount, joinAs, startTestDb, stopTestDb, uploadGroup } from './helpers.js';
import { Payment } from '../src/models.js';

before(startTestDb);
after(stopTestDb);

// A group where A (admin) and B (Bilal) have accounts and C has none yet.
async function setup() {
  const group = await uploadGroup();
  const bilal = await joinAs(group, 'B');
  return { group, ids: group.ids, A: group.token, B: bilal.token };
}

// `token` records that `from` paid `to` `amount`.
function record(ids, token, from, to, amount, extra = {}) {
  return api()
    .post(`/groups/${ids.group}/payments`)
    .set(auth(token))
    .send({ id: randomUUID(), from_member_id: ids[from], to_member_id: ids[to], amount, ...extra });
}

// `token` confirms / rejects / cancels a payment.
function answer(ids, token, paymentId, action) {
  return api().post(`/groups/${ids.group}/payments/${paymentId}/${action}`).set(auth(token));
}

async function balances(ids, token) {
  const res = await api().get(`/groups/${ids.group}/settle-up`).set(auth(token)).expect(200);
  return res.body.balances;
}

describe('recording a payment', () => {
  test('the payer records it → pending, and it does not count yet', async () => {
    const { ids, A, B } = await setup();
    const before = await balances(ids, A);

    const res = await record(ids, B, 'B', 'A', 100).expect(201);
    assert.equal(res.body.payment.status, 'pending');
    assert.equal(res.body.payment.confirmed_at, null);
    assert.equal(res.body.payment.created_by, ids.B);
    assert.ok(res.body.payment.created_at > 0);

    assert.deepEqual(await balances(ids, A), before);
  });

  test('the receiver confirms → confirmed, and now it counts', async () => {
    const { ids, A, B } = await setup();
    const before = await balances(ids, A);
    const made = await record(ids, B, 'B', 'A', 100).expect(201);

    const res = await answer(ids, A, made.body.payment.id, 'confirm').expect(200);
    assert.equal(res.body.payment.status, 'confirmed');
    assert.equal(res.body.payment.confirmed_by, 'receiver');
    assert.equal(res.body.payment.updated_by, ids.A);
    assert.ok(res.body.payment.confirmed_at >= res.body.payment.created_at);

    const now = await balances(ids, A);
    assert.equal(now[ids.B], before[ids.B] + 100);
    assert.equal(now[ids.A], before[ids.A] - 100);
  });

  test('the receiver recording "B paid me" is confirmed at once', async () => {
    const { ids, A } = await setup();
    const res = await record(ids, A, 'B', 'A', 100).expect(201);
    assert.equal(res.body.payment.status, 'confirmed');
    assert.equal(res.body.payment.confirmed_by, 'receiver');
  });

  test('partial payments: any whole amount above 0', async () => {
    const { ids, B } = await setup();
    await record(ids, B, 'B', 'A', 1).expect(201);
    await record(ids, B, 'B', 'A', 99999).expect(201);
    for (const amount of [0, -5, 12.5, '100']) {
      await record(ids, B, 'B', 'A', amount).expect(400);
    }
  });

  test('you can only record money you gave or got → 403', async () => {
    const { ids, A } = await setup();
    // A is the admin, but A is neither the payer nor the receiver here.
    const res = await record(ids, A, 'B', 'C', 100).expect(403);
    assert.match(res.body.error, /made or received/);
  });

  test('other checks: paying yourself, strangers, fund rules, duplicates', async () => {
    const { ids, B } = await setup();
    await record(ids, B, 'B', 'B', 100).expect(400);
    await api()
      .post(`/groups/${ids.group}/payments`)
      .set(auth(B))
      .send({ id: randomUUID(), from_member_id: ids.B, to_member_id: 'stranger', amount: 100 })
      .expect(400);
    await record(ids, B, 'B', 'D', 100).expect(400); // D was removed
    const fund = await record(ids, B, 'B', 'A', 100, { type: 'contribution' }).expect(400);
    assert.match(fund.body.error, /no fund/);

    const id = randomUUID();
    await record(ids, B, 'B', 'A', 100, { id }).expect(201);
    await record(ids, B, 'B', 'A', 100, { id }).expect(409);
  });

  test('outsiders → 403; no token → 401', async () => {
    const { ids } = await setup();
    const outsider = await createAccount();
    await record(ids, outsider.token, 'B', 'A', 100).expect(403);
    await api().post(`/groups/${ids.group}/payments`).send({}).expect(401);
  });
});

describe('who may confirm, reject or cancel', () => {
  test('someone other than the receiver trying to confirm → 403', async () => {
    const { group, ids, A, B } = await setup();
    const chand = await joinAs(group, 'C');
    const made = await record(ids, B, 'B', 'A', 100).expect(201);
    const id = made.body.payment.id;

    // A third member.
    const res = await answer(ids, chand.token, id, 'confirm').expect(403);
    assert.match(res.body.error, /Only A can confirm/);
    // The payer can't confirm their own payment.
    await answer(ids, B, id, 'confirm').expect(403);
    // Nor an outsider.
    const outsider = await createAccount();
    await answer(ids, outsider.token, id, 'confirm').expect(403);

    // Still pending; only the receiver can.
    assert.equal((await Payment.findById(id).lean()).status, 'pending');
    await answer(ids, A, id, 'confirm').expect(200);
  });

  test('an admin cannot confirm for a receiver who has an account → 403', async () => {
    const { group, ids, A, B } = await setup();
    const chand = await joinAs(group, 'C');
    const made = await record(ids, B, 'B', 'C', 100).expect(201);

    await answer(ids, A, made.body.payment.id, 'confirm').expect(403); // A is admin
    await answer(ids, A, made.body.payment.id, 'reject').expect(403);
    await answer(ids, chand.token, made.body.payment.id, 'confirm').expect(200);
  });

  test('receiver without an account: only an admin can confirm, saved as "admin"', async () => {
    const { ids, A, B } = await setup();
    const made = await record(ids, B, 'B', 'C', 100).expect(201); // C has no account
    const id = made.body.payment.id;

    // B is a normal member (and the payer) → can't.
    const res = await answer(ids, B, id, 'confirm').expect(403);
    assert.match(res.body.error, /only an admin/);

    const ok = await answer(ids, A, id, 'confirm').expect(200);
    assert.equal(ok.body.payment.status, 'confirmed');
    assert.equal(ok.body.payment.confirmed_by, 'admin');
    assert.equal(ok.body.payment.updated_by, ids.A); // which admin
  });

  test('receiver without an account: only an admin can reject', async () => {
    const { ids, A, B } = await setup();
    const made = await record(ids, B, 'B', 'C', 100).expect(201);
    await answer(ids, B, made.body.payment.id, 'reject').expect(403);
    const res = await answer(ids, A, made.body.payment.id, 'reject').expect(200);
    assert.equal(res.body.payment.status, 'rejected');
  });

  test('only the receiver can reject → 403 for the payer', async () => {
    const { ids, A, B } = await setup();
    const before = await balances(ids, A);
    const made = await record(ids, B, 'B', 'A', 100).expect(201);

    await answer(ids, B, made.body.payment.id, 'reject').expect(403);
    const res = await answer(ids, A, made.body.payment.id, 'reject').expect(200);
    assert.equal(res.body.payment.status, 'rejected');
    assert.deepEqual(await balances(ids, A), before); // never counted
  });

  test('only the payer can cancel → 403 for the receiver and others', async () => {
    const { group, ids, A, B } = await setup();
    const chand = await joinAs(group, 'C');
    const made = await record(ids, B, 'B', 'A', 100).expect(201);
    const id = made.body.payment.id;

    await answer(ids, A, id, 'cancel').expect(403); // the receiver (and admin)
    await answer(ids, chand.token, id, 'cancel').expect(403);
    const res = await answer(ids, B, id, 'cancel').expect(200);
    assert.equal(res.body.payment.status, 'cancelled');
  });

  test('only pending payments can be answered → 409', async () => {
    const { ids, A, B } = await setup();
    const made = await record(ids, B, 'B', 'A', 100).expect(201);
    const id = made.body.payment.id;
    await answer(ids, A, id, 'confirm').expect(200);

    const res = await answer(ids, A, id, 'confirm').expect(409);
    assert.match(res.body.error, /already confirmed/);
    await answer(ids, A, id, 'reject').expect(409);
    await answer(ids, B, id, 'cancel').expect(409); // can't cancel once confirmed
  });

  test('unknown payment, or one from another group → 404', async () => {
    const { ids, A } = await setup();
    const other = await setup();
    const theirs = await record(other.ids, other.B, 'B', 'A', 100).expect(201);
    await answer(ids, A, 'nope', 'confirm').expect(404);
    await answer(ids, A, theirs.body.payment.id, 'confirm').expect(404);
  });

  test('confirming bumps the seq, so other phones pull the new status', async () => {
    const { ids, A, B } = await setup();
    const made = await record(ids, B, 'B', 'A', 100).expect(201);
    const first = await api().get(`/groups/${ids.group}/changes`).set(auth(B)).expect(200);
    await answer(ids, A, made.body.payment.id, 'confirm').expect(200);

    const later = await api()
      .get(`/groups/${ids.group}/changes?since=${first.body.last_seq}`)
      .set(auth(B))
      .expect(200);
    assert.deepEqual(
      later.body.payments.map((p) => [p.id, p.status, p.confirmed_by]),
      [[made.body.payment.id, 'confirmed', 'receiver']]
    );
  });
});
