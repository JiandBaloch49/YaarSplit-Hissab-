// invites-sync.test.js — Phase 6b-2 end to end: the app's invite functions
// (src/sync/invites.js), the "Simplify debts" setting and "Edited by", on
// pretend phones talking to the real server.
//
// Same setup as sync.test.js: the app's database and sync code run on
// in-memory SQLite, the server on an in-memory MongoDB, over real HTTP.
// globalThis.testPhone picks which phone the app code sees.
//
// Run with:  npm test

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startTestDb, stopTestDb } from '../server/tests/helpers.js';
import { createApp } from '../server/src/app.js';
import { initDatabase } from '../src/db/database.js';
import {
  addExpense,
  addGroup,
  addMember,
  getExpense,
  getGroup,
  getMe,
  listGroups,
  listMembers,
  listMyGroups,
  setSimplifyDebts,
  updateExpense,
} from '../src/db/queries.js';
import { putGroupOnline, signUp, syncNow } from '../src/sync/engine.js';
import {
  acceptInvite,
  cancelInvite,
  createInviteLink,
  declineInvite,
  getInvite,
  inviteByUsername,
  listGroupInvites,
  listMyInvites,
  searchAccounts,
} from '../src/sync/invites.js';
import { parseInviteLink } from '../src/logic/invite.js';

// --- Pretend phones (see sync.test.js) ----------------------------------------

const started = new Set();
function on(phone) {
  globalThis.testPhone = phone;
  if (!started.has(phone)) {
    initDatabase();
    started.add(phone);
  }
}

const unique = Math.random().toString(36).slice(2, 7);

// A meal paid by `payerId`, split equally among `forIds`.
function meal(groupId, payerId, amount, forIds, description = 'Dinner') {
  const result = addExpense(groupId, {
    description,
    amount,
    category: 'food',
    split_type: 'equal',
    payers: [{ member_id: payerId, amount }],
    participants: forIds.map((member_id) => ({ member_id })),
  });
  assert.ok(result.ok, JSON.stringify(result.errors));
  return result.expense;
}

