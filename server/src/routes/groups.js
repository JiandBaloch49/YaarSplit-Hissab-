// routes/groups.js — groups: upload, sync, settings, roles, settle-up.
//
//   POST /groups                                      (token) upload a group; I become its admin
//   GET  /groups/:groupId/changes                     (member) everything changed after a seq
//   PATCH /groups/:groupId/settings                   (admin) { simplify_debts }
//   POST /groups/:groupId/members/:memberId/make-admin   (admin)
//   POST /groups/:groupId/members/:memberId/remove       (admin) unlink their account
//   GET  /groups/:groupId/settle-up                   (member) who pays whom
//   GET  /groups/:groupId/history/:aId/:bId           (member) everything between two people

import express from 'express';
import { Expense, Group, Member, Payment, toApp } from '../models.js';
import { currentSeq, saveWithSeqs } from '../seq.js';
import { requireAccount, requireAdmin, requireMember } from '../auth.js';
import { validateGroupUpload } from '../validate.js';
import { loadForSplit } from '../groupData.js';
import { computeBalances, historyBetween, pairwiseDebts, settleUp } from '../logic/split.js';
import { HttpError } from '../errors.js';

// /changes sends at most this many documents per reply unless the phone
// asks for fewer (?limit=N), and never more than MAX_PAGE.
const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;

