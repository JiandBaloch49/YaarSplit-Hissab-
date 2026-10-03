// invites.test.js — inviting friends into a group, by username or link.
// Run with:  cd server && npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, createAccount, joinAs, startTestDb, stopTestDb, uploadGroup } from './helpers.js';
import { createApp } from '../src/app.js';
import { Invite, Member } from '../src/models.js';

before(startTestDb);
after(stopTestDb);

// Admin (token) invites member `letter` by username, or by link if no username.
function invite(group, letter, username, token = group.token) {
  return api()
    .post(`/groups/${group.ids.group}/invites`)
    .set(auth(token))
    .send({ member_id: group.ids[letter], ...(username ? { username } : {}) });
}

describe('invite by username', () => {
  test('shows up in GET /me/invites; accepting links the account to that member', async () => {
    const group = await uploadGroup();
    const nisar = await createAccount('Nisar');

    const made = await invite(group, 'B', `@${nisar.account.username.toUpperCase()}`).expect(201);
    assert.equal(made.body.invite.kind, 'username');
    assert.equal(made.body.code, undefined); // no code for username invites
    assert.equal(made.body.invite.code_hash, undefined);
    // Expires in 7 days.
    const days = (made.body.invite.expires_at - made.body.invite.created_at) / 86400000;
    assert.equal(days, 7);

    const mine = await api().get('/me/invites').set(auth(nisar.token)).expect(200);
    assert.deepEqual(
      mine.body.invites.map((i) => [i.id, i.group_name, i.member_name, i.invited_by_name]),
      [[made.body.invite.id, 'Kund Malir trip', 'B', 'A']]
    );

    // Before accepting, Nisar can't see the group.
    await api().get(`/groups/${group.ids.group}/changes`).set(auth(nisar.token)).expect(403);

    const accepted = await api()
      .post(`/invites/${made.body.invite.id}/accept`)
      .set(auth(nisar.token))
      .expect(200);
    assert.equal(accepted.body.member.id, group.ids.B);
    assert.equal(accepted.body.member.account_id, nisar.account.id);
    assert.equal(accepted.body.member.role, 'member');

    // Now Nisar is in, as B, with B's whole past: B is in both old expenses.
    await api().get(`/groups/${group.ids.group}/changes`).set(auth(nisar.token)).expect(200);
    const settle = await api().get(`/groups/${group.ids.group}/settle-up`).set(auth(nisar.token)).expect(200);
    // B: paid 150 for tea, owes 333 (dinner) + 100 (tea) → -283.
    assert.equal(settle.body.balances[group.ids.B], -283);

    // The invite is used up, and no longer listed.
    const after = await api().get('/me/invites').set(auth(nisar.token)).expect(200);
    assert.deepEqual(after.body.invites, []);
    assert.equal((await Invite.findById(made.body.invite.id).lean()).status, 'accepted');
  });

  test('someone else cannot accept or decline it → 403', async () => {
    const group = await uploadGroup();
    const nisar = await createAccount('Nisar');
    const sneaky = await createAccount('Sneaky');
    const made = await invite(group, 'B', nisar.account.username).expect(201);

    await api().post(`/invites/${made.body.invite.id}/accept`).set(auth(sneaky.token)).expect(403);
    await api().post(`/invites/${made.body.invite.id}/decline`).set(auth(sneaky.token)).expect(403);
    await api().get(`/invites/${made.body.invite.id}`).set(auth(sneaky.token)).expect(403);
    assert.equal((await Member.findById(group.ids.B).lean()).account_id, null);
  });

  test('declining: the invite cannot be accepted afterwards', async () => {
    const group = await uploadGroup();
    const nisar = await createAccount('Nisar');
    const made = await invite(group, 'B', nisar.account.username).expect(201);

    const declined = await api()
      .post(`/invites/${made.body.invite.id}/decline`)
      .set(auth(nisar.token))
      .expect(200);
    assert.equal(declined.body.invite.status, 'declined');

    const res = await api().post(`/invites/${made.body.invite.id}/accept`).set(auth(nisar.token)).expect(409);
    assert.match(res.body.error, /already declined/);
  });

  test('unknown username → 404; already in the group → 409; slot taken → 409', async () => {
    const group = await uploadGroup();
    await invite(group, 'B', 'nobody_here').expect(404);

    const bilal = await joinAs(group, 'B');
    // Bilal is already in (as B), so he can't be invited as C too.
    await invite(group, 'C', bilal.account.username).expect(409);
    // B's slot is taken.
    const other = await createAccount();
    await invite(group, 'B', other.account.username).expect(409);
    // A deleted member can't be invited.
    await api()
      .post(`/groups/${group.ids.group}/invites`)
      .set(auth(group.token))
      .send({ member_id: group.ids.D })
      .expect(404);
  });

  test('one account can only take one slot in a group', async () => {
    const group = await uploadGroup();
    const nisar = await createAccount('Nisar');
    const forB = await invite(group, 'B', nisar.account.username).expect(201);
    const forC = await invite(group, 'C', nisar.account.username).expect(201);

    await api().post(`/invites/${forB.body.invite.id}/accept`).set(auth(nisar.token)).expect(200);
    const res = await api().post(`/invites/${forC.body.invite.id}/accept`).set(auth(nisar.token)).expect(409);
    assert.match(res.body.error, /already in this group/);
  });

  test('only admins can invite → 403 for a normal member', async () => {
    const group = await uploadGroup();
    const bilal = await joinAs(group, 'B');
    const someone = await createAccount();
    await invite(group, 'C', someone.account.username, bilal.token).expect(403);
    await invite(group, 'C', undefined, bilal.token).expect(403);
    await api().get(`/groups/${group.ids.group}/invites`).set(auth(bilal.token)).expect(403);
    // An outsider can't either.
    await invite(group, 'C', undefined, someone.token).expect(403);
  });
});