// The server, then phone A: Ali signs up and puts a group with Ali, Bilal
// and Chand online. Bilal (phone B) and Chand (phone C) make accounts.
let server;
let group, ali, bilal, chand;
before(async () => {
  await startTestDb();
  server = createApp().listen(0);
  await once(server, 'listening');
  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}`;

  on('A');
  await signUp('Ali', `ali_${unique}`);
  await syncNow();
  group = addGroup('Kund Malir trip');
  ali = addMember(group.id, 'Ali');
  bilal = addMember(group.id, 'Bilal');
  chand = addMember(group.id, 'Chand');
  meal(group.id, ali.id, 900, [ali.id, bilal.id, chand.id]);
  await putGroupOnline(group.id, ali.id);

  on('B');
  await signUp('Bilal', `bilal_${unique}`);
  await syncNow();
  on('C');
  await signUp('Chand', `chand_${unique}`);
  await syncNow();
});
after(async () => {
  server.close();
  await stopTestDb();
});

// --- Invites ------------------------------------------------------------------

test('by username: search, invite, it shows in their inbox, they accept', async () => {
  on('A');
  const found = await searchAccounts(`@BILAL_${unique}`);
  assert.deepEqual(
    found.map((a) => a.username),
    [`bilal_${unique}`]
  );
  assert.deepEqual(await searchAccounts('b'), []); // too short: no server call

  await inviteByUsername(group.id, bilal, found[0].username);
  const pending = await listGroupInvites(group.id);
  assert.deepEqual(
    pending.map((i) => [i.member_id, i.kind, i.username]),
    [[bilal.id, 'username', `bilal_${unique}`]]
  );

  on('B');
  const inbox = await listMyInvites();
  assert.deepEqual(
    inbox.map((i) => [i.group_name, i.member_name, i.invited_by_name]),
    [['Kund Malir trip', 'Bilal', 'Ali']]
  );
  const preview = await getInvite(inbox[0].id);
  assert.equal(preview.group.members.find((m) => m.invited).name, 'Bilal');

  // Accepting syncs the group onto this phone, with Bilal as "me".
  const groupId = await acceptInvite(inbox[0].id);
  assert.equal(groupId, group.id);
  assert.deepEqual(getMe(group.id), { online: 1, meId: bilal.id, isAdmin: false });
  assert.deepEqual(
    listMyGroups().map((g) => g.name),
    ['Kund Malir trip']
  );
  assert.deepEqual(await listMyInvites(), []);
});

test('by link: the shared link opens the preview; a cancelled link stops working', async () => {
  on('A');
  // A friend added just now only exists on this phone (synced = 0):
  // making the link uploads them first.
  addMember(group.id, 'Dawood');
  const dawood = listMembers(group.id).find((m) => m.name === 'Dawood');
  assert.equal(dawood.synced, 0);
  const first = await createInviteLink(group.id, dawood);
  assert.match(first.link, /\/join\/[0-9a-f-]{36}#/);

  // Ali cancels it: the link no longer works.
  await cancelInvite(first.invite.id);
  on('C');
  const stale = parseInviteLink(`Tap to join: ${first.link}`);
  await assert.rejects(acceptInvite(stale.inviteId, stale.code), /already revoked/);

  // A fresh link for Chand; Chand pastes the whole WhatsApp message.
  on('A');
  const made = await createInviteLink(group.id, chand);
  on('C');
  const parsed = parseInviteLink(`Join “Kund Malir trip” on YaarSplit as Chand.\n\nTap to join: ${made.link}`);
  const preview = await getInvite(parsed.inviteId, parsed.code);
  assert.equal(preview.member.name, 'Chand');
  assert.equal(preview.invited_by_name, 'Ali');
  // Ali (admin) and Bilal (accepted above) are on YaarSplit already.
  assert.deepEqual(
    preview.group.members.filter((m) => m.joined).map((m) => m.name),
    ['Ali', 'Bilal']
  );

  await acceptInvite(parsed.inviteId, parsed.code);
  assert.equal(getMe(group.id).meId, chand.id);
  assert.equal(listGroups().length, 1);
});

test('inviting someone already in the group is refused; declining clears the invite', async () => {
  on('A');
  addMember(group.id, 'Extra');
  await syncNow();
  const extra = listMembers(group.id).find((m) => m.name === 'Extra');
  // Bilal is already in the group, so the server says no — clearly.
  await assert.rejects(inviteByUsername(group.id, extra, `bilal_${unique}`), /already in this group/);

  // Someone new gets invited, and says no.
  on('E');
  await signUp('Esa', `esa_${unique}`);
  await syncNow();
  on('A');
  await inviteByUsername(group.id, extra, `esa_${unique}`);
  on('E');
  const [invite] = await listMyInvites();
  await declineInvite(invite.id);
  assert.deepEqual(await listMyInvites(), []);
  on('A');
  assert.deepEqual(
    (await listGroupInvites(group.id)).filter((i) => i.member_id === extra.id),
    []
  );
});

// --- Simplify debts -------------------------------------------------------------

test('only an admin can turn "Simplify debts" off; it reaches every phone', async () => {
  on('B');
  await syncNow();
  assert.equal(getGroup(group.id).simplify_debts, 1); // on by default
  assert.deepEqual(setSimplifyDebts(group.id, false), {
    ok: false,
    errors: ['Only a group admin can do that.'],
  });

  on('A');
  assert.deepEqual(setSimplifyDebts(group.id, false), { ok: true });
  await syncNow();

  on('B');
  await syncNow();
  assert.equal(getGroup(group.id).simplify_debts, 0);
});

// --- Edited by ------------------------------------------------------------------

test('"Edited by": a new expense was never edited; an edit records when and who', async () => {
  on('B');
  const chai = meal(group.id, bilal.id, 300, [bilal.id, chand.id], 'Chai');
  await syncNow();
  assert.equal(getExpense(chai.id).edited_at, null); // uploading isn't editing
  assert.equal(getExpense(chai.id).created_by, bilal.id);

  // Ali (an admin) edits it.
  on('A');
  await syncNow();
  const result = updateExpense(chai.id, {
    description: 'Chai and biscuits',
    amount: 400,
    category: 'tea',
    split_type: 'equal',
    payers: [{ member_id: bilal.id, amount: 400 }],
    participants: [{ member_id: bilal.id }, { member_id: chand.id }],
  });
  assert.ok(result.ok, JSON.stringify(result.errors));
  await syncNow();

  on('B');
  await syncNow();
  const edited = getExpense(chai.id);
  assert.equal(edited.description, 'Chai and biscuits');
  assert.equal(typeof edited.edited_at, 'number');
  assert.equal(edited.updated_by, ali.id);
  assert.equal(edited.created_by, bilal.id);
});
