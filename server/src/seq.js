// seq.js — hands out the increasing "seq" numbers used for sync, and saves
// documents together with their seq numbers in one go.
//
// Each group has its own counter in the "counters" collection:
//   { _id: 'seq:<groupId>', value: <last number handed out in that group> }
// Phones only ever ask "what changed in MY group after seq N?", so numbers
// only need to go up within a group.
//
// --- The race this file prevents ---
// Handing out numbers atomically ($inc) is not enough on its own. Picture
// two saves in the same group:
//   save A gets seq 5, save B gets seq 6,
//   B finishes writing first, a phone pulls now: it sees 6 (not 5, which
//   isn't written yet) and remembers "I have everything up to 6",
//   then A finishes writing 5 — and that phone never asks for 5 again.
//
// The fix: take the numbers AND write the documents inside one MongoDB
// transaction (saveWithSeqs below). Two things follow:
//   1. The counter bump and the documents become visible to readers at the
//      same instant, never one without the other.
//   2. While transaction A has bumped the counter but not finished,
//      transaction B can't bump it too: MongoDB stops B with a "write
//      conflict", and B starts over (automatically, after a short wait)
//      once A is done. So saves in one group go strictly one after another.
// Together: if a reader sees the counter at 6, every document with seq <= 6
// is already readable. /changes uses that (see currentSeq).
//
// Transactions need MongoDB running as a "replica set". Atlas always is;
// the tests start an in-memory replica set for the same reason.

import mongoose from 'mongoose';
import { Counter } from './models.js';

/** The counter document's _id for a group. */
function counterId(groupId) {
  return `seq:${groupId}`;
}

/**
 * Reserve `count` new seq numbers in a group and return them, in order.
 *   reserveSeqs(g, 3, session) → e.g. [41, 42, 43]
 * Only call this inside a transaction (pass its session) — see the top of
 * this file for why. saveWithSeqs does that for you.
 */
async function reserveSeqs(groupId, count, session) {
  // findOneAndUpdate + $inc is a single atomic step: read and bump together.
  // upsert: true creates the counter the very first time (value starts at
  // 0, so the first number handed out is 1).
  const counter = await Counter.findOneAndUpdate(
    { _id: counterId(groupId) },
    { $inc: { value: count } },
    { upsert: true, returnDocument: 'after', session } // give back the UPDATED counter
  ).lean();

  // counter.value is now the LAST number of our block.
  const first = counter.value - count + 1;
  const seqs = [];
  for (let i = 0; i < count; i++) seqs.push(first + i);
  return seqs;
}

/**
 * Reserve `count` seq numbers in a group and save documents with them, all
 * in ONE transaction. `save(seqs, session)` does the writing and must pass
 * `session` to every database call, or that call happens outside the
 * transaction.
 *
 * `save` may run more than once: if another save in the same group got there
 * first, MongoDB undoes this attempt and it is retried with fresh numbers.
 * So `save` must only write to the database (no other side effects).
 *
 * Returns whatever `save` returns.
 */
export async function saveWithSeqs(groupId, count, save) {
  return mongoose.connection.transaction(async (session) => {
    const seqs = await reserveSeqs(groupId, count, session);
    return save(seqs, session);
  });
}

/**
 * The last seq number handed out in a group (0 if none yet). Every document
 * with a seq up to this number is already saved and readable — see the top
 * of this file.
 */
export async function currentSeq(groupId) {
  const counter = await Counter.findById(counterId(groupId)).lean();
  return counter ? counter.value : 0;
}
