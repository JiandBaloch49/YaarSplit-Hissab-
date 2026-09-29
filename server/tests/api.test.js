// api.test.js — tests every endpoint against a real (in-memory) MongoDB.
// Run with:  cd server && npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, sampleGroup, startTestDb, stopTestDb, uploadAndClaim } from './helpers.js';
import { Device, Expense, Group, Member, Payment } from '../src/models.js';
import { hashToken } from '../src/auth.js';

before(startTestDb);
after(stopTestDb);

describe('POST /groups', () => {
  test('saves the group and returns an invite code like YAR-1234', async () => {
    const { ids, body } = sampleGroup();
    const res = await api().post('/groups').send(body).expect(201);

    assert.match(res.body.invite_code, /^YAR-\d{4}$/);
    assert.equal(res.body.group_id, ids.group);

    // Stored under the app's own UUIDs.
    const group = await Group.findById(ids.group).lean();
    assert.equal(group.name, 'Kund Malir trip');
    assert.equal(group.invite_code, res.body.invite_code);
    assert.equal(await Member.countDocuments({ group_id: ids.group }), 4);
    assert.equal(await Expense.countDocuments({ group_id: ids.group }), 2);
    assert.equal(await Payment.countDocuments({ group_id: ids.group }), 1);

    // Every document got its own seq number, and none of them repeat.
    const docs = [
      group,
      ...(await Member.find({ group_id: ids.group }).lean()),
      ...(await Expense.find({ group_id: ids.group }).lean()),
      ...(await Payment.find({ group_id: ids.group }).lean()),
    ];
    const seqs = docs.map((d) => d.seq);
    assert.ok(seqs.every((s) => Number.isInteger(s) && s > 0));
    assert.equal(new Set(seqs).size, seqs.length);
  });

  test('a second upload gets higher seq numbers than the first', async () => {
    const first = sampleGroup();
    const second = sampleGroup();
    await api().post('/groups').send(first.body).expect(201);
    await api().post('/groups').send(second.body).expect(201);

    const firstGroup = await Group.findById(first.ids.group).lean();
    const secondGroup = await Group.findById(second.ids.group).lean();
    assert.ok(secondGroup.seq > firstGroup.seq);
  });

  test('uploading the same group twice is refused', async () => {
    const { body } = sampleGroup();
    await api().post('/groups').send(body).expect(201);
    const res = await api().post('/groups').send(body).expect(409);
    assert.match(res.body.error, /already uploaded/);
  });

  test("rejects an expense whose payers don't add up (prepareExpense check)", async () => {
    const { ids, body } = sampleGroup();
    body.expenses[0].payers = [{ member_id: body.members[0].id, amount: 900 }];

    const res = await api().post('/groups').send(body).expect(400);
    assert.ok(
      res.body.errors.includes(
        'expenses[0]: Payers add up to 900 but the total is 1000 (100 short).'
      )
    );
    // Nothing at all was saved.
    assert.equal(await Group.exists({ _id: ids.group }), null);
    assert.equal(await Member.countDocuments({ group_id: ids.group }), 0);
  });

  test('rejects decimal rupees and custom shares that miss the total', async () => {
    const { body } = sampleGroup();
    body.expenses[0].amount = 999.5;
    body.expenses[1].participants[1].share = 40; // 100 + 40 = 140, not 150

    const res = await api().post('/groups').send(body).expect(400);
    assert.ok(
      res.body.errors.includes('expenses[0]: Total must be a whole number of rupees, more than 0.')
    );
    assert.ok(
      res.body.errors.includes(
        'expenses[1]: Shares add up to 140 but the total is 150 (10 short).'
      )
    );
  });

  test('rejects an expense that mentions someone outside the group', async () => {
    const { body } = sampleGroup();
    body.expenses[0].participants[2].member_id = 'stranger';

    const res = await api().post('/groups').send(body).expect(400);
    assert.ok(res.body.errors.includes('expenses[0]: stranger is not a member of this group.'));
  });

  test('rejects a bad payment type and a zero payment', async () => {
    const { body } = sampleGroup();
    body.payments[0].type = 'gift';
    body.payments[0].amount = 0;

    const res = await api().post('/groups').send(body).expect(400);
    assert.ok(
      res.body.errors.includes('payments[0]: type must be one of: settlement, contribution, return.')
    );
    assert.ok(
      res.body.errors.includes(
        'payments[0]: amount must be a whole number of rupees, more than 0.'
      )
    );
  });

  test('stores freshly calculated shares for equal splits', async () => {
    const { ids, body } = sampleGroup();
    // Wrong shares sent for an equal split: the server works them out itself.
    body.expenses[0].participants = body.expenses[0].participants.map((p) => ({
      member_id: p.member_id,
      share: 1,
    }));
    await api().post('/groups').send(body).expect(201);

    const saved = await Expense.findById(body.expenses[0].id).lean();
    assert.deepEqual(
      saved.participants.map((p) => p.share),
      [334, 333, 333]
    );
    assert.equal(saved.group_id, ids.group);
  });
});

