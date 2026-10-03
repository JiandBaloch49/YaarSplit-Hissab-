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

/** Disconnect and throw the in-memory database away. */
export async function stopTestDb() {
  await mongoose.disconnect();
  await mongo?.stop(); // mongo is unset if it never started
}

/**
 * Supertest wrapper around a brand-new app: api().post('/groups').send(...)
 * A new app per call also means fresh rate-limit counters, so tests that
 * aren't about rate limiting never hit the limit. Pass an app made with
 * createApp() to keep one across requests.
 */
export function api(app = createApp()) {
  return request(app);
}

/**
 * A valid upload body, shaped exactly like the phone would send it:
 * a trip with A, B, C (and D, who was removed), one equal-split expense,
 * one custom-split expense, and a payment.
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

/** Upload the sample group, join and claim member A. Returns everything. */
export async function uploadAndClaim() {
  const { ids, body } = sampleGroup();
  const upload = await api().post('/groups').send(body).expect(201);
  const claim = await api()
    .post('/claim')
    .send({ invite_code: upload.body.invite_code, member_id: ids.A })
    .expect(201);
  return { ids, body, inviteCode: upload.body.invite_code, token: claim.body.token };
}
