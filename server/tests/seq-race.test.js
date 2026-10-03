// seq-race.test.js — many saves at once must never make a phone miss a row.
//
// The bug this guards against (explained in src/seq.js): save A gets seq 5,
// save B gets seq 6, B finishes first, a phone pulls in between and jumps
// to "I have everything up to 6" — and never sees 5.
//
// Here lots of saves run at the same time, each pausing for a random moment
// AFTER getting its seq (so later numbers often try to finish first), while a
// "phone" keeps pulling /changes in small pages. At the end, every row in
// the database must have reached the phone.
//
// Checked: with the transaction taken out of saveWithSeqs, this test fails
// every time (the phone misses rows); with it, it passes.
// Run with:  cd server && npm test

import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, auth, startTestDb, stopTestDb, uploadGroup } from './helpers.js';
import { Expense } from '../src/models.js';
import { saveWithSeqs } from '../src/seq.js';

before(startTestDb);
after(stopTestDb);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal valid expense in the group: A paid 100 for A alone. */
function expense(groupId, memberId) {
  const now = Date.now();
  return {
    _id: randomUUID(),
    created_at: now,
    updated_at: now,
    deleted: 0,
    group_id: groupId,
    description: 'Chai',
    amount: 100,
    category: 'tea',
    split_type: 'equal',
    payers: [{ member_id: memberId, amount: 100 }],
    participants: [{ member_id: memberId, share: 100 }],
    from_fund: 0,
  };
}

test('concurrent saves + paged pulls: the phone never misses a row', async () => {
  const { ids, token } = await uploadGroup();

  // A "phone" that pulls one page, and remembers everything it got.
  const seenIds = new Set();
  const seenSeqs = [];
  let since = 0;
  async function pullPage() {
    const res = await api()
      .get(`/groups/${ids.group}/changes?since=${since}&limit=10`)
      .set(auth(token))
      .expect(200);
    const { group, members, expenses, payments } = res.body;
    for (const row of [...(group ? [group] : []), ...members, ...expenses, ...payments]) {
      seenIds.add(row.id);
      seenSeqs.push(row.seq);
    }
    since = res.body.last_seq;
    return res.body.has_more;
  }

  // 60 saves at once. Some save 1 expense, some 2 or 3 in one go.
  let writesDone = false;
  const writes = Array.from({ length: 60 }, async (_, i) => {
    const docs = Array.from({ length: (i % 3) + 1 }, () => expense(ids.group, ids.A));
    // Spread the saves over ~half a second, so the phone's pulls land in
    // between them (all at once, they'd be over before the first pull).
    await sleep(Math.random() * 500);
    await saveWithSeqs(ids.group, docs.length, async (seqs, session) => {
      // Pause AFTER taking the seq numbers: a slow save, so a save with a
      // higher number may try to finish before this one.
      await sleep(Math.random() * 40);
      await Expense.insertMany(
        docs.map((doc, k) => ({ ...doc, seq: seqs[k] })),
        { session }
      );
    });
  });
  const allWrites = Promise.all(writes).finally(() => {
    writesDone = true;
  });

  // Meanwhile, keep pulling pages, like a phone syncing during the rush.
  while (!writesDone) {
    await pullPage();
  }
  await allWrites;

  // Writes are over: the phone catches up the normal way, page by page.
  while (await pullPage());

  // Every expense in the database reached the phone...
  const stored = await Expense.find({ group_id: ids.group }).lean();
  // 2 uploaded + 60 saves of 1, 2 or 3 expenses (20×1 + 20×2 + 20×3 = 120).
  assert.equal(stored.length, 2 + 120);
  const missed = stored.filter((doc) => !seenIds.has(doc._id));
  assert.deepEqual(missed.map((d) => d.seq), [], 'the phone missed these seqs');

  // ...and each seq arrived exactly once, with no gaps: 1, 2, ..., last.
  seenSeqs.sort((a, b) => a - b);
  assert.deepEqual(
    seenSeqs,
    Array.from({ length: seenSeqs.length }, (_, k) => k + 1)
  );
  assert.equal(since, seenSeqs.at(-1));
});
