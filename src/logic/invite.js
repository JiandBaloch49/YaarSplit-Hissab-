// invite.js — the text of invite links: making them and reading them back.
//
// A personal invite link (an admin's "Share invite link") looks like:
//
//   https://yaarsplit-server.onrender.com/join/<inviteId>#<code>
//
// It points at the SERVER's /join page because WhatsApp only makes http(s)
// links tappable. That page opens the app with:
//
//   yaarsplit://invite/<inviteId>?code=<code>
//
// The code comes after "#", which browsers never send to a server, so it
// doesn't end up in any server log.
//
// Pure functions, like split.js: plain text in, plain values out.

// Invite ids are UUIDs made by the server.
const UUID = '[0-9a-fA-F-]{36}';
// Codes are base64url text (letters, digits, "-" and "_").
const CODE = '[A-Za-z0-9_-]+';

/** The link to share: `${serverUrl}/join/${inviteId}#${code}`. */
export function buildInviteLink(serverUrl, inviteId, code) {
  return `${serverUrl.replace(/\/+$/, '')}/join/${inviteId}#${code}`;
}

/**
 * Read an invite link someone pasted (or the app was opened with).
 * Accepts both shapes above, with anything around it (e.g. the whole
 * WhatsApp message pasted in).
 * Returns { inviteId, code }, or null if there's no invite link in it.
 */
export function parseInviteLink(text) {
  if (typeof text !== 'string') return null;
  const web = text.match(new RegExp(`/join/(${UUID})#(${CODE})`));
  if (web) return { inviteId: web[1], code: web[2] };
  const app = text.match(new RegExp(`yaarsplit://invite/(${UUID})\\?code=(${CODE})`));
  if (app) return { inviteId: app[1], code: app[2] };
  return null;
}

/**
 * The WhatsApp message that goes with a link:
 * "Join “Kund Malir trip” on YaarSplit as Nisar: <link>"
 */
export function inviteMessage(groupName, memberName, link) {
  return (
    `Join “${groupName}” on YaarSplit as ${memberName}, so we can split our bills.\n\n` +
    `Tap to join: ${link}\n\n` +
    'The link works once and expires in 7 days.'
  );
}
