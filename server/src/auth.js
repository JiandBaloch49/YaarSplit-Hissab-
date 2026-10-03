// auth.js — device tokens, accounts, and "are you allowed in this group?".
//
// How sign-in works:
//   1. POST /accounts makes an account, plus a long random secret token for
//      the phone that made it. The token is given to the phone ONCE.
//   2. The server stores only a SHA-256 hash of the token (devices.token_hash).
//   3. Every later request sends the token in a header:
//        Authorization: Bearer <token>
//      requireAccount hashes it, finds the device, then the account.
//
// Being in a group means: your account is linked to a live member of that
// group (you accepted an invite, or you created the group). requireMember
// checks that, and requireAdmin also checks the member's role.

import { createHash, randomBytes } from 'node:crypto';
import { Account, Device, Group, Member } from './models.js';

/** A new secret token: 32 random bytes, as URL-safe text (43 characters). */
export function makeToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * The hash we store instead of the token. A plain SHA-256 (no salt, no slow
 * hashing) is fine here because the token is 32 random bytes, which can't be
 * guessed — unlike a person's password. Invite link codes use it too.
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Middleware: who is calling?
 *   no token / unknown token → 401
 *   OK → req.account is the account document, and the route runs
 */
export async function requireAccount(req, res, next) {
  // Header looks like "Bearer abc123...". Take the part after "Bearer ".
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Missing device token.' });
  }

  const device = await Device.findOne({ token_hash: hashToken(match[1]), deleted: 0 }).lean();
  const account = device && (await Account.findOne({ _id: device.account_id, deleted: 0 }).lean());
  if (!account) {
    return res.status(401).json({ error: 'Unknown device token.' });
  }

  req.account = account;
  next();
}

/**
 * Middleware (after requireAccount) for routes with :groupId in the path.
 *   group doesn't exist            → 404
 *   your account isn't in it        → 403
 *   OK → req.group and req.member (YOUR member slot in that group)
 */
export async function requireMember(req, res, next) {
  const group = await Group.findOne({ _id: req.params.groupId, deleted: 0 }).lean();
  if (!group) {
    return res.status(404).json({ error: 'No such group.' });
  }

  const member = await Member.findOne({
    group_id: group._id,
    account_id: req.account._id,
    deleted: 0,
  }).lean();
  if (!member) {
    return res.status(403).json({ error: 'You are not in this group.' });
  }

  req.group = group;
  req.member = member;
  next();
}

/** Middleware (after requireMember): only the group's admins → else 403. */
export function requireAdmin(req, res, next) {
  if (req.member.role !== 'admin') {
    return res.status(403).json({ error: 'Only a group admin can do that.' });
  }
  next();
}