export function groupRoutes() {
  const router = express.Router();
  const member = [requireAccount, requireMember]; // "you must be in this group"
  const admin = [requireAccount, requireMember, requireAdmin]; // "...and an admin"

  // --- POST /groups: upload a group that so far only lived on one phone ---
  // Body: see validateGroupUpload() in validate.js. It includes
  // `my_member_id`: that member slot is linked to my account and becomes
  // the group's first admin.
  // Reply 201: { group_id }
  // Friends join later through invites (routes/invites.js).
  router.post('/groups', requireAccount, async (req, res) => {
    const result = validateGroupUpload(req.body);
    if (!result.ok) throw new HttpError(400, 'The group has problems.', result.errors);
    const { myMemberId, group, members, expenses, payments } = result.data;

    // Ids are UUIDs, so they should never already exist. If one does, this
    // group was uploaded before (e.g. the phone retried after a lost reply).
    // Uploading twice would create two copies, so refuse.
    const clashes = await Promise.all([
      Group.exists({ _id: group.id }),
      Member.exists({ _id: { $in: members.map((m) => m.id) } }),
      Expense.exists({ _id: { $in: expenses.map((e) => e.id) } }),
      Payment.exists({ _id: { $in: payments.map((p) => p.id) } }),
    ]);
    if (clashes.some(Boolean)) {
      throw new HttpError(409, 'This group (or some of its data) was already uploaded.');
    }

    const now = Date.now();
    // One seq number per document. Everything is saved in one transaction
    // (see seq.js), so the upload is all-or-nothing: nobody can ever pull a
    // half-saved group.
    const count = members.length + expenses.length + payments.length + 1;
    await saveWithSeqs(group.id, count, async (seqs, session) => {
      let n = 0;
      // The app's "id" is stored as MongoDB's "_id". Everything uploaded was
      // made on the uploader's phone, so they are its creator.
      const toDoc = ({ id, ...rest }) => ({
        _id: id,
        ...rest,
        created_by: myMemberId,
        updated_by: myMemberId,
        seq: seqs[n++],
      });

      // The uploader's own slot: linked to their account, and admin.
      const memberDocs = members.map((m) =>
        m.id === myMemberId
          ? { ...toDoc(m), account_id: req.account._id, username: req.account.username, role: 'admin' }
          : { ...toDoc(m), account_id: null, username: null, role: 'member' }
      );
      await Member.insertMany(memberDocs, { session });
      if (expenses.length > 0) await Expense.insertMany(expenses.map(toDoc), { session });

      // Payments recorded before the group was shared happened when nobody
      // had accounts, so nobody could confirm them. The uploader (now the
      // admin) vouches for them: saved as confirmed by the admin.
      if (payments.length > 0) {
        await Payment.insertMany(
          payments.map((p) => ({
            ...toDoc(p),
            status: 'confirmed',
            confirmed_at: now,
            confirmed_by: 'admin',
          })),
          { session }
        );
      }
      // create() with an array is how Mongoose takes a session for one doc.
      await Group.create([toDoc(group)], { session });
    });

    res.status(201).json({ group_id: group.id });
  });

  // --- GET /groups/:groupId/changes?since=<seq>&limit=<n>  (member) ---
  // Everything in the group saved after `since` (default 0 = everything),
  // INCLUDING deleted rows (deleted: 1), so the phone learns about deletions
  // too. At most `limit` documents per reply (default 500, max 1000).
  //
  // Reply: { group, members, expenses, payments, last_seq, has_more }
  //   group     null if it hasn't changed (or isn't in this page).
  //   members   include account_id, username and role, so a phone sees
  //             "Nisar joined" or "Bilal is now an admin" as a member change.
  //   payments  include status, confirmed_at, confirmed_by.
  //   last_seq  send it as `since` next time.
  //   has_more  true → there's more; ask again right away with since=last_seq.
  router.get('/groups/:groupId/changes', member, async (req, res) => {
    const since = Number.parseInt(req.query.since ?? '0', 10);
    if (!Number.isInteger(since) || since < 0) {
      throw new HttpError(400, 'since must be a whole number, 0 or more.');
    }
    const limit = Number.parseInt(req.query.limit ?? String(DEFAULT_PAGE), 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new HttpError(400, `limit must be a whole number from 1 to ${MAX_PAGE}.`);
    }

    const groupId = req.group._id;

    // Read the group's counter FIRST, then only look at seq numbers up to it.
    // Everything up to `upTo` is already saved (seq.js explains why), so
    // nothing in this range can show up later. Saves that finish while we're
    // reading have higher numbers and simply wait for the next pull.
    // (It also means the queries below all see the same moment, even
    // though they run separately.)
    const upTo = await currentSeq(groupId);
    const range = { seq: { $gt: since, $lte: upTo } };

    // Take up to limit + 1 from each collection, oldest seq first. The
    // `limit` lowest seqs overall must be among these, and the "+ 1" tells
    // us whether anything is left over.
    const take = limit + 1;
    const [groups, members, expenses, payments] = await Promise.all([
      Group.find({ _id: groupId, ...range }).lean(),
      Member.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
      Expense.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
      Payment.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
    ]);

    // Mix them into one list in seq order and keep the first `limit`.
    const all = [
      ...groups.map((doc) => ({ kind: 'group', doc })),
      ...members.map((doc) => ({ kind: 'members', doc })),
      ...expenses.map((doc) => ({ kind: 'expenses', doc })),
      ...payments.map((doc) => ({ kind: 'payments', doc })),
    ].sort((a, b) => a.doc.seq - b.doc.seq);
    const hasMore = all.length > limit;
    const page = all.slice(0, limit);

    // Where the phone should continue from:
    //   more to come → just after the last document in this page;
    //   all done     → upTo, which may be past the last document.
    // Math.max: never send the phone backwards.
    const lastSeq = hasMore ? page[page.length - 1].doc.seq : Math.max(since, upTo);

    const out = { group: null, members: [], expenses: [], payments: [] };
    for (const { kind, doc } of page) {
      if (kind === 'group') out.group = toApp(doc);
      else out[kind].push(toApp(doc));
    }

    res.json({ ...out, last_seq: lastSeq, has_more: hasMore });
  });

  // --- PATCH /groups/:groupId/settings  (admin) ---
  // Body: { simplify_debts: true/false (or 1/0) }
  // Reply: { group }
  router.patch('/groups/:groupId/settings', admin, async (req, res) => {
    const value = req.body?.simplify_debts;
    if (![true, false, 0, 1].includes(value)) {
      throw new HttpError(400, 'simplify_debts must be true or false.');
    }
    const simplify = value ? 1 : 0;

    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      await Group.updateOne(
        { _id: req.group._id },
        { $set: { simplify_debts: simplify, updated_at: Date.now(), updated_by: req.member._id, seq } },
        { session }
      );
    });

    const group = await Group.findById(req.group._id).lean();
    res.json({ group: toApp(group) });
  });

  // --- POST /groups/:groupId/members/:memberId/make-admin  (admin) ---
  // The member must have an account (admins are people who can log in).
  // Reply: { member }
  router.post('/groups/:groupId/members/:memberId/make-admin', admin, async (req, res) => {
    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      const target = await findMember(req.group._id, req.params.memberId, session);
      if (!target.account_id) {
        throw new HttpError(409, `${target.name} has no account yet. Invite them first.`);
      }
      await Member.updateOne(
        { _id: target._id },
        { $set: { role: 'admin', updated_at: Date.now(), updated_by: req.member._id, seq } },
        { session }
      );
    });
    res.json({ member: toApp(await Member.findById(req.params.memberId).lean()) });
  });

  // --- POST /groups/:groupId/members/:memberId/remove  (admin) ---
  // Takes the person OUT of the group: their account is unlinked from the
  // member slot, so they can't see or change the group any more. The slot
  // itself (the name, and every expense and payment it's in) stays, so the
  // group's history and balances don't change. An admin can remove
  // themselves ("leave"), but the group must keep at least one admin.
  // Reply: { member }
  router.post('/groups/:groupId/members/:memberId/remove', admin, async (req, res) => {
    await saveWithSeqs(req.group._id, 1, async ([seq], session) => {
      const target = await findMember(req.group._id, req.params.memberId, session);
      if (!target.account_id) {
        throw new HttpError(409, `${target.name} has no account linked, so there is nobody to remove.`);
      }
      if (target.role === 'admin') {
        // Counted inside the transaction, so two admins removing each other
        // at the same moment can't leave the group with none.
        const admins = await Member.countDocuments({
          group_id: req.group._id,
          role: 'admin',
          account_id: { $ne: null },
          deleted: 0,
        }).session(session);
        if (admins <= 1) {
          throw new HttpError(409, 'A group needs at least one admin. Make someone else admin first.');
        }
      }
      await Member.updateOne(
        { _id: target._id },
        {
          $set: {
            account_id: null,
            username: null,
            role: 'member',
            updated_at: Date.now(),
            updated_by: req.member._id,
            seq,
          },
        },
        { session }
      );
    });
    res.json({ member: toApp(await Member.findById(req.params.memberId).lean()) });
  });

  // --- GET /groups/:groupId/settle-up  (member) ---
  // Who should pay whom to settle everything, following the group's
  // simplify_debts setting:
  //   1 → settleUp():      the fewest payments
  //   0 → pairwiseDebts(): each person pays back exactly who they owe
  // Only confirmed payments count (split.js skips the others).
  // Reply: { simplify_debts, balances: { memberId: rupees }, transfers:
  //          [{ fromId, toId, amount }] }
  router.get('/groups/:groupId/settle-up', member, async (req, res) => {
    const { members, expenses, payments } = await loadForSplit(req.group._id);
    const balances = computeBalances(members, expenses, payments);
    const transfers = req.group.simplify_debts ? settleUp(balances) : pairwiseDebts(expenses, payments);
    res.json({ simplify_debts: req.group.simplify_debts, balances, transfers });
  });

  // --- GET /groups/:groupId/history/:aId/:bId  (member) ---
  // Every expense and payment involving both people, oldest first, with
  // what's still owed after each step (see historyBetween in split.js).
  // Reply: { steps: [{ kind, id, created_at, change, remaining, item }] }
  //   remaining > 0 → bId owes aId that much; < 0 → aId owes bId.
  router.get('/groups/:groupId/history/:aId/:bId', member, async (req, res) => {
    const { aId, bId } = req.params;
    const found = await Member.countDocuments({ _id: { $in: [aId, bId] }, group_id: req.group._id });
    if (aId === bId || found !== 2) {
      throw new HttpError(404, 'Pick two different people from this group.');
    }
    const { expenses, payments } = await loadForSplit(req.group._id);
    res.json({ steps: historyBetween(aId, bId, expenses, payments) });
  });

  return router;
}

// A live member of the group, read inside the transaction → else 404.
async function findMember(groupId, memberId, session) {
  const target = await Member.findOne({ _id: memberId, group_id: groupId, deleted: 0 })
    .session(session)
    .lean();
  if (!target) throw new HttpError(404, 'That person is not in this group.');
  return target;
}
