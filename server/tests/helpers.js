// helpers.js — shared setup for the server tests.
//
// Tests never touch the real Atlas database. startTestDb() starts a real
// MongoDB that lives only in memory (mongodb-memory-server) and throws it
// away at the end. Each test file runs in its own process, so each gets its
// own empty database.
//
// It runs as a one-machine "replica set" rather than a plain server, because
// the server saves with transactions (see src/seq.js) and MongoDB only allows
// transactions on replica sets. Atlas is always one.

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';

let mongo;

/** Start the in-memory MongoDB and connect Mongoose to it. */
export async function startTestDb() {
  // Allow a slow first start (e.g. Windows virus scanning mongod the first
  // time). The default is 10 seconds.
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [{ launchTimeout: 60000 }],
  });
  await mongoose.connect(mongo.getUri());
  await mongoose.syncIndexes(); // same as index.js does on the real server
}

/** The in-memory database's address, to reconnect after a test disconnects. */
export function testDbUri() {
  return mongo.getUri();
}

/** Disconnect and throw the in-memory database away. */
export async function stopTestDb() {
  await mongoose.disconnect();
  await mongo?.stop(); // mongo is unset if it never started
}

/**
 * Supertest wrapper around a brand-new app: api().post('/accounts').send(...)
 * A new app per call also means fresh rate-limit counters, so tests that
 * aren't about rate limiting never hit the limit. Pass an app made with
 * createApp() to keep one across requests.
 */
export function api(app = createApp()) {
  return request(app);
}

/** The header that proves who you are: .set(auth(token)) */
export function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

// Usernames must be unique across the whole test file.
let accountCount = 0;

/**
 * Make a new account. Returns { token, account: { id, name, username } }.
 */
export async function createAccount(name = 'Friend') {
  accountCount++;
  const username = `user${accountCount}_${randomUUID().slice(0, 6)}`;
  const res = await api().post('/accounts').send({ name, username }).expect(201);
  return { token: res.body.token, account: res.body.account };
}

/**
 * A valid upload body, shaped exactly like the phone would send it:
 * a trip with A, B, C (and D, who was removed), one equal-split expense,
 * one custom-split expense, and a payment. The uploader is A.
 * Returns the body plus the ids, so tests can refer to people by letter.
 */
export function sampleGroup() {
  const now = Date.now();
  const base = () => ({ id: randomUUID(), created_at: now, updated_at: now, deleted: 0 });
  const group = { ...base(), name: 'Kund Malir trip', fund_holder_id: null };
  const member = (name, deleted = 0) => ({ ...base(), group_id: group.id, name, deleted });
  const [A, B, C, D] = [member('A'), member('B'), member('C'), member('D', 1)];

  return {
    ids: { A: A.id, B: B.id, C: C.id, D: D.id, group: group.id },
    body: {
      my_member_id: A.id,
      group,
      members: [A, B, C, D],
      expenses: [
        {
          ...base(),
          group_id: group.id,
          description: 'Dinner',
          amount: 1000,
          category: 'food',
          split_type: 'equal',
          payers: [{ member_id: A.id, amount: 1000 }],
          participants: [
            { member_id: A.id, share: 334 },
            { member_id: B.id, share: 333 },
            { member_id: C.id, share: 333 },
          ],
          from_fund: 0,
        },
        {
          ...base(),
          group_id: group.id,
          description: 'Tea',
          amount: 150,
          category: 'tea',
          split_type: 'custom',
          payers: [{ member_id: B.id, amount: 150 }],
          participants: [
            { member_id: B.id, share: 100 },
            { member_id: C.id, share: 50 },
          ],
          from_fund: 0,
        },
      ],
      payments: [
        {
          ...base(),
          group_id: group.id,
          from_member_id: C.id,
          to_member_id: A.id,
          amount: 200,
          type: 'settlement',
        },
      ],
    },
  };
}

/**
 * Make an account for A and upload the sample group with it, so A is the
 * admin. Returns { ids, body, token } (token = A's).
 */
export async function uploadGroup() {
  const { ids, body } = sampleGroup();
  const admin = await createAccount('A');
  await api().post('/groups').set(auth(admin.token)).send(body).expect(201);
  return { ids, body, token: admin.token, admin };
}

/**
 * A new account joins the group as member `letter` ('B' or 'C'): the admin
 * invites it by username and it accepts. Returns { token, account }.
 */
export async function joinAs(group, letter, adminToken = group.token) {
  const friend = await createAccount(letter);
  const invite = await api()
    .post(`/groups/${group.ids.group}/invites`)
    .set(auth(adminToken))
    .send({ member_id: group.ids[letter], username: friend.account.username })
    .expect(201);
  await api().post(`/invites/${invite.body.invite.id}/accept`).set(auth(friend.token)).expect(200);
  return friend;
}
