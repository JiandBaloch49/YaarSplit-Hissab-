// api.test.js — accounts, uploading groups, and pulling /changes, against a
// real (in-memory) MongoDB. Invites, payments, expenses and roles have their
// own test files.
// Run with:  cd server && npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  api,
  auth,
  createAccount,
  joinAs,
  sampleGroup,
  startTestDb,
  stopTestDb,
  testDbUri,
  uploadGroup,
} from './helpers.js';
import { createApp } from '../src/app.js';
import { Account, Device, Expense, Group, Member, Payment } from '../src/models.js';
import { hashToken } from '../src/auth.js';

before(startTestDb);
after(stopTestDb);

describe('POST /accounts', () => {
  test('makes an account and a token; the server keeps only the hash', async () => {
    const res = await api()
      .post('/accounts')
      .send({ name: ' Nisar ', username: '@Nisar_1' })
      .expect(201);

    // "@" and capitals are tidied away.
    assert.deepEqual(
      { name: res.body.account.name, username: res.body.account.username },
      { name: 'Nisar', username: 'nisar_1' }
    );
    const token = res.body.token;
    assert.ok(token.length >= 40);

    const device = await Device.findById(res.body.device_id).lean();
    assert.equal(device.account_id, res.body.account.id);
    assert.equal(device.token_hash, hashToken(token));
    assert.ok(!JSON.stringify(device).includes(token));

    // The token works.
    const me = await api().get('/me').set(auth(token)).expect(200);
    assert.equal(me.body.account.username, 'nisar_1');
    assert.deepEqual(me.body.groups, []);
  });

  test('usernames are unique, whatever the capitals', async () => {
    await api().post('/accounts').send({ name: 'Bilal', username: 'bilal' }).expect(201);
    const res = await api().post('/accounts').send({ name: 'Other', username: '@BILAL' }).expect(409);
    assert.match(res.body.error, /@bilal is taken/);
    assert.equal(await Account.countDocuments({ username: 'bilal' }), 1);
  });

  test('rejects bad names and usernames', async () => {
    for (const username of ['ab', 'has space', 'way_too_long_username_here', 'dash-ed', '', { $ne: '' }]) {
      await api().post('/accounts').send({ name: 'X', username }).expect(400);
    }
    await api().post('/accounts').send({ name: '  ', username: 'okname' }).expect(400);
  });

  test('no token or a made-up token → 401', async () => {
    await api().get('/me').expect(401);
    await api().get('/me').set(auth('not-a-real-token')).expect(401);
  });

  test('sign-ups are rate limited per IP', async () => {
    const app = createApp({ rateLimit: { max: 2, windowMs: 60000 } });
    const signUp = (username, ip) =>
      api(app).post('/accounts').set('X-Forwarded-For', ip).send({ name: 'X', username });
    await signUp('rl_one', '1.1.1.1').expect(201);
    await signUp('rl_two', '1.1.1.1').expect(201);
    const res = await signUp('rl_three', '1.1.1.1').expect(429);
    assert.ok(Number(res.headers['retry-after']) > 0);
    await signUp('rl_four', '2.2.2.2').expect(201); // a different phone is not blocked
  });
});

