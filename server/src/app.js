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
//                                   a seq number, a page at a time
//   POST /groups/:groupId/new-invite-code
//                                   (token needed) replace a leaked code
//
// Every reply is JSON. Errors look like { error: '...' }, and failed checks
// also carry the full list: { error: '...', errors: ['...', ...] }.

import { randomInt, randomUUID } from 'node:crypto';
import express from 'express';
import { Device, Expense, Group, Member, Payment, toApp } from './models.js';
import { currentSeq, saveWithSeqs } from './seq.js';
import { hashToken, makeToken, requireDevice } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { validateGroupUpload } from './validate.js';

// The characters invite codes are made of: capital letters and digits, minus
// the ones people mix up when reading a code out loud or off a screen:
// 0/O, 1/I/L. That leaves 31 characters.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Make a random invite code like "YAR-K7QM-3XHP". randomInt comes from
// node:crypto, so codes can't be predicted the way Math.random() ones could.
// 8 random characters from 31 → about 850 billion possible codes, so
// guessing one (at 10 tries a minute, see rate limiting) is hopeless.
function makeInviteCode() {
  let chars = '';
  for (let i = 0; i < 8; i++) chars += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return `YAR-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// Find an invite code no group uses yet. With ~850 billion codes a clash
// basically never happens, but checking costs little.
async function freeInviteCode() {
  for (let tries = 0; tries < 5; tries++) {
    const candidate = makeInviteCode();
    if (!(await Group.exists({ invite_code: candidate }))) return candidate;
  }
  return null;
}

// Invite codes are typed by people, so be forgiving: " yar k7qm 3xhp ",
// "yark7qm3xhp" and "YAR-K7QM-3XHP" all mean the same code.
function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  const plain = code.toUpperCase().replace(/[^A-Z0-9]/g, ''); // drop spaces, dashes
  const match = plain.match(/^YAR([A-Z0-9]{4})([A-Z0-9]{4})$/);
  return match ? `YAR-${match[1]}-${match[2]}` : plain;
}

// /changes sends at most this many documents per reply unless the phone
// asks for fewer (?limit=N), and never more than MAX_PAGE.
const DEFAULT_PAGE = 500;
const MAX_PAGE = 1000;

/**
 * Build the app.
 * options.rateLimit: { max, windowMs } for /join and /claim. The default is
 * 10 requests per minute per IP; tests can pass smaller numbers.
 */
export function createApp(options = {}) {
  const app = express();
  const limits = options.rateLimit ?? { max: 10, windowMs: 60 * 1000 };

  // On Render, requests reach us through Render's proxy, so the socket's IP
  // is the proxy's. This tells Express to take the phone's real IP from the
  // X-Forwarded-For header the proxy adds (trusting one proxy hop), so
  // req.ip — and the rate limit — is per phone, not shared by everybody.
  app.set('trust proxy', 1);

  // Parse JSON bodies. 5 MB leaves room for a group with a long history.
  app.use(express.json({ limit: '5mb' }));

  // Separate limiters, so 10 joins and 10 claims are each allowed per minute.
  const joinLimit = rateLimit(limits);
  const claimLimit = rateLimit(limits);

  // --- Health check: Render (and you) can open this to see the server is up.
  app.get('/', (req, res) => {
    res.json({ ok: true, name: 'YaarSplit server' });
  });

  // --- POST /groups: upload a group that so far only lived on one phone ---
  // Body: see validateGroupUpload() in validate.js.
  // Reply 201: { invite_code: 'YAR-K7QM-3XHP', group_id }
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

    const inviteCode = await freeInviteCode();
    if (!inviteCode) {
      return res.status(503).json({ error: 'Could not find a free invite code. Try again.' });
    }

    // One seq number per document. Everything is saved in one transaction
    // (see seq.js), so the upload is all-or-nothing: nobody can ever join or
    // pull a half-saved group.
    const count = members.length + expenses.length + payments.length + 1;
    await saveWithSeqs(group.id, count, async (seqs, session) => {
      let n = 0;
      // The app's "id" is stored as MongoDB's "_id".
      const toDoc = ({ id, ...rest }) => ({ _id: id, ...rest, seq: seqs[n++] });

      await Member.insertMany(members.map(toDoc), { session });
      if (expenses.length > 0) await Expense.insertMany(expenses.map(toDoc), { session });
      if (payments.length > 0) await Payment.insertMany(payments.map(toDoc), { session });
      // create() with an array is how Mongoose takes a session for one doc.
      await Group.create([{ ...toDoc(group), invite_code: inviteCode }], { session });
    });

    res.status(201).json({ invite_code: inviteCode, group_id: group.id });
  });

  // --- POST /join: a friend typed an invite code ---
  // Body: { invite_code }
  // Reply: { group, members } — members are the live ones, each with
  // `claimed: true/false` (has some phone already said "I am this member"?),
  // so the app can show "Which one are you?".
  // Rate limited (10/minute/IP) so nobody can try codes until one works.
  app.post('/join', joinLimit, async (req, res) => {
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
  // which gives a new token; old tokens keep working. Each claim is saved as
  // a device with a seq, so other phones learn about it from /changes.
  // Rate limited like /join.
  app.post('/claim', claimLimit, async (req, res) => {
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
    const deviceId = randomUUID();
    await saveWithSeqs(group._id, 1, async ([seq], session) => {
      // Did this member already have a phone? Checked inside the
      // transaction so two claims at once can't both say "no".
      const alreadyClaimed = await Device.exists({
        member_id: member._id,
        group_id: group._id,
        deleted: 0,
      }).session(session);

      const now = Date.now();
      await Device.create(
        [
          {
            _id: deviceId,
            seq,
            created_at: now,
            updated_at: now,
            deleted: 0,
            member_id: member._id,
            group_id: group._id,
            token_hash: hashToken(token),
            already_claimed: alreadyClaimed ? 1 : 0,
          },
        ],
        { session }
      );
    });

    res.status(201).json({
      token,
      device_id: deviceId,
      group_id: group._id,
      member_id: member._id,
    });
  });

  // --- GET /groups/:groupId/changes?since=<seq>&limit=<n>  (token needed) ---
  // Everything in the group saved after `since` (default 0 = everything),
  // INCLUDING deleted rows (deleted: 1), so the phone learns about deletions
  // too. At most `limit` documents per reply (default 500, max 1000).
  //
  // Reply: { group, members, expenses, payments, devices, last_seq, has_more }
  //   group     null if it hasn't changed (or isn't in this page).
  //   devices   phones that claimed a member: { id, member_id,
  //             already_claimed, created_at, ... } — never the token hash.
  //             Lets the app say "A new phone joined as Bilal".
  //   last_seq  send it as `since` next time.
  //   has_more  true → there's more; ask again right away with since=last_seq.
  app.get('/groups/:groupId/changes', requireDevice, async (req, res) => {
    const since = Number.parseInt(req.query.since ?? '0', 10);
    if (!Number.isInteger(since) || since < 0) {
      return res.status(400).json({ error: 'since must be a whole number, 0 or more.' });
    }
    const limit = Number.parseInt(req.query.limit ?? String(DEFAULT_PAGE), 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      return res.status(400).json({ error: `limit must be a whole number from 1 to ${MAX_PAGE}.` });
    }

    const groupId = req.params.groupId;

    // Read the group's counter FIRST, then only look at seq numbers up to it.
    // Everything up to `upTo` is already saved (seq.js explains why), so
    // nothing in this range can show up later. Saves that finish while we're
    // reading have higher numbers and simply wait for the next pull.
    // (It also means the four queries below all see the same moment, even
    // though they run separately.)
    const upTo = await currentSeq(groupId);
    const range = { seq: { $gt: since, $lte: upTo } };

    // Take up to limit + 1 from each collection, oldest seq first. The
    // `limit` lowest seqs overall must be among these, and the "+ 1" tells
    // us whether anything is left over.
    const take = limit + 1;
    const [groups, members, expenses, payments, devices] = await Promise.all([
      Group.find({ _id: groupId, ...range }).lean(),
      Member.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
      Expense.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
      Payment.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
      Device.find({ group_id: groupId, ...range }).sort({ seq: 1 }).limit(take).lean(),
    ]);

    // Mix them into one list in seq order and keep the first `limit`.
    const all = [
      ...groups.map((doc) => ({ kind: 'group', doc })),
      ...members.map((doc) => ({ kind: 'members', doc })),
      ...expenses.map((doc) => ({ kind: 'expenses', doc })),
      ...payments.map((doc) => ({ kind: 'payments', doc })),
      ...devices.map((doc) => ({ kind: 'devices', doc })),
    ].sort((a, b) => a.doc.seq - b.doc.seq);
    const hasMore = all.length > limit;
    const page = all.slice(0, limit);

    // Where the phone should continue from:
    //   more to come → just after the last document in this page;
    //   all done     → upTo, which may be past the last document (e.g. a
    //                  seq used by something /changes doesn't send).
    // Math.max: never send the phone backwards.
    const lastSeq = hasMore ? page[page.length - 1].doc.seq : Math.max(since, upTo);

    const out = { group: null, members: [], expenses: [], payments: [], devices: [] };
    for (const { kind, doc } of page) {
      if (kind === 'group') {
        // The invite code isn't secret from group members, but it isn't row
        // data either, so it stays out of sync replies.
        const { invite_code, ...rest } = toApp(doc);
        out.group = rest;
      } else if (kind === 'devices') {
        // NEVER send token hashes to phones.
        const { token_hash, ...rest } = toApp(doc);
        out.devices.push(rest);
      } else {
        out[kind].push(toApp(doc));
      }
    }

    res.json({ ...out, last_seq: lastSeq, has_more: hasMore });
  });

  // --- POST /groups/:groupId/new-invite-code  (token needed) ---
  // For when a code leaked (posted in the wrong chat...). Any member's phone
  // can ask for a new one. The old code stops working at once; phones that
  // already joined keep working, because they use their device tokens.
  // Reply: { invite_code }
  app.post('/groups/:groupId/new-invite-code', requireDevice, async (req, res) => {
    const inviteCode = await freeInviteCode();
    if (!inviteCode) {
      return res.status(503).json({ error: 'Could not find a free invite code. Try again.' });
    }

    // The invite code isn't synced row data (it's left out of /changes), so
    // this doesn't touch seq or updated_at.
    const result = await Group.updateOne(
      { _id: req.params.groupId, deleted: 0 },
      { $set: { invite_code: inviteCode } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'That group no longer exists.' });
    }

    res.json({ invite_code: inviteCode });
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
