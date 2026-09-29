// app.js — the Express app: every endpoint lives here.
//
// It only builds the app; it doesn't connect to MongoDB or start listening.
// index.js does that for the real server, and the tests do it with an
// in-memory MongoDB. Keeping them apart is what makes the tests possible.
//
// Endpoints:
//   GET  /                          health check (Render pings this)
//   POST /groups                    upload a group from a phone → invite code
//   POST /join                      invite code → group + member list
//   POST /claim                     "I am this member" → secret device token
//   GET  /groups/:groupId/changes   (token needed) everything changed after
//                                   a seq number
//
// Every reply is JSON. Errors look like { error: '...' }, and failed checks
// also carry the full list: { error: '...', errors: ['...', ...] }.

import { randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import { Device, Expense, Group, Member, Payment, toApp } from './models.js';
import { nextSeqs } from './seq.js';
import { hashToken, makeToken, requireDevice } from './auth.js';
import { validateGroupUpload } from './validate.js';

// Make a random invite code like "YAR-0427". randomInt comes from node:crypto,
// so codes can't be predicted the way Math.random() ones could.
function makeInviteCode() {
  return `YAR-${String(randomInt(0, 10000)).padStart(4, '0')}`;
}

// Invite codes are typed by people, so accept " yar-0427 " too.
function normalizeCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : '';
}