describe('POST /join', () => {
  test('returns the group and its live members', async () => {
    const { ids, body } = sampleGroup();
    const upload = await api().post('/groups').send(body).expect(201);

    // Typed sloppily on purpose: lower case and spaces still work.
    const code = ` ${upload.body.invite_code.toLowerCase()} `;
    const res = await api().post('/join').send({ invite_code: code }).expect(200);

    assert.equal(res.body.group.id, ids.group);
    assert.equal(res.body.group.name, 'Kund Malir trip');
    // D was deleted, so only A, B, C — nobody has claimed them yet.
    assert.deepEqual(
      res.body.members.map((m) => [m.name, m.claimed]),
      [
        ['A', false],
        ['B', false],
        ['C', false],
      ]
    );
  });

  test('shows who is already claimed', async () => {
    const { inviteCode } = await uploadAndClaim(); // claims A
    const res = await api().post('/join').send({ invite_code: inviteCode }).expect(200);
    assert.deepEqual(
      res.body.members.map((m) => m.claimed),
      [true, false, false]
    );
  });

  test('unknown invite code → 404', async () => {
    await api().post('/join').send({ invite_code: 'YAR-XXXX' }).expect(404);
  });
});

describe('POST /claim', () => {
  test('returns a secret token; the server keeps only its hash', async () => {
    const { ids, inviteCode, token } = await uploadAndClaim();
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 40);

    const device = await Device.findOne({ member_id: ids.A }).lean();
    assert.equal(device.group_id, ids.group);
    assert.equal(device.token_hash, hashToken(token));
    // The token itself appears nowhere in the stored document.
    assert.ok(!JSON.stringify(device).includes(token));

    // Claiming again (e.g. a new phone) gives a different token.
    const again = await api()
      .post('/claim')
      .send({ invite_code: inviteCode, member_id: ids.A })
      .expect(201);
    assert.notEqual(again.body.token, token);
  });

  test("can't claim a member of another group, or a deleted member", async () => {
    const mine = sampleGroup();
    const other = sampleGroup();
    const upload = await api().post('/groups').send(mine.body).expect(201);
    await api().post('/groups').send(other.body).expect(201);

    const code = upload.body.invite_code;
    await api().post('/claim').send({ invite_code: code, member_id: other.ids.A }).expect(404);
    await api().post('/claim').send({ invite_code: code, member_id: mine.ids.D }).expect(404);
  });

  test('rejects a member_id that is not plain text', async () => {
    const { body } = sampleGroup();
    const upload = await api().post('/groups').send(body).expect(201);
    await api()
      .post('/claim')
      .send({ invite_code: upload.body.invite_code, member_id: { $ne: '' } })
      .expect(400);
  });
});

describe('GET /groups/:groupId/changes (needs a token)', () => {
  test('no token → 401, made-up token → 401', async () => {
    const { ids } = await uploadAndClaim();
    await api().get(`/groups/${ids.group}/changes`).expect(401);
    await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  test("a token for one group can't read another group → 403", async () => {
    const { token } = await uploadAndClaim();
    const { ids: otherIds } = await uploadAndClaim();
    await api()
      .get(`/groups/${otherIds.group}/changes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  test('returns everything, including deleted rows, with the app ids', async () => {
    const { ids, token } = await uploadAndClaim();
    const res = await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    assert.equal(res.body.group.id, ids.group);
    assert.equal(res.body.group.invite_code, undefined);
    assert.equal(res.body.members.length, 4); // D (deleted) too
    assert.equal(res.body.expenses.length, 2);
    assert.equal(res.body.payments.length, 1);
    assert.equal(res.body.expenses[0].payers[0].member_id, ids.A);

    // last_seq is the biggest seq in the reply.
    const all = [res.body.group, ...res.body.members, ...res.body.expenses, ...res.body.payments];
    assert.equal(res.body.last_seq, Math.max(...all.map((d) => d.seq)));
  });

  test('since=<last_seq> returns nothing when nothing changed', async () => {
    const { ids, token } = await uploadAndClaim();
    const first = await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const res = await api()
      .get(`/groups/${ids.group}/changes?since=${first.body.last_seq}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.equal(res.body.group, null);
    assert.equal(res.body.members.length, 0);
    assert.equal(res.body.expenses.length, 0);
    assert.equal(res.body.payments.length, 0);
    assert.equal(res.body.last_seq, first.body.last_seq);
  });
});

test('health check and unknown routes', async () => {
  const res = await api().get('/').expect(200);
  assert.equal(res.body.ok, true);
  await api().get('/nope').expect(404);
});
