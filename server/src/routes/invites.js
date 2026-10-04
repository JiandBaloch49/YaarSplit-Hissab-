// routes/invites.js — inviting friends into a group, and answering.
//
// An invite says "join <group> as <member>". It targets ONE member slot,
// expires after 7 days, and works once. An admin makes it either:
//   - by username: only that account can see and accept it (GET /me/invites);
//   - as a personal link: a secret code. Whoever has the link can accept.
//     Only the code's hash is stored, so the code is shown once. If it
//     leaks, an admin regenerates it (the old code stops working).
// Accepting links the account to the member slot. Every past expense and
// payment already points at that member id, so it all comes along.
//
//   POST /groups/:groupId/invites        (admin) { member_id, username? }
//   GET  /groups/:groupId/invites        (admin) pending invites
//   POST /invites/:inviteId/regenerate   (admin) new code for a link invite
//   POST /invites/:inviteId/revoke       (admin) cancel a pending invite
//   GET  /invites/:inviteId?code=...     (token) look before accepting
//   POST /invites/:inviteId/accept       (token) { code? }
//   POST /invites/:inviteId/decline      (token) { code? }
//   GET  /join/:inviteId                 (anyone) the web page a shared link opens
//
// Making invites and answering them are rate limited per account.

import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { Account, Group, Invite, Member, toApp } from '../models.js';
import { saveWithSeqs } from '../seq.js';
import { hashToken, makeToken, requireAccount, requireAdmin, requireMember } from '../auth.js';
import { normalizeUsername } from '../validate.js';
import { HttpError } from '../errors.js';

// How long an invite works.
export const INVITE_DAYS = 7;
const INVITE_MS = INVITE_DAYS * 24 * 60 * 60 * 1000;

/** The invite fields phones may see (never the code hash). */
export function publicInvite(invite) {
  const { code_hash, ...rest } = toApp(invite);
  return rest;
}

/**
 * limits.invite: limiter for making/regenerating invites
 * limits.answer: limiter for looking at / accepting / declining
 * (both count per account, see rateLimit.js)
 */
