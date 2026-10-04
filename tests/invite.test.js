// invite.test.js — tests for src/logic/invite.js (invite links).
// Run with:  npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInviteLink, inviteMessage, parseInviteLink } from '../src/logic/invite.js';

const ID = '0b6f3c1e-2a4d-4f5e-9a8b-7c6d5e4f3a2b';
const CODE = 'aB3_x-9Zq';

test('buildInviteLink: the server /join page, code after "#"', () => {
  assert.equal(buildInviteLink('https://srv.example/', ID, CODE), `https://srv.example/join/${ID}#${CODE}`);
});

test('parseInviteLink reads both link shapes, even inside a whole message', () => {
  const web = buildInviteLink('https://srv.example', ID, CODE);
  assert.deepEqual(parseInviteLink(web), { inviteId: ID, code: CODE });
  assert.deepEqual(parseInviteLink(inviteMessage('Trip', 'Nisar', web)), { inviteId: ID, code: CODE });
  assert.deepEqual(parseInviteLink(`yaarsplit://invite/${ID}?code=${CODE}`), { inviteId: ID, code: CODE });
});

test('parseInviteLink: anything else → null', () => {
  assert.equal(parseInviteLink(''), null);
  assert.equal(parseInviteLink('hello'), null);
  assert.equal(parseInviteLink(`https://srv.example/join/${ID}`), null); // no code
  assert.equal(parseInviteLink(undefined), null);
});
