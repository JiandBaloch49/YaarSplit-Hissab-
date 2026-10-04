// invites-ui.test.js — the extra invite endpoints the app's screens use:
// finding people by username, cancelling an invite, the richer invite
// preview, and the /join web page a shared link opens.
// Run with:  cd server && npm test

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, createAccount, joinAs, startTestDb, stopTestDb, uploadGroup } from './helpers.js';
import { createApp } from '../src/app.js';

before(startTestDb);
after(stopTestDb);

// Admin (token) invites member `letter` by username, or by link if no username.
function invite(group, letter, username, token = group.token) {
  return api()
    .post(`/groups/${group.ids.group}/invites`)
    .set(auth(token))
    .send({ member_id: group.ids[letter], ...(username ? { username } : {}) });
}

describe('GET /accounts/search', () => {
  test('finds usernames starting with q, shortest first, only name + username', async () => {
    const me = await createAccount('Me');
    // createAccount makes "user<N>_<random>" usernames; make two of our own.
    const prefix = `zz${Date.now().toString(36).slice(-5)}`;
    await api().post('/accounts').send({ name: 'Long', username: `${prefix}_long` }).expect(201);
    await api().post('/accounts').send({ name: 'Short', username: prefix }).expect(201);

    const res = await api()
      .get(`/accounts/search?q=@${prefix.toUpperCase()}`)
      .set(auth(me.token))
      .expect(200);
    assert.deepEqual(
      res.body.accounts.map((a) => [a.name, a.username]),
      [
        ['Short', prefix],
        ['Long', `${prefix}_long`],
      ]
    );
    assert.deepEqual(Object.keys(res.body.accounts[0]).sort(), ['id', 'name', 'username']);
  });

  test('too short or odd characters → no results; needs a token', async () => {
    const me = await createAccount('Me');
    for (const q of ['', 'u', '.*', 'us(er']) {
      const res = await api().get(`/accounts/search?q=${encodeURIComponent(q)}`).set(auth(me.token)).expect(200);
      assert.deepEqual(res.body.accounts, [], `q=${q}`);
    }
    await api().get('/accounts/search?q=user').expect(401);
  });

  test('rate limited per account', async () => {
    const app = createApp({ rateLimit: { max: 1, windowMs: 60000 } }); // search: 6 a minute
    const me = await createAccount('Me');
    for (let i = 0; i < 6; i++) {
      await api(app).get('/accounts/search?q=us').set(auth(me.token)).expect(200);
    }
    await api(app).get('/accounts/search?q=us').set(auth(me.token)).expect(429);
  });
});

describe('POST /invites/:inviteId/revoke', () => {
  test('an admin cancels a pending invite; it stops working and leaves the list', async () => {
    const group = await uploadGroup();
    const nisar = await createAccount('Nisar');
    const made = await invite(group, 'B', nisar.account.username).expect(201);

    const pending = await api().get(`/groups/${group.ids.group}/invites`).set(auth(group.token)).expect(200);
    assert.deepEqual(
      pending.body.invites.map((i) => [i.id, i.username]),
      [[made.body.invite.id, nisar.account.username]]
    );

    const res = await api().post(`/invites/${made.body.invite.id}/revoke`).set(auth(group.token)).expect(200);
    assert.equal(res.body.invite.status, 'revoked');

    const after = await api().get(`/groups/${group.ids.group}/invites`).set(auth(group.token)).expect(200);
    assert.deepEqual(after.body.invites, []);
    const mine = await api().get('/me/invites').set(auth(nisar.token)).expect(200);
    assert.deepEqual(mine.body.invites, []);
    await api().post(`/invites/${made.body.invite.id}/accept`).set(auth(nisar.token)).expect(409);
    // Cancelling twice → 409.
    await api().post(`/invites/${made.body.invite.id}/revoke`).set(auth(group.token)).expect(409);
  });

  test('a normal member or the invited person cannot cancel → 403', async () => {
    const group = await uploadGroup();
    const bilal = await joinAs(group, 'B');
    const made = await invite(group, 'C').expect(201); // a link
    await api().post(`/invites/${made.body.invite.id}/revoke`).set(auth(bilal.token)).expect(403);
    const stranger = await createAccount('Stranger');
    await api().post(`/invites/${made.body.invite.id}/revoke`).set(auth(stranger.token)).expect(403);
  });
});

describe('GET /invites/:inviteId preview', () => {
  test('shows the group members (names, who joined) and who invited you', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const friend = await createAccount('Friend');
    const res = await api()
      .get(`/invites/${made.body.invite.id}?code=${made.body.code}`)
      .set(auth(friend.token))
      .expect(200);
    assert.equal(res.body.group.name, 'Kund Malir trip');
    assert.equal(res.body.member.name, 'C');
    assert.equal(res.body.invited_by_name, 'A');
    // D was removed, so only A, B, C; A (the admin) is on YaarSplit.
    assert.deepEqual(res.body.group.members, [
      { name: 'A', joined: true, invited: false },
      { name: 'B', joined: false, invited: false },
      { name: 'C', joined: false, invited: true },
    ]);
  });
});

describe('GET /join/:inviteId', () => {
  test('a small web page that opens the app; it never needs the code', async () => {
    const group = await uploadGroup();
    const made = await invite(group, 'C').expect(201);
    const res = await api().get(`/join/${made.body.invite.id}`).expect(200);
    assert.match(res.headers['content-type'], /html/);
    assert.match(res.text, new RegExp(`yaarsplit://invite/${made.body.invite.id}`));
    assert.doesNotMatch(res.text, /Kund Malir/); // gives nothing away
  });

  test('not an invite id → 404', async () => {
    await api().get('/join/<script>').expect(404);
    await api().get('/join/123').expect(404);
  });
});