export function inviteRoutes(limits) {
  const router = express.Router();

  // --- POST /groups/:groupId/invites  (admin) ---
  // Body: { member_id, username }  → invite that account ("@nisar" is fine)
  //       { member_id }            → a personal link
  // Reply 201: { invite, code }    — code only for links, shown only now.
  //   The app turns { invite.id, code } into the link it shares.
  // A new invite for a slot replaces (revokes) any older pending one for
  // that slot, so there's only ever one way in per slot.
  router.post(
    '/groups/:groupId/invites',
    requireAccount,
    limits.invite,
    requireMember,
    requireAdmin,
    async (req, res) => {
      const memberId = req.body?.member_id;
      if (typeof memberId !== 'string') throw new HttpError(400, 'member_id is missing.');

      const member = await Member.findOne({ _id: memberId, group_id: req.group._id, deleted: 0 }).lean();
      if (!member) throw new HttpError(404, 'That person is not in this group.');
      if (member.account_id) throw new HttpError(409, `@${member.username} already joined as ${member.name}.`);

      // By username: that account must exist and not be in the group yet.
      let account = null;
      if (req.body.username !== undefined) {
        const username = normalizeUsername(req.body.username);
        account = username && (await Account.findOne({ username, deleted: 0 }).lean());
        if (!account) throw new HttpError(404, 'No account with that username.');
        const inGroup = await Member.exists({ group_id: req.group._id, account_id: account._id, deleted: 0 });
        if (inGroup) throw new HttpError(409, `@${account.username} is already in this group.`);
      }

      const now = Date.now();
      const code = account ? null : makeToken();
      const invite = {
        _id: randomUUID(),
        group_id: req.group._id,
        member_id: member._id,
        kind: account ? 'username' : 'link',
        account_id: account ? account._id : null,
        code_hash: code ? hashToken(code) : null,
        status: 'pending',
        expires_at: now + INVITE_MS,
        created_by: req.member._id,
        created_at: now,
        updated_at: now,
        deleted: 0,
      };

      // Invites aren't synced to phones (no seq), so a plain transaction is
      // enough: revoke the old ones and add the new one together.
      await mongoose.connection.transaction(async (session) => {
        await Invite.updateMany(
          { group_id: req.group._id, member_id: member._id, status: 'pending' },
          { $set: { status: 'revoked', updated_at: now } },
          { session }
        );
        await Invite.create([invite], { session });
      });

      res.status(201).json({ invite: publicInvite(invite), ...(code ? { code } : {}) });
    }
  );

  // --- GET /groups/:groupId/invites  (admin) ---
  // Reply: { invites: [...] } — pending ones, each with `expired: true/false`
  // and, for username invites, the invited `username` ("Invited @nisar").
  router.get('/groups/:groupId/invites', requireAccount, requireMember, requireAdmin, async (req, res) => {
    const invites = await Invite.find({ group_id: req.group._id, status: 'pending', deleted: 0 })
      .sort({ created_at: 1 })
      .lean();
    const accountIds = invites.map((i) => i.account_id).filter(Boolean);
    const accounts = await Account.find({ _id: { $in: accountIds } }).lean();
    const usernameOf = new Map(accounts.map((a) => [a._id, a.username]));
    const now = Date.now();
    res.json({
      invites: invites.map((i) => ({
        ...publicInvite(i),
        username: usernameOf.get(i.account_id) ?? null,
        expired: i.expires_at <= now,
      })),
    });
  });

  // --- POST /invites/:inviteId/regenerate  (admin of that group) ---
  // For a link that leaked: makes a new code (the old one stops working)
  // and gives it 7 fresh days.
  // Reply: { invite, code }
  router.post('/invites/:inviteId/regenerate', requireAccount, limits.invite, async (req, res) => {
    const invite = await Invite.findOne({ _id: req.params.inviteId, deleted: 0 }).lean();
    if (!invite) throw new HttpError(404, 'No such invite.');

    const me = await Member.findOne({ group_id: invite.group_id, account_id: req.account._id, deleted: 0 }).lean();
    if (!me || me.role !== 'admin') throw new HttpError(403, 'Only a group admin can do that.');
    if (invite.kind !== 'link') throw new HttpError(400, 'Only link invites have a code to regenerate.');

    const code = makeToken();
    const now = Date.now();
    // status: 'pending' in the filter: an invite accepted a moment ago
    // stays accepted.
    const updated = await Invite.findOneAndUpdate(
      { _id: invite._id, status: 'pending' },
      { $set: { code_hash: hashToken(code), expires_at: now + INVITE_MS, updated_at: now } },
      { returnDocument: 'after' }
    ).lean();
    if (!updated) throw new HttpError(409, `This invite was already ${invite.status}.`);

    res.json({ invite: publicInvite(updated), code });
  });

  // --- POST /invites/:inviteId/revoke  (admin of that group) ---
  // "Cancel invite": the invite (username or link) stops working at once.
  // Reply: { invite }   409 if it was already answered.
  router.post('/invites/:inviteId/revoke', requireAccount, limits.invite, async (req, res) => {
    const invite = await Invite.findOne({ _id: req.params.inviteId, deleted: 0 }).lean();
    if (!invite) throw new HttpError(404, 'No such invite.');

    const me = await Member.findOne({ group_id: invite.group_id, account_id: req.account._id, deleted: 0 }).lean();
    if (!me || me.role !== 'admin') throw new HttpError(403, 'Only a group admin can do that.');

    // status: 'pending' in the filter: an invite accepted a moment ago
    // stays accepted.
    const updated = await Invite.findOneAndUpdate(
      { _id: invite._id, status: 'pending' },
      { $set: { status: 'revoked', updated_at: Date.now() } },
      { returnDocument: 'after' }
    ).lean();
    if (!updated) throw new HttpError(409, `This invite was already ${invite.status}.`);

    res.json({ invite: publicInvite(updated) });
  });

  // --- GET /invites/:inviteId?code=...  (token) ---
  // Look at an invite before answering: "Join Trip as Nisar?"
  // Reply: { invite, group: { id, name, members }, member: { id, name },
  //          invited_by_name }
  //   group.members: [{ name, joined, invited }] — who is in the group,
  //   whether they're on YaarSplit (joined = an account is linked), and
  //   which slot this invite is for. Only names: the money stays private
  //   until you've joined.
  router.get('/invites/:inviteId', requireAccount, limits.answer, async (req, res) => {
    const invite = await loadMyInvite(req, req.query.code);
    const [group, slots] = await Promise.all([
      Group.findById(invite.group_id).lean(),
      Member.find({ group_id: invite.group_id, deleted: 0 }).sort({ created_at: 1 }).lean(),
    ]);
    if (!group || group.deleted) throw new HttpError(404, 'That group no longer exists.');
    // The slot the invite is for (looked up even if it was removed since,
    // so the screen can still say who it was for).
    const member = slots.find((m) => m._id === invite.member_id) ?? (await Member.findById(invite.member_id).lean());
    const invitedBy = await Member.findById(invite.created_by).lean();
    res.json({
      invite: { ...publicInvite(invite), expired: invite.expires_at <= Date.now() },
      group: {
        id: group._id,
        name: group.name,
        members: slots.map((m) => ({
          name: m.name,
          joined: Boolean(m.account_id),
          invited: m._id === invite.member_id,
        })),
      },
      member: { id: member._id, name: member.name },
      invited_by_name: invitedBy?.name ?? null,
    });
  });

  // --- POST /invites/:inviteId/accept  (token) ---
  // Body: { code } for link invites; nothing for username invites.
  // Links my account to the invite's member slot, as a normal member.
  // Reply: { group_id, member }
  //   403 not your invite / wrong code, 410 expired,
  //   409 already used, someone else took the slot, or you're already in.
  router.post('/invites/:inviteId/accept', requireAccount, limits.answer, async (req, res) => {
    const invite = await loadMyInvite(req, req.body?.code);

    // Linking changes the member row, which phones sync, so it goes through
    // saveWithSeqs. Everything is checked again INSIDE the transaction:
    // two accepts at once (same invite, or two invites for one slot) run one
    // after the other there, and the second one sees the first one's work.
    await saveWithSeqs(invite.group_id, 1, async ([seq], session) => {
      const fresh = await Invite.findById(invite._id).session(session).lean();
      checkStillOpen(fresh);

      const group = await Group.exists({ _id: invite.group_id, deleted: 0 }).session(session);
      if (!group) throw new HttpError(404, 'That group no longer exists.');
      const member = await Member.findOne({ _id: invite.member_id, group_id: invite.group_id, deleted: 0 })
        .session(session)
        .lean();
      if (!member) throw new HttpError(409, 'That person was removed from the group.');
      if (member.account_id) throw new HttpError(409, `Someone already joined as ${member.name}.`);
      const already = await Member.exists({
        group_id: invite.group_id,
        account_id: req.account._id,
        deleted: 0,
      }).session(session);
      if (already) throw new HttpError(409, 'You are already in this group.');

      const now = Date.now();
      await Member.updateOne(
        { _id: member._id },
        {
          $set: {
            account_id: req.account._id,
            username: req.account.username,
            role: 'member',
            updated_at: now,
            updated_by: member._id, // they did it themselves
            seq,
          },
        },
        { session }
      );
      await Invite.updateOne(
        { _id: invite._id },
        { $set: { status: 'accepted', answered_by: req.account._id, answered_at: now, updated_at: now } },
        { session }
      );
    });

    const member = await Member.findById(invite.member_id).lean();
    res.json({ group_id: invite.group_id, member: toApp(member) });
  });

  // --- POST /invites/:inviteId/decline  (token) ---
  // Body: { code } for link invites. The invite can't be used after this.
  // Reply: { invite }
  router.post('/invites/:inviteId/decline', requireAccount, limits.answer, async (req, res) => {
    const invite = await loadMyInvite(req, req.body?.code);
    checkStillOpen(invite);
    const now = Date.now();
    const updated = await Invite.findOneAndUpdate(
      { _id: invite._id, status: 'pending' }, // not if it was answered meanwhile
      { $set: { status: 'declined', answered_by: req.account._id, answered_at: now, updated_at: now } },
      { returnDocument: 'after' }
    ).lean();
    if (!updated) throw new HttpError(409, 'This invite was already answered.');
    res.json({ invite: publicInvite(updated) });
  });

  // --- GET /join/:inviteId  (anyone, no token) ---
  // A shared invite link looks like  https://<server>/join/<inviteId>#<code>
  // WhatsApp only makes http(s) links tappable, so the link points here, and
  // this small page hands over to the app (yaarsplit://invite/...).
  //
  // The code sits after "#", which browsers never send to the server: the
  // server doesn't see it, log it, or need it here. The page's own script
  // reads it and builds the app link. Nothing about the group is shown, so
  // the page gives nothing away to someone who only knows the invite id.
  router.get('/join/:inviteId', (req, res) => {
    const inviteId = req.params.inviteId;
    // Ids are UUIDs; anything else is not an invite (and keeps odd
    // characters out of the page below).
    if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return res.status(404).type('text').send('Not found.');
    res.type('html').send(joinPage(inviteId));
  });

  return router;
}

