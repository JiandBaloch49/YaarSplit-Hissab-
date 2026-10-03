// models.js — the MongoDB collections, described with Mongoose.
//
// Group data (synced to phones, see seq.js):
//   groups, members, expenses, payments — match the app's SQLite tables
//   (see src/db/schema.js in the app), plus a few server-only fields
//   explained below.
// Server-only:
//   accounts  — people (name + unique @username)
//   devices   — one per phone token; points at an account
//   invites   — "join this group as Nisar"
//   counters  — hands out seq numbers, see seq.js
//
// Every GROUP document has:
//   _id         the app's UUID, made on the phone. The server never makes up
//               its own ids for app data, so a row has the same id everywhere.
//   seq         a number the SERVER gives the document every time it is
//               saved. Each group has its own count, which only ever goes
//               up, across all collections. A phone that has seen everything
//               in its group up to seq 120 asks "what changed after 120?"
//               and gets exactly the new/changed documents. (See seq.js.)
//   created_at  milliseconds (Date.now()), same as the app
//   updated_at  milliseconds, same as the app — set on every change
//   deleted     0/1, same as the app. Nothing is ever really removed, so a
//               deletion can reach other phones like any other change.
//   created_by  member id of whoever created it (null on groups uploaded
//               before this field existed)
//   updated_by  member id of whoever changed it last
//
// The app's `synced` column is NOT stored here: it only means "this phone
// still has to upload this row", so it only makes sense on the phone.
//
// Field names are snake_case, exactly like the app's columns, so documents
// can be copied to and from SQLite rows without renaming anything.

import mongoose from 'mongoose';
import { PAYMENT_STATUSES } from './logic/split.js';

const { Schema } = mongoose;

// The fields every collection shares (server-only ones have no seq).
const idAndTimes = {
  _id: { type: String, required: true }, // a UUID
  created_at: { type: Number, required: true },
  updated_at: { type: Number, required: true },
  deleted: { type: Number, required: true, default: 0, enum: [0, 1] },
};

// The fields every GROUP collection shares.
const baseFields = {
  ...idAndTimes,
  seq: { type: Number, required: true, index: true },
  created_by: { type: String, default: null }, // members._id
  updated_by: { type: String, default: null }, // members._id
};

// versionKey: false → no "__v" field; we have seq and updated_at instead.
const options = { versionKey: false };

// --- Accounts and devices ---------------------------------------------------

// A person using YaarSplit. No password yet: a phone proves it is this
// account with its device token (see devices / auth.js).
const accountSchema = new Schema(
  {
    ...idAndTimes,
    name: { type: String, required: true },
    // Lower case, without the "@": "nisar". Unique across everyone.
    username: { type: String, required: true, unique: true },
  },
  options
);

// One phone signed in to an account. We keep only a HASH of the device's
// secret token, never the token itself: if the database ever leaked, the
// hashes couldn't be used to log in.
const deviceSchema = new Schema(
  {
    ...idAndTimes,
    account_id: { type: String, required: true, index: true },
    token_hash: { type: String, required: true, unique: true },
  },
  options
);

// --- Group data (synced to phones) ------------------------------------------

// A group of friends.
const groupSchema = new Schema(
  {
    ...baseFields,
    name: { type: String, required: true },
    fund_holder_id: { type: String, default: null }, // members._id, or null = no fund
    // 1 = settle-up shows the short simplified list (settleUp in split.js).
    // 0 = pairwise: each person pays back exactly who they owe
    //     (pairwiseDebts in split.js). Only admins can change it.
    simplify_debts: { type: Number, required: true, default: 1, enum: [0, 1] },
  },
  options
);

