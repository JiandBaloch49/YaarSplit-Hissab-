// routes/accounts.js — making an account, and "what's mine?".
//
//   POST /accounts      { name, username } → account + a device token
//   GET  /me            (token) my account and the groups I'm in
//   GET  /me/invites    (token) invitations waiting for my answer
//   GET  /accounts/search?q=nis   (token) find people to invite, by username

import { randomUUID } from 'node:crypto';
import express from 'express';
import { Account, Device, Group, Invite, Member } from '../models.js';
import { hashToken, makeToken, requireAccount } from '../auth.js';
import { isNonEmptyString, isValidUsername, normalizeUsername } from '../validate.js';

// GET /accounts/search: at least this many characters, at most this many results.
const SEARCH_MIN = 2;
const SEARCH_MAX = 10;
import { HttpError } from '../errors.js';
import { publicInvite } from './invites.js';

/** The account fields phones may see. */
export function publicAccount(account) {
  return { id: account._id, name: account.name, username: account.username };
}

/**
 * limits.account: rate limiter for POST /accounts (per IP).
 * limits.search:  rate limiter for GET /accounts/search (per account).
 */
export function accountRoutes(limits) {
  const router = express.Router();

  // --- POST /accounts: sign up ---
  // Body: { name: 'Nisar', username: '@nisar' }  ("@" and capitals are fine)
  // Reply 201: { account: { id, name, username }, token, device_id }
  // The token is shown ONLY here; the server keeps just its hash. The phone
  // sends it as "Authorization: Bearer <token>" from now on.
  // Rate limited per IP, so nobody can grab thousands of usernames.
  router.post('/accounts', limits.account, async (req, res) => {
    const name = req.body?.name;
    const username = normalizeUsername(req.body?.username);
    const errors = [];
    if (!isNonEmptyString(name) || name.trim().length > 50) {
      errors.push('name must be 1 to 50 characters.');
    }
    if (!isValidUsername(username)) {
      errors.push('username must be 3 to 20 characters: letters, digits or _.');
    }
    if (errors.length > 0) throw new HttpError(400, 'The account has problems.', errors);

    if (await Account.exists({ username })) {
      throw new HttpError(409, `@${username} is taken. Try another username.`);
    }

    const now = Date.now();
    const account = {
      _id: randomUUID(),
      name: name.trim(),
      username,
      created_at: now,
      updated_at: now,
      deleted: 0,
    };
    const token = makeToken();
    const deviceId = randomUUID();
    try {
      await Account.create(account);
    } catch (error) {
      // Two sign-ups for the same username at the same moment: the unique
      // index lets only one in.
      if (error.code === 11000) throw new HttpError(409, `@${username} is taken. Try another username.`);
      throw error;
    }
    await Device.create({
      _id: deviceId,
      account_id: account._id,
      token_hash: hashToken(token),
      created_at: now,
      updated_at: now,
      deleted: 0,
    });

    res.status(201).json({ account: publicAccount(account), token, device_id: deviceId });
  });

  // --- GET /accounts/search?q=nis: find someone to invite ---
  // Usernames STARTING with q ("@" and capitals are fine), at most 10,
  // shortest first so an exact match comes out on top. Only name and
  // username are shown. Needs at least 2 characters, so nobody can list
  // every account, and it's rate limited per account.
  // Reply: { accounts: [{ id, name, username }] }
  router.get('/accounts/search', requireAccount, limits.search, async (req, res) => {
    const q = normalizeUsername(req.query.q);
    // Usernames are only letters, digits and "_", so anything else can't
    // match — and keeping it out means q is safe inside the regex below.
    if (typeof q !== 'string' || q.length < SEARCH_MIN || !/^[a-z0-9_]+$/.test(q)) {
      return res.json({ accounts: [] });
    }
    const found = await Account.find({ username: { $regex: `^${q}` }, deleted: 0 })
      .limit(50)
      .lean();
    const accounts = found
      .sort((a, b) => a.username.length - b.username.length || a.username.localeCompare(b.username))
      .slice(0, SEARCH_MAX)
      .map(publicAccount);
    res.json({ accounts });
  });

  // --- GET /me: my account and my groups ---
  // Reply: { account, groups: [{ group_id, name, member_id, role }] }
  router.get('/me', requireAccount, async (req, res) => {
    const slots = await Member.find({ account_id: req.account._id, deleted: 0 }).lean();
    const groups = await Group.find({
      _id: { $in: slots.map((m) => m.group_id) },
      deleted: 0,
    }).lean();
    const groupById = new Map(groups.map((g) => [g._id, g]));

    res.json({
      account: publicAccount(req.account),
      groups: slots
        .filter((m) => groupById.has(m.group_id))
        .map((m) => ({
          group_id: m.group_id,
          name: groupById.get(m.group_id).name,
          member_id: m._id,
          role: m.role,
        })),
    });
  });

  // --- GET /me/invites: invitations sent to my username ---
  // Only pending ones that haven't expired. (Personal links aren't listed:
  // they're for whoever has the link, not for one account.)
  // Reply: { invites: [{ id, group_id, group_name, member_id, member_name,
  //                      invited_by_name, expires_at, created_at }] }
  router.get('/me/invites', requireAccount, async (req, res) => {
    const invites = await Invite.find({
      account_id: req.account._id,
      kind: 'username',
      status: 'pending',
      expires_at: { $gt: Date.now() },
      deleted: 0,
    })
      .sort({ created_at: 1 })
      .lean();

    // Look up the names to show: "Ali invited you to Trip as Nisar".
    const groupIds = invites.map((i) => i.group_id);
    const memberIds = invites.flatMap((i) => [i.member_id, i.created_by]);
    const [groups, members] = await Promise.all([
      Group.find({ _id: { $in: groupIds }, deleted: 0 }).lean(),
      Member.find({ _id: { $in: memberIds } }).lean(),
    ]);
    const groupName = new Map(groups.map((g) => [g._id, g.name]));
    const memberName = new Map(members.map((m) => [m._id, m.name]));

    res.json({
      invites: invites
        .filter((i) => groupName.has(i.group_id)) // skip deleted groups
        .map((i) => ({
          ...publicInvite(i),
          group_name: groupName.get(i.group_id),
          member_name: memberName.get(i.member_id) ?? null,
          invited_by_name: memberName.get(i.created_by) ?? null,
        })),
    });
  });

  return router;
}