describe('POST /groups', () => {
  test('needs an account', async () => {
    await api().post('/groups').send(sampleGroup().body).expect(401);
  });

  test('saves the group; the uploader becomes its admin', async () => {
    const { ids, admin } = await uploadGroup();

    const group = await Group.findById(ids.group).lean();
    assert.equal(group.name, 'Kund Malir trip');
    assert.equal(group.simplify_debts, 1); // on by default
    assert.equal(group.invite_code, undefined); // no open invite codes any more

    const members = await Member.find({ group_id: ids.group }).lean();
    const a = members.find((m) => m._id === ids.A);
    assert.deepEqual(
      [a.account_id, a.username, a.role],
      [admin.account.id, admin.account.username, 'admin']
    );
    // Everyone else is an empty slot until they accept an invite.
    for (const m of members.filter((m) => m._id !== ids.A)) {
      assert.deepEqual([m.account_id, m.role], [null, 'member']);
    }

    // Everything uploaded was made by A.
    const expenses = await Expense.find({ group_id: ids.group }).lean();
    assert.ok(expenses.every((e) => e.created_by === ids.A && e.updated_by === ids.A));

    // Old payments come in confirmed by the admin (nobody had accounts then).
    const [payment] = await Payment.find({ group_id: ids.group }).lean();
    assert.equal(payment.status, 'confirmed');
    assert.equal(payment.confirmed_by, 'admin');
    assert.ok(payment.confirmed_at > 0);

    // It shows up in GET /me.
    const me = await api().get('/me').set(auth(admin.token)).expect(200);
    assert.deepEqual(me.body.groups, [
      { group_id: ids.group, name: 'Kund Malir trip', member_id: ids.A, role: 'admin' },
    ]);
  });

  test('each group counts its own seq numbers: 1, 2, 3, ...', async () => {
    const { ids } = await uploadGroup();
    // 4 members + 2 expenses + 1 payment + the group = seq 1 to 8.
    const docs = [
      await Group.findById(ids.group).lean(),
      ...(await Member.find({ group_id: ids.group }).lean()),
      ...(await Expense.find({ group_id: ids.group }).lean()),
      ...(await Payment.find({ group_id: ids.group }).lean()),
    ];
    assert.deepEqual(
      docs.map((d) => d.seq).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
  });

  test('uploading the same group twice is refused', async () => {
    const { body, token } = await uploadGroup();
    const res = await api().post('/groups').set(auth(token)).send(body).expect(409);
    assert.match(res.body.error, /already uploaded/);
  });

  test('my_member_id must be a live member', async () => {
    const { token } = await createAccount();
    for (const pick of [undefined, 'stranger', 'D']) {
      const { ids, body } = sampleGroup();
      body.my_member_id = pick === 'D' ? ids.D : pick; // D was removed
      const res = await api().post('/groups').set(auth(token)).send(body).expect(400);
      assert.ok(res.body.errors.includes('my_member_id must be one of the live members.'));
    }
  });

  test("rejects an expense whose payers don't add up (prepareExpense check)", async () => {
    const { token } = await createAccount();
    const { ids, body } = sampleGroup();
    body.expenses[0].payers = [{ member_id: body.members[0].id, amount: 900 }];

    const res = await api().post('/groups').set(auth(token)).send(body).expect(400);
    assert.ok(
      res.body.errors.includes('expenses[0]: Payers add up to 900 but the total is 1000 (100 short).')
    );
    // Nothing at all was saved.
    assert.equal(await Group.exists({ _id: ids.group }), null);
    assert.equal(await Member.countDocuments({ group_id: ids.group }), 0);
  });

  test('rejects decimal rupees, bad shares, strangers and bad payments', async () => {
    const { token } = await createAccount();
    const { body } = sampleGroup();
    body.expenses[0].amount = 999.5;
    body.expenses[1].participants[1].share = 40; // 100 + 40 = 140, not 150
    body.payments[0].type = 'gift';
    body.payments[0].amount = 0;

    const res = await api().post('/groups').set(auth(token)).send(body).expect(400);
    for (const message of [
      'expenses[0]: Total must be a whole number of rupees, more than 0.',
      'expenses[1]: Shares add up to 140 but the total is 150 (10 short).',
      'payments[0]: type must be one of: settlement, contribution, return.',
      'payments[0]: amount must be a whole number of rupees, more than 0.',
    ]) {
      assert.ok(res.body.errors.includes(message), message);
    }

    const other = sampleGroup();
    other.body.expenses[0].participants[2].member_id = 'stranger';
    const res2 = await api().post('/groups').set(auth(token)).send(other.body).expect(400);
    assert.ok(res2.body.errors.includes('expenses[0]: stranger is not a member of this group.'));

    const third = sampleGroup();
    third.body.group.simplify_debts = 'yes';
    const res3 = await api().post('/groups').set(auth(token)).send(third.body).expect(400);
    assert.deepEqual(res3.body.errors, ['group: simplify_debts must be 0 or 1.']);
  });

  test('stores freshly calculated shares for equal splits', async () => {
    const { token } = await createAccount();
    const { body } = sampleGroup();
    // Wrong shares sent for an equal split: the server works them out itself.
    body.expenses[0].participants = body.expenses[0].participants.map((p) => ({
      member_id: p.member_id,
      share: 1,
    }));
    await api().post('/groups').set(auth(token)).send(body).expect(201);

    const saved = await Expense.findById(body.expenses[0].id).lean();
    assert.deepEqual(
      saved.participants.map((p) => p.share),
      [334, 333, 333]
    );
  });
});

describe('GET /groups/:groupId/changes', () => {
  test('no token → 401; an account that is not in the group → 403', async () => {
    const { ids } = await uploadGroup();
    const outsider = await createAccount();
    await api().get(`/groups/${ids.group}/changes`).expect(401);
    await api().get(`/groups/${ids.group}/changes`).set(auth(outsider.token)).expect(403);
    await api().get('/groups/no-such-group/changes').set(auth(outsider.token)).expect(404);
  });

  test('returns everything, including deleted rows, with the app ids', async () => {
    const { ids, token, admin } = await uploadGroup();
    const res = await api().get(`/groups/${ids.group}/changes`).set(auth(token)).expect(200);

    assert.equal(res.body.group.id, ids.group);
    assert.equal(res.body.group.simplify_debts, 1);
    assert.equal(res.body.members.length, 4); // D (deleted) too
    assert.equal(res.body.expenses.length, 2);
    assert.equal(res.body.payments.length, 1);
    assert.equal(res.body.expenses[0].payers[0].member_id, ids.A);
    assert.equal(res.body.payments[0].status, 'confirmed');
    assert.equal(res.body.has_more, false);

    // Members carry their account link and role.
    const a = res.body.members.find((m) => m.id === ids.A);
    assert.deepEqual([a.username, a.role], [admin.account.username, 'admin']);

    const all = [res.body.group, ...res.body.members, ...res.body.expenses, ...res.body.payments];
    assert.equal(res.body.last_seq, Math.max(...all.map((d) => d.seq)));
  });

  test('soft-deleted rows (deleted: 1) are sent too, so phones learn about deletions', async () => {
    const { token } = await createAccount();
    const { ids, body } = sampleGroup(); // member D is already deleted
    body.expenses[1].deleted = 1;
    body.payments[0].deleted = 1;
    await api().post('/groups').set(auth(token)).send(body).expect(201);

    const res = await api().get(`/groups/${ids.group}/changes`).set(auth(token)).expect(200);
    const byId = (list, id) => list.find((row) => row.id === id);
    assert.equal(byId(res.body.members, ids.D).deleted, 1);
    assert.equal(byId(res.body.expenses, body.expenses[1].id).deleted, 1);
    assert.equal(byId(res.body.payments, body.payments[0].id).deleted, 1);
    assert.equal(byId(res.body.expenses, body.expenses[0].id).deleted, 0);

    // A row deleted LATER (through the API: deleted 0 → 1 with a new seq)
    // shows up when pulling from the old last_seq.
    const before = res.body.last_seq;
    await api()
      .delete(`/groups/${ids.group}/expenses/${body.expenses[0].id}`)
      .set(auth(token))
      .expect(200);

    const later = await api()
      .get(`/groups/${ids.group}/changes?since=${before}`)
      .set(auth(token))
      .expect(200);
    assert.deepEqual(
      later.body.expenses.map((e) => [e.id, e.deleted, e.updated_by]),
      [[body.expenses[0].id, 1, ids.A]]
    );
    assert.equal(later.body.last_seq, before + 1);
    // Still there in the database: soft delete only.
    assert.ok(await Expense.exists({ _id: body.expenses[0].id }));
  });

  test('a friend joining shows up as a member change', async () => {
    const group = await uploadGroup();
    const first = await api().get(`/groups/${group.ids.group}/changes`).set(auth(group.token)).expect(200);
    const bilal = await joinAs(group, 'B');

    const later = await api()
      .get(`/groups/${group.ids.group}/changes?since=${first.body.last_seq}`)
      .set(auth(group.token))
      .expect(200);
    assert.deepEqual(
      later.body.members.map((m) => [m.id, m.username, m.role]),
      [[group.ids.B, bilal.account.username, 'member']]
    );
  });

  test('pages: ?limit=N returns N at a time, in seq order, with has_more', async () => {
    const { ids, token } = await uploadGroup(); // 8 documents

    const seen = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const res = await api()
        .get(`/groups/${ids.group}/changes?since=${since}&limit=3`)
        .set(auth(token))
        .expect(200);
      pages++;
      const rows = [
        ...(res.body.group ? [res.body.group] : []),
        ...res.body.members,
        ...res.body.expenses,
        ...res.body.payments,
      ];
      assert.ok(rows.length <= 3);
      seen.push(...rows.map((r) => r.seq));
      since = res.body.last_seq;
      if (!res.body.has_more) break;
    }

    assert.equal(pages, 3); // 3 + 3 + 2
    assert.deepEqual(
      seen.sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
  });

  test('rejects a bad limit', async () => {
    const { ids, token } = await uploadGroup();
    for (const limit of ['0', '-1', 'abc', '1001']) {
      await api().get(`/groups/${ids.group}/changes?limit=${limit}`).set(auth(token)).expect(400);
    }
  });

  test('since=<last_seq> returns nothing when nothing changed', async () => {
    const { ids, token } = await uploadGroup();
    const first = await api().get(`/groups/${ids.group}/changes`).set(auth(token)).expect(200);
    const res = await api()
      .get(`/groups/${ids.group}/changes?since=${first.body.last_seq}`)
      .set(auth(token))
      .expect(200);
    assert.equal(res.body.group, null);
    assert.equal(res.body.members.length + res.body.expenses.length + res.body.payments.length, 0);
    assert.equal(res.body.last_seq, first.body.last_seq);
  });
});

test('the old open flows are gone: /join and /claim → 404', async () => {
  await api().post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(404);
  await api().post('/claim').send({ invite_code: 'YAR-AAAA-AAAA', member_id: 'x' }).expect(404);
});

test('health check and unknown routes', async () => {
  const res = await api().get('/').expect(200);
  assert.equal(res.body.ok, true);
  await api().get('/nope').expect(404);
});

test('GET /health pings the database', async () => {
  const res = await api().get('/health').expect(200);
  assert.deepEqual(res.body, { ok: true });

  // With the database gone, it must say so (Render watches for this).
  await mongoose.disconnect();
  try {
    const down = await api().get('/health').expect(503);
    assert.equal(down.body.ok, false);
  } finally {
    await mongoose.connect(testDbUri());
  }
});
