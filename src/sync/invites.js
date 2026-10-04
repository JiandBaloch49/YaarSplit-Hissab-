// invites.js — inviting friends and answering invitations (server calls).
//
// Unlike expenses and payments, invites don't live in the phone's database:
// they only make sense with the server (it checks who may join), so these
// functions talk to it directly and need the internet RIGHT NOW. Every one
// of them throws OfflineError (no internet) or ApiError (the server said no,
// with a readable message) — see api.js. Screens show error.message.
//
// For admins (see server/src/routes/invites.js):
//   searchAccounts(text)                 people to invite, by username
//   inviteByUsername(groupId, member, username)
//   createInviteLink(groupId, member)    → { invite, link }
//   listGroupInvites(groupId)            pending invites in a group
//   cancelInvite(inviteId)
//   newInviteLink(inviteId)              a fresh link (the old one stops working)
// For the person invited:
//   listMyInvites()                      invitations to my username
//   getInvite(inviteId, code?)           preview: "Join Trip as Nisar?"
//   acceptInvite(inviteId, code?)        → the group syncs onto this phone
//   declineInvite(inviteId, code?)

import { apiUrl, request } from './api';
import { syncNow } from './engine';
import { buildInviteLink } from '../logic/invite';

// "?code=..." for link invites, nothing for username invites.
function codeQuery(code) {
  return code ? `?code=${encodeURIComponent(code)}` : '';
}

// An invite is for a member slot ON THE SERVER. A friend added a moment ago
// may still only be on this phone (synced = 0), so upload first.
async function makeSureUploaded(member) {
  if (member.synced === 0) await syncNow();
}

/**
 * Accounts whose username starts with `text` ("@nis" is fine). Fewer than 2
 * characters → [] without asking the server.
 * Returns [{ id, name, username }].
 */
export async function searchAccounts(text) {
  const q = text.trim().replace(/^@/, '').toLowerCase();
  if (q.length < 2) return [];
  const reply = await request('GET', `/accounts/search?q=${encodeURIComponent(q)}`);
  return reply.accounts;
}

/** Invite `username` to join as `member` (a member row of this group). */
export async function inviteByUsername(groupId, member, username) {
  await makeSureUploaded(member);
  const reply = await request('POST', `/groups/${groupId}/invites`, {
    member_id: member.id,
    username,
  });
  return reply.invite;
}

/**
 * Make a personal link for `member`. The server shows the secret code only
 * once, so the link is built from it straight away.
 * Returns { invite, link }.
 */
export async function createInviteLink(groupId, member) {
  await makeSureUploaded(member);
  const reply = await request('POST', `/groups/${groupId}/invites`, { member_id: member.id });
  return { invite: reply.invite, link: buildInviteLink(apiUrl(), reply.invite.id, reply.code) };
}

/**
 * Pending invites in a group (admins only), each with member_id, kind
 * ('username' / 'link'), username, expires_at and expired.
 */
export async function listGroupInvites(groupId) {
  const reply = await request('GET', `/groups/${groupId}/invites`);
  return reply.invites;
}

/** Cancel a pending invite (admins only). It stops working at once. */
export async function cancelInvite(inviteId) {
  await request('POST', `/invites/${inviteId}/revoke`);
}

/** A fresh link for a link invite; the old link stops working. → link */
export async function newInviteLink(inviteId) {
  const reply = await request('POST', `/invites/${inviteId}/regenerate`);
  return buildInviteLink(apiUrl(), reply.invite.id, reply.code);
}

/**
 * Invitations sent to my username that are still open. Each has id,
 * group_name, member_name, invited_by_name, expires_at.
 */
export async function listMyInvites() {
  const reply = await request('GET', '/me/invites');
  return reply.invites;
}

/**
 * Look at an invite before answering. Returns
 * { invite, group: { id, name, members: [{ name, joined, invited }] },
 *   member: { id, name }, invited_by_name }.
 */
export async function getInvite(inviteId, code) {
  return request('GET', `/invites/${inviteId}${codeQuery(code)}`);
}

/**
 * Join! The account is linked to the invite's member slot. Then a sync
 * brings the whole group onto this phone (it waits for that).
 * Returns the group id.
 */
export async function acceptInvite(inviteId, code) {
  const reply = await request('POST', `/invites/${inviteId}/accept`, code ? { code } : {});
  await syncNow();
  return reply.group_id;
}

/** Say no. The invite can't be used after this. */
export async function declineInvite(inviteId, code) {
  await request('POST', `/invites/${inviteId}/decline`, code ? { code } : {});
}