describe('invite by personal link', () => {
  test('whoever has the code can accept, once', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    assert.equal(made.body.invite.kind, 'link');
    const { code } = made.body;
    assert.ok(code.length >= 40);
    // Only the hash is stored.
    const stored = await Invite.findById(made.body.invite.id).lean();
    assert.ok(stored.code_hash && !JSON.stringify(stored).includes(code));

    const chand = await createAccount('Chand');
    // Look first: "Join Kund Malir trip as C?"
    const look = await api()
      .get(`/invites/${made.body.invite.id}?code=${code}`)
      .set(auth(chand.token))
      .expect(200);
    assert.deepEqual([look.body.group.name, look.body.member.name], ['Kund Malir trip', 'C']);

    await api().post(`/invites/${made.body.invite.id}/accept`).set(auth(chand.token)).send({ code }).expect(200);
    assert.equal((await Member.findById(group.ids.C).lean()).account_id, chand.account.id);

    // Works once: a second person with the same link is refused.
    const late = await createAccount('Late');
    const res = await api()
      .post(`/invites/${made.body.invite.id}/accept`)
      .set(auth(late.token))
      .send({ code })
      .expect(409);
    assert.match(res.body.error, /already accepted/);
  });

  test('wrong or missing code → 403', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const chand = await createAccount('Chand');
    const url = `/invites/${made.body.invite.id}/accept`;
    await api().post(url).set(auth(chand.token)).expect(403);
    await api().post(url).set(auth(chand.token)).send({ code: 'guess' }).expect(403);
    await api().post(url).set(auth(chand.token)).send({ code: { $ne: '' } }).expect(403);
    await api().post('/invites/no-such-invite/accept').set(auth(chand.token)).expect(404);
  });

  test('expires after 7 days → 410', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    // Pretend 7 days went by.
    await Invite.updateOne({ _id: made.body.invite.id }, { $set: { expires_at: Date.now() - 1 } });

    const chand = await createAccount('Chand');
    const res = await api()
      .post(`/invites/${made.body.invite.id}/accept`)
      .set(auth(chand.token))
      .send({ code: made.body.code })
      .expect(410);
    assert.match(res.body.error, /expired/);
  });

  test('regenerating: the old code stops working, the new one works', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const fresh = await api()
      .post(`/invites/${made.body.invite.id}/regenerate`)
      .set(auth(group.token))
      .expect(200);
    assert.notEqual(fresh.body.code, made.body.code);

    const chand = await createAccount('Chand');
    const url = `/invites/${made.body.invite.id}/accept`;
    await api().post(url).set(auth(chand.token)).send({ code: made.body.code }).expect(403);
    await api().post(url).set(auth(chand.token)).send({ code: fresh.body.code }).expect(200);
  });

  test('only an admin can regenerate', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const bilal = await joinAs(group, 'B');
    await api().post(`/invites/${made.body.invite.id}/regenerate`).set(auth(bilal.token)).expect(403);
  });

  test('a new invite for a slot replaces the old one', async () => {
    const group = await uploadGroup();
    const first = await invite(group, 'C').expect(201);
    const second = await invite(group, 'C').expect(201);

    const chand = await createAccount('Chand');
    const res = await api()
      .post(`/invites/${first.body.invite.id}/accept`)
      .set(auth(chand.token))
      .send({ code: first.body.code })
      .expect(409);
    assert.match(res.body.error, /already revoked/);

    const list = await api().get(`/groups/${group.ids.group}/invites`).set(auth(group.token)).expect(200);
    assert.deepEqual(
      list.body.invites.map((i) => [i.id, i.expired]),
      [[second.body.invite.id, false]]
    );
  });

  test('two people accepting the same link at once: exactly one gets in', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const people = await Promise.all([createAccount(), createAccount(), createAccount()]);

    const results = await Promise.all(
      people.map((p) =>
        api()
          .post(`/invites/${made.body.invite.id}/accept`)
          .set(auth(p.token))
          .send({ code: made.body.code })
      )
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
  });
});

describe('rate limits on invites', () => {
  test('making invites: the 3rd in a window gets 429 (limit 2)', async () => {
    const group = await uploadGroup();
    const app = createApp({ rateLimit: { max: 2, windowMs: 60000 } });
    const make = () =>
      api(app).post(`/groups/${group.ids.group}/invites`).set(auth(group.token)).send({ member_id: group.ids.C });
    await make().expect(201);
    await make().expect(201);
    const res = await make().expect(429);
    assert.ok(Number(res.headers['retry-after']) > 0);
  });

  test('accepting (guessing codes): the 3rd try in a window gets 429 (limit 2)', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const guesser = await createAccount();
    const app = createApp({ rateLimit: { max: 2, windowMs: 60000 } });
    const guess = () =>
      api(app).post(`/invites/${made.body.invite.id}/accept`).set(auth(guesser.token)).send({ code: 'nope' });
    await guess().expect(403);
    await guess().expect(403);
    await guess().expect(429);
    // Even the right code is refused until the window ends.
    await api(app)
      .post(`/invites/${made.body.invite.id}/accept`)
      .set(auth(guesser.token))
      .send({ code: made.body.code })
      .expect(429);
  });
});
