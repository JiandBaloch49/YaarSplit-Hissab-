// models.js — the MongoDB collections, described with Mongoose.
//
// The collections match the app's SQLite tables (see src/db/schema.js in the
// app), plus "devices" (which phone is which member) and "counters" (hands
// out seq numbers, see seq.js).
//
// Every document has:
//   _id         the app's UUID, made on the phone. The server never makes up
//               its own ids for app data, so a row has the same id everywhere.
//   seq         a number the SERVER gives the document every time it is
//               saved. Each group has its own count, which only ever goes
//               up, across all collections. A phone that has seen everything
//               in its group up to seq 120 asks "what changed after 120?"
//               and gets exactly the new/changed documents. (See seq.js.)
//   created_at  milliseconds (Date.now()), same as the app
//   updated_at  milliseconds, same as the app
//   deleted     0/1, same as the app. Nothing is ever really removed, so a
//               deletion can reach other phones like any other change.
//
// The app's `synced` column is NOT stored here: it only means "this phone
// still has to upload this row", so it only makes sense on the phone.
//
// Field names are snake_case, exactly like the app's columns, so documents
// can be copied to and from SQLite rows without renaming anything.

import mongoose from 'mongoose';

const { Schema } = mongoose;

// The fields every collection shares.
const baseFields = {
  _id: { type: String, required: true }, // the app's UUID
  seq: { type: Number, required: true, index: true },
  created_at: { type: Number, required: true },
  updated_at: { type: Number, required: true },
  deleted: { type: Number, required: true, default: 0, enum: [0, 1] },
};

// versionKey: false → no "__v" field; we have seq and updated_at instead.
const options = { versionKey: false };

// A group of friends.
const groupSchema = new Schema(
  {
    ...baseFields,
    name: { type: String, required: true },
    fund_holder_id: { type: String, default: null }, // members._id, or null = no fund

    // The code friends type to join, e.g. "YAR-1234". Unique, so a code
    // always points at exactly one group.
    invite_code: { type: String, required: true, unique: true },
  },
  options
);

// One person in a group.
const memberSchema = new Schema(
  {
    ...baseFields,
    group_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
  },
  options
);

// In the app, payers and participants are JSON text columns. Here they are
// real arrays. { _id: false } stops Mongoose adding an _id to each entry.
const payerSchema = new Schema(
  { member_id: { type: String, required: true }, amount: { type: Number, required: true } },
  { _id: false }
);
const participantSchema = new Schema(
  { member_id: { type: String, required: true }, share: { type: Number, required: true } },
  { _id: false }
);

// One bill. The amount checks (whole rupees, shares adding up...) happen in
// validate.js with the app's own prepareExpense() before anything is saved.
const expenseSchema = new Schema(
  {
    ...baseFields,
    group_id: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    amount: { type: Number, required: true }, // whole rupees
    category: { type: String, required: true },
    split_type: { type: String, required: true },
    payers: { type: [payerSchema], required: true },
    participants: { type: [participantSchema], required: true },
    from_fund: { type: Number, default: 0, enum: [0, 1] },
  },
  options
);

// Money handed from one member to another (paying back, fund in/out).
const paymentSchema = new Schema(
  {
    ...baseFields,
    group_id: { type: String, required: true, index: true },
    from_member_id: { type: String, required: true },
    to_member_id: { type: String, required: true },
    amount: { type: Number, required: true }, // whole rupees
    type: { type: String, required: true, default: 'settlement' },
  },
  options
);

// One phone that said "I am this member" (POST /claim).
// We keep only a HASH of the device's secret token, never the token itself:
// if the database ever leaked, the hashes couldn't be used to log in.
// Devices get a seq like everything else, so /changes can tell the other
// phones "A new phone joined as Bilal".
const deviceSchema = new Schema(
  {
    ...baseFields,
    member_id: { type: String, required: true },
    group_id: { type: String, required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
    // 1 if this member ALREADY had a phone when this one claimed it. That's
    // normal after a reinstall or a new phone, but it's also what it would
    // look like if a stranger claimed someone — worth showing to the group.
    already_claimed: { type: Number, required: true, default: 0, enum: [0, 1] },
  },
  options
);

// Holds the last seq number handed out in each group:
// { _id: 'seq:<groupId>', value }. See seq.js.
const counterSchema = new Schema(
  { _id: { type: String, required: true }, value: { type: Number, required: true } },
  options
);

export const Group = mongoose.model('Group', groupSchema, 'groups');
export const Member = mongoose.model('Member', memberSchema, 'members');
export const Expense = mongoose.model('Expense', expenseSchema, 'expenses');
export const Payment = mongoose.model('Payment', paymentSchema, 'payments');
export const Device = mongoose.model('Device', deviceSchema, 'devices');
export const Counter = mongoose.model('Counter', counterSchema, 'counters');

/**
 * Turn a stored document into the shape the app uses: "_id" becomes "id".
 * Pass a plain object (from .lean()).
 */
export function toApp(doc) {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}