export function createApp() {
  const app = express();

  // Parse JSON bodies. 5 MB leaves room for a group with a long history.
  app.use(express.json({ limit: '5mb' }));

  // --- Health check: Render (and you) can open this to see the server is up.
  app.get('/', (req, res) => {
    res.json({ ok: true, name: 'YaarSplit server' });
  });

  // --- POST /groups: upload a group that so far only lived on one phone ---
  // Body: see validateGroupUpload() in validate.js.
  // Reply 201: { invite_code: 'YAR-1234', group_id }
  app.post('/groups', async (req, res) => {
    const result = validateGroupUpload(req.body);
    if (!result.ok) {
      return res.status(400).json({ error: 'The group has problems.', errors: result.errors });
    }
    const { group, members, expenses, payments } = result.data;

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
      return res.status(409).json({ error: 'This group (or some of its data) was already uploaded.' });
    }

    // Find an invite code nobody uses yet. With 10,000 possible codes a
    // clash is rare, so a few tries is plenty.
    let inviteCode = null;
    for (let tries = 0; tries < 20 && !inviteCode; tries++) {
      const candidate = makeInviteCode();
      if (!(await Group.exists({ invite_code: candidate }))) inviteCode = candidate;
    }
    if (!inviteCode) {
      return res.status(503).json({ error: 'Could not find a free invite code. Try again.' });
    }

    // One seq number per document, handed out in one go. Order: members,
    // expenses, payments, then the group last.
    const seqs = await nextSeqs(members.length + expenses.length + payments.length + 1);
    let n = 0;
    // The app's "id" is stored as MongoDB's "_id".
    const toDoc = ({ id, ...rest }) => ({ _id: id, ...rest, seq: seqs[n++] });

    // The group is saved LAST, on purpose: until it exists, its invite code
    // doesn't work, so nobody can join a half-saved group.
    await Member.insertMany(members.map(toDoc));
    if (expenses.length > 0) await Expense.insertMany(expenses.map(toDoc));
    if (payments.length > 0) await Payment.insertMany(payments.map(toDoc));
    await Group.create({ ...toDoc(group), invite_code: inviteCode });

    res.status(201).json({ invite_code: inviteCode, group_id: group.id });
  });

  // --- POST /join: a friend typed an invite code ---
  // Body: { invite_code }
  // Reply: { group, members } — members are the live ones, each with
  // `claimed: true/false` (has some phone already said "I am this member"?),
  // so the app can show "Which one are you?".
  app.post('/join', async (req, res) => {
    const group = await Group.findOne({
      invite_code: normalizeCode(req.body?.invite_code),
      deleted: 0,
    }).lean();
    if (!group) {
      return res.status(404).json({ error: 'No group with that invite code.' });
    }

    const members = await Member.find({ group_id: group._id, deleted: 0 }).sort({ created_at: 1 }).lean();
    const devices = await Device.find({ group_id: group._id, deleted: 0 }).lean();
    const claimedIds = new Set(devices.map((d) => d.member_id));

    res.json({
      group: toApp(group),
      members: members.map((m) => ({ ...toApp(m), claimed: claimedIds.has(m._id) })),
    });
  });

  // --- POST /claim: "I am this member" ---
  // Body: { invite_code, member_id }
  // Reply 201: { token, device_id, group_id, member_id }
  // The token is shown ONLY here. The phone must keep it safe; the server
  // just keeps its hash. A member may claim again (new phone, reinstall),
  // which gives a new token; old tokens keep working.
  app.post('/claim', async (req, res) => {
    const group = await Group.findOne({
      invite_code: normalizeCode(req.body?.invite_code),
      deleted: 0,
    }).lean();
    if (!group) {
      return res.status(404).json({ error: 'No group with that invite code.' });
    }

    // member_id must be plain text. Without this check, someone could send
    // an object like { "$ne": "" }, which MongoDB would read as "any member".
    const memberId = req.body?.member_id;
    if (typeof memberId !== 'string') {
      return res.status(400).json({ error: 'member_id is missing.' });
    }

    // The member must be a live member of THIS group.
    const member = await Member.findOne({
      _id: memberId,
      group_id: group._id,
      deleted: 0,
    }).lean();
    if (!member) {
      return res.status(404).json({ error: 'That person is not in this group.' });
    }

    const token = makeToken();
    const now = Date.now();
    const [seq] = await nextSeqs(1);
    const device = await Device.create({
      _id: randomUUID(),
      seq,
      created_at: now,
      updated_at: now,
      deleted: 0,
      member_id: member._id,
      group_id: group._id,
      token_hash: hashToken(token),
    });

    res.status(201).json({
      token,
      device_id: device._id,
      group_id: group._id,
      member_id: member._id,
    });
  });

  // --- GET /groups/:groupId/changes?since=<seq>  (token needed) ---
  // Everything in the group saved after `since` (default 0 = everything),
  // INCLUDING deleted rows, so the phone learns about deletions too.
  // Reply: { group, members, expenses, payments, last_seq }
  //   group is null if it hasn't changed since `since`.
  //   last_seq is the highest seq in the reply (or `since` if nothing
  //   changed): send it as `since` next time.
  app.get('/groups/:groupId/changes', requireDevice, async (req, res) => {
    const since = Number.parseInt(req.query.since ?? '0', 10);
    if (!Number.isInteger(since) || since < 0) {
      return res.status(400).json({ error: 'since must be a whole number, 0 or more.' });
    }

    const groupId = req.params.groupId;
    const changed = { seq: { $gt: since } };
    const [group, members, expenses, payments] = await Promise.all([
      Group.findOne({ _id: groupId, ...changed }).lean(),
      Member.find({ group_id: groupId, ...changed }).sort({ seq: 1 }).lean(),
      Expense.find({ group_id: groupId, ...changed }).sort({ seq: 1 }).lean(),
      Payment.find({ group_id: groupId, ...changed }).sort({ seq: 1 }).lean(),
    ]);

    // The highest seq among everything we're sending back.
    let lastSeq = since;
    for (const doc of [group, ...members, ...expenses, ...payments]) {
      if (doc && doc.seq > lastSeq) lastSeq = doc.seq;
    }

    // The invite code isn't secret from group members, but it isn't row
    // data either, so it stays out of sync replies.
    let groupOut = null;
    if (group) {
      const { invite_code, ...rest } = toApp(group);
      groupOut = rest;
    }

    res.json({
      group: groupOut,
      members: members.map(toApp),
      expenses: expenses.map(toApp),
      payments: payments.map(toApp),
      last_seq: lastSeq,
    });
  });

  // --- Anything else: 404 ---
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // --- Unexpected errors: log them, reply 500 without internal details ---
  // (Express 5 sends errors thrown inside async routes here automatically.)
  // eslint-disable-next-line no-unused-vars -- Express needs all 4 arguments
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request body is not valid JSON.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