// One person ("member slot") in a group. A slot exists before anyone has an
// account: the creator types in friends' names. An account is linked to a
// slot only by accepting an invite (see invites below).
const memberSchema = new Schema(
  {
    ...baseFields,
    group_id: { type: String, required: true, index: true },
    name: { type: String, required: true },
    // The account linked to this slot, or null if nobody has accepted an
    // invite for it yet. Linking keeps every past expense: those point at
    // the member id, which doesn't change.
    account_id: { type: String, default: null, index: true },
    // That account's @username, copied here so phones can show it.
    // (Usernames can't be changed yet, so the copy can't go stale.)
    username: { type: String, default: null },
    // 'admin' or 'member'. Only meaningful while an account is linked.
    role: { type: String, required: true, default: 'member', enum: ['admin', 'member'] },
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
// Only created_by (the creator) or an admin may edit or delete it.
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
// It only counts once confirmed — see PAYMENT_STATUSES in split.js and the
// payment routes for who may do what.
const paymentSchema = new Schema(
  {
    ...baseFields,
    group_id: { type: String, required: true, index: true },
    from_member_id: { type: String, required: true }, // the payer
    to_member_id: { type: String, required: true }, // the receiver
    amount: { type: Number, required: true }, // whole rupees
    type: { type: String, required: true, default: 'settlement' },
    status: { type: String, required: true, default: 'pending', enum: PAYMENT_STATUSES },
    confirmed_at: { type: Number, default: null }, // when it was confirmed
    // Who confirmed it: 'receiver' (the to_member's own account) or 'admin'
    // (an admin, because the receiver had no account yet). updated_by says
    // which member that was.
    confirmed_by: { type: String, default: null, enum: [null, 'receiver', 'admin'] },
  },
  options
);

// --- Invites (server only) --------------------------------------------------

// "Join <group> as <member>". Made by an admin, for ONE member slot.
//   kind 'username' — for one account (account_id); shows up in that
//                     account's GET /me/invites.
//   kind 'link'     — a personal link with a secret code. Whoever has the
//                     link can accept it. Only the code's HASH is stored, so
//                     the code is shown once (when made or regenerated).
// Works once, and only until expires_at (7 days).
const inviteSchema = new Schema(
  {
    ...idAndTimes,
    group_id: { type: String, required: true, index: true },
    member_id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['username', 'link'] },
    account_id: { type: String, default: null, index: true }, // kind 'username'
    code_hash: { type: String, default: null }, // kind 'link'
    // pending → accepted / declined, or revoked (a newer invite replaced it).
    status: {
      type: String,
      required: true,
      default: 'pending',
      enum: ['pending', 'accepted', 'declined', 'revoked'],
    },
    expires_at: { type: Number, required: true },
    created_by: { type: String, required: true }, // the admin's member id
    answered_by: { type: String, default: null }, // account that accepted/declined
    answered_at: { type: Number, default: null },
  },
  options
);

// Holds the last seq number handed out in each group:
// { _id: 'seq:<groupId>', value }. See seq.js.
const counterSchema = new Schema(
  { _id: { type: String, required: true }, value: { type: Number, required: true } },
  options
);

export const Account = mongoose.model('Account', accountSchema, 'accounts');
export const Device = mongoose.model('Device', deviceSchema, 'devices');
export const Group = mongoose.model('Group', groupSchema, 'groups');
export const Member = mongoose.model('Member', memberSchema, 'members');
export const Expense = mongoose.model('Expense', expenseSchema, 'expenses');
export const Payment = mongoose.model('Payment', paymentSchema, 'payments');
export const Invite = mongoose.model('Invite', inviteSchema, 'invites');
export const Counter = mongoose.model('Counter', counterSchema, 'counters');

/**
 * Turn a stored document into the shape the app uses: "_id" becomes "id".
 * Pass a plain object (from .lean()).
 */
export function toApp(doc) {
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

/**
 * A payment with the extra fromId/toId fields split.js expects, the same
 * names the app uses in its queries.js. The stored field names stay too, so
 * the object can also be sent to phones as it is.
 */
export function toSplitPayment(doc) {
  const payment = toApp(doc);
  return { ...payment, fromId: payment.from_member_id, toId: payment.to_member_id };
}