/**
 * The invite in the URL, if the caller may answer it:
 *   username invite → it must be for the caller's account
 *   link invite     → the caller must have the right code
 * Otherwise 404 (no such invite) or 403 (not yours / wrong code).
 */
async function loadMyInvite(req, code) {
  const invite = await Invite.findOne({ _id: req.params.inviteId, deleted: 0 }).lean();
  if (!invite) throw new HttpError(404, 'No such invite.');

  if (invite.kind === 'username') {
    if (invite.account_id !== req.account._id) {
      throw new HttpError(403, 'This invite is for someone else.');
    }
  } else if (typeof code !== 'string' || hashToken(code) !== invite.code_hash) {
    throw new HttpError(403, 'Wrong or missing invite code.');
  }
  return invite;
}

/** Refuse an invite that was already answered (409) or has expired (410). */
function checkStillOpen(invite) {
  if (invite.status !== 'pending') {
    throw new HttpError(409, `This invite was already ${invite.status}.`);
  }
  if (invite.expires_at <= Date.now()) {
    throw new HttpError(410, 'This invite has expired. Ask an admin for a new one.');
  }
}

/**
 * The web page for GET /join/:inviteId. It tries to open the app straight
 * away, and also shows a button (some browsers only open apps on a tap) and
 * what to do if the app isn't installed. `inviteId` was checked to be a
 * UUID, so it's safe to put into the page.
 */
function joinPage(inviteId) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join a group on YaarSplit</title>
<style>
  body { font-family: system-ui, sans-serif; background: #EDF0F5; color: #17223B;
         margin: 0; padding: 32px 16px; text-align: center; }
  .card { background: #fff; border-radius: 24px; padding: 28px 20px; max-width: 420px; margin: 0 auto; }
  a.button { display: inline-block; background: #17223B; color: #fff; text-decoration: none;
             padding: 16px 28px; border-radius: 18px; font-weight: 600; margin: 16px 0; }
  p { line-height: 1.5; color: #566074; }
</style>
</head>
<body>
<div class="card">
  <h1>You’re invited to a YaarSplit group</h1>
  <a class="button" id="open" href="#">Open in YaarSplit</a>
  <p>Nothing happens? Install YaarSplit, then open it, go to
     <b>Invitations</b> and paste this page’s link.</p>
</div>
<script>
  var code = location.hash.slice(1);
  var link = 'yaarsplit://invite/${inviteId}?code=' + encodeURIComponent(code);
  document.getElementById('open').href = link;
  location.href = link;
</script>
</body>
</html>`;
}
