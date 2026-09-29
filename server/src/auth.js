// auth.js — device tokens: making them, and checking them on each request.
//
// How it works:
//   1. POST /claim ("I am this member") makes a long random secret token and
//      gives it to the phone ONCE. The phone keeps it.
//   2. The server stores only a SHA-256 hash of the token (devices.token_hash).
//   3. Every later request sends the token in a header:
//        Authorization: Bearer <token>
//      The server hashes it, looks the hash up in "devices", and checks that
//      the device belongs to the group in the URL.

import { createHash, randomBytes } from 'node:crypto';
import { Device } from './models.js';

/** A new secret token: 32 random bytes, as URL-safe text (43 characters). */
export function makeToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * The hash we store instead of the token. A plain SHA-256 (no salt, no slow
 * hashing) is fine here because the token is 32 random bytes, which can't be
 * guessed — unlike a person's password.
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Express middleware for every route after joining. The route must have a
 * :groupId in its path, e.g. GET /groups/:groupId/changes.
 *
 *   no token / unknown token          → 401 (who are you?)
 *   token for a device in ANOTHER group → 403 (not your group)
 *   OK → req.device is the device document, and the route runs
 */
export async function requireDevice(req, res, next) {
  // Header looks like "Bearer abc123...". Take the part after "Bearer ".
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return res.status(401).json({ error: 'Missing device token.' });
  }

  const device = await Device.findOne({ token_hash: hashToken(match[1]), deleted: 0 }).lean();
  if (!device) {
    return res.status(401).json({ error: 'Unknown device token.' });
  }
  if (device.group_id !== req.params.groupId) {
    return res.status(403).json({ error: 'This device does not belong to that group.' });
  }

  req.device = device;
  next();
}
