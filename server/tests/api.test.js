// api.test.js — tests every endpoint against a real (in-memory) MongoDB.
// Run with:  cd server && npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, sampleGroup, startTestDb, stopTestDb, uploadAndClaim } from './helpers.js';
import { createApp } from '../src/app.js';
import { Device, Expense, Group, Member, Payment } from '../src/models.js';
import { saveWithSeqs } from '../src/seq.js';
import { hashToken } from '../src/auth.js';

before(startTestDb);
after(stopTestDb);

describe('POST /groups', () => {
  test('saves the group and returns an invite code like YAR-K7QM-3XHP', async () => {
    const { ids, body } = sampleGroup();
    const res = await api().post('/groups').send(body).expect(201);

    // 8 characters, none of the easily confused 0, O, 1, I, L.
    assert.match(res.body.invite_code, /^YAR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
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

  test('each group counts its own seq numbers: 1, 2, 3, ...', async () => {
    const { ids, body } = sampleGroup();
    await api().post('/groups').send(body).expect(201);

    // 4 members + 2 expenses + 1 payment + the group = seq 1 to 8.
    const group = await Group.findById(ids.group).lean();
    const docs = [
      group,
      ...(await Member.find({ group_id: ids.group }).lean()),
      ...(await Expense.find({ group_id: ids.group }).lean()),
      ...(await Payment.find({ group_id: ids.group }).lean()),
    ];
    assert.deepEqual(
      docs.map((d) => d.seq).sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8]
    );
    // The group is saved last, so it gets the highest number.
    assert.equal(group.seq, 8);
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

    // Typed sloppily on purpose: lower case, spaces instead of dashes.
    const code = ` ${upload.body.invite_code.toLowerCase().replaceAll('-', ' ')} `;
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
    await api().post('/join').send({ invite_code: 'YAR-XXXX-XXXX' }).expect(404);
    await api().post('/join').send({ invite_code: 'YAR-1234' }).expect(404); // old short style
    await api().post('/join').send({ invite_code: { $ne: '' } }).expect(404); // not text
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

  test('records each claim, marking a second phone for the same member', async () => {
    const { ids, inviteCode, token } = await uploadAndClaim(); // A's first phone
    await api().post('/claim').send({ invite_code: inviteCode, member_id: ids.B }).expect(201);
    await api().post('/claim').send({ invite_code: inviteCode, member_id: ids.A }).expect(201);

    // Other phones see the claims in /changes, in order, so the app can say
    // "A new phone joined as A".
    const res = await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    assert.deepEqual(
      res.body.devices.map((d) => [d.member_id, d.already_claimed]),
      [
        [ids.A, 0], // A's first phone
        [ids.B, 0], // B's first phone
        [ids.A, 1], // A AGAIN: a new phone for someone who already had one
      ]
    );
  });

  test('two claims of the same member at once: only one is the "first"', async () => {
    const { ids, body } = sampleGroup();
    const upload = await api().post('/groups').send(body).expect(201);
    const claim = () =>
      api().post('/claim').send({ invite_code: upload.body.invite_code, member_id: ids.C });
    await Promise.all([claim().expect(201), claim().expect(201), claim().expect(201)]);

    const devices = await Device.find({ member_id: ids.C }).lean();
    assert.deepEqual(
      devices.map((d) => d.already_claimed).sort(),
      [0, 1, 1]
    );
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
    assert.equal(res.body.has_more, false);

    // The claim of A shows up as a device — without its token hash.
    assert.equal(res.body.devices.length, 1);
    assert.equal(res.body.devices[0].member_id, ids.A);
    assert.equal(res.body.devices[0].token_hash, undefined);

    // last_seq is the biggest seq in the reply.
    const all = [
      res.body.group,
      ...res.body.members,
      ...res.body.expenses,
      ...res.body.payments,
      ...res.body.devices,
    ];
    assert.equal(res.body.last_seq, Math.max(...all.map((d) => d.seq)));
  });

  test('soft-deleted rows (deleted: 1) are sent too, so phones learn about deletions', async () => {
    const { ids, body } = sampleGroup(); // member D is already deleted
    body.expenses[1].deleted = 1;
    body.payments[0].deleted = 1;
    const upload = await api().post('/groups').send(body).expect(201);
    const claim = await api()
      .post('/claim')
      .send({ invite_code: upload.body.invite_code, member_id: ids.A })
      .expect(201);

    const res = await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', `Bearer ${claim.body.token}`)
      .expect(200);

    const byId = (list, id) => list.find((row) => row.id === id);
    assert.equal(byId(res.body.members, ids.D).deleted, 1);
    assert.equal(byId(res.body.expenses, body.expenses[1].id).deleted, 1);
    assert.equal(byId(res.body.payments, body.payments[0].id).deleted, 1);
    // ...next to the live ones.
    assert.equal(byId(res.body.members, ids.A).deleted, 0);
    assert.equal(byId(res.body.expenses, body.expenses[0].id).deleted, 0);

    // A row deleted LATER (deleted 0 → 1 with a new seq) shows up when
    // pulling from the old last_seq.
    // (Done the way the future sync endpoint will: through saveWithSeqs.)
    const before = res.body.last_seq;
    await saveWithSeqs(ids.group, 1, ([seq], session) =>
      Expense.updateOne(
        { _id: body.expenses[0].id },
        { $set: { deleted: 1, updated_at: Date.now(), seq } },
        { session }
      )
    );

    const later = await api()
      .get(`/groups/${ids.group}/changes?since=${before}`)
      .set('Authorization', `Bearer ${claim.body.token}`)
      .expect(200);
    assert.deepEqual(
      later.body.expenses.map((e) => [e.id, e.deleted]),
      [[body.expenses[0].id, 1]]
    );
    assert.equal(later.body.last_seq, before + 1);
  });

  test('pages: ?limit=N returns N at a time, in seq order, with has_more', async () => {
    const { ids, token } = await uploadAndClaim(); // 8 uploaded + 1 device = 9

    const seen = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const res = await api()
        .get(`/groups/${ids.group}/changes?since=${since}&limit=4`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      pages++;
      const rows = [
        ...(res.body.group ? [res.body.group] : []),
        ...res.body.members,
        ...res.body.expenses,
        ...res.body.payments,
        ...res.body.devices,
      ];
      assert.ok(rows.length <= 4);
      seen.push(...rows.map((r) => r.seq));
      since = res.body.last_seq;
      if (!res.body.has_more) break;
    }

    assert.equal(pages, 3); // 4 + 4 + 1
    assert.deepEqual(
      seen.sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9]
    );
  });

  test('rejects a bad limit', async () => {
    const { ids, token } = await uploadAndClaim();
    for (const limit of ['0', '-1', 'abc', '1001']) {
      await api()
        .get(`/groups/${ids.group}/changes?limit=${limit}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    }
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

describe('rate limiting on /join and /claim', () => {
  test('the 11th try in a minute from one IP gets 429', async () => {
    const app = createApp(); // one app, so the counts carry across requests
    for (let i = 0; i < 10; i++) {
      await api(app).post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(404);
    }
    const res = await api(app).post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(429);
    assert.match(res.body.error, /Too many tries/);
    assert.ok(Number(res.headers['retry-after']) > 0);

    // /claim counts separately, and has the same limit.
    for (let i = 0; i < 10; i++) {
      await api(app).post('/claim').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(404);
    }
    await api(app).post('/claim').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(429);
  });

  test('counts each IP separately (behind Render, from X-Forwarded-For)', async () => {
    const app = createApp({ rateLimit: { max: 2, windowMs: 60000 } });
    const join = (ip) =>
      api(app).post('/join').set('X-Forwarded-For', ip).send({ invite_code: 'YAR-AAAA-AAAA' });
    await join('1.1.1.1').expect(404);
    await join('1.1.1.1').expect(404);
    await join('1.1.1.1').expect(429);
    await join('2.2.2.2').expect(404); // a different phone is not blocked
  });

  test('the limit resets after the window', async () => {
    const app = createApp({ rateLimit: { max: 1, windowMs: 50 } });
    await api(app).post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(404);
    await api(app).post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(429);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await api(app).post('/join').send({ invite_code: 'YAR-AAAA-AAAA' }).expect(404);
  });
});

describe('POST /groups/:groupId/new-invite-code (needs a token)', () => {
  test('replaces the code: the old one stops working, the new one works', async () => {
    const { ids, inviteCode, token } = await uploadAndClaim();
    const res = await api()
      .post(`/groups/${ids.group}/new-invite-code`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const newCode = res.body.invite_code;
    assert.match(newCode, /^YAR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    assert.notEqual(newCode, inviteCode);

    await api().post('/join').send({ invite_code: inviteCode }).expect(404);
    await api().post('/claim').send({ invite_code: inviteCode, member_id: ids.B }).expect(404);
    const join = await api().post('/join').send({ invite_code: newCode }).expect(200);
    assert.equal(join.body.group.id, ids.group);

    // Phones that already joined keep working with their tokens.
    await api()
      .get(`/groups/${ids.group}/changes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  test('needs a token for THAT group', async () => {
    const { ids } = await uploadAndClaim();
    const { token: otherToken } = await uploadAndClaim();
    await api().post(`/groups/${ids.group}/new-invite-code`).expect(401);
    await api()
      .post(`/groups/${ids.group}/new-invite-code`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403);
  });
});

test('health check and unknown routes', async () => {
  const res = await api().get('/').expect(200);
  assert.equal(res.body.ok, true);
  await api().get('/nope').expect(404);
});
