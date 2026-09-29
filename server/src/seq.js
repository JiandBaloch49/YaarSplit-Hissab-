// seq.js — hands out the increasing "seq" numbers used for sync.
//
// There is one counter for the whole server, stored in the "counters"
// collection as { _id: 'seq', value: <last number handed out> }.
//
// MongoDB's $inc is atomic: even if two requests arrive at the same moment,
// each gets its own numbers and no number is ever handed out twice.

import { Counter } from './models.js';

/**
 * Reserve `count` new seq numbers and return them, in order.
 *   nextSeqs(3) → e.g. [41, 42, 43]
 * Reserving them in one go keeps a big upload to a single counter update.
 */
export async function nextSeqs(count) {
  // upsert: true creates the counter the very first time (value starts at 0,
  // so the first number handed out is 1).
  const counter = await Counter.findOneAndUpdate(
    { _id: 'seq' },
    { $inc: { value: count } },
    { upsert: true, returnDocument: 'after' } // give back the UPDATED counter
  ).lean();

  // counter.value is now the LAST number of our block.
  const first = counter.value - count + 1;
  const seqs = [];
  for (let i = 0; i < count; i++) seqs.push(first + i);
  return seqs;
}
