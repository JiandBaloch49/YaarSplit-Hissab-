// sync.test.js — two phones and the real server, end to end.
//
// What runs for real: the app's database code and sync engine (src/db,
// src/sync) on in-memory SQLite, and the server (server/src) on an
// in-memory MongoDB, talking over real HTTP on localhost.
//
// Two pretend phones live in this one process: globalThis.testPhone picks
// which phone's database and secure store the app code sees (see
// tests/helpers/expo-sqlite.mjs). Switch with on('A') / on('B'), and only
// between whole steps — never while a sync is half done.
//
// "Offline" = fetch() fails for that phone, exactly like a phone with no
// signal.
//
// Run with:  npm test   (the first run downloads MongoDB for the server
// tests, see server/README.md; needs `npm install` in server/ once)

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startTestDb, stopTestDb } from '../server/tests/helpers.js';
import { createApp } from '../server/src/app.js';
import { getDb, initDatabase } from '../src/db/database.js';
import {
  addExpense,
  addGroup,
  addMember,
  addPayment,
  answerPayment,
  getMe,
  listExpenses,
  listGroups,
  listMembers,
  listPayments,
  paymentActions,
  updateExpense,
} from '../src/db/queries.js';
import { getSyncState, onRejected, putGroupOnline, signUp, syncNow } from '../src/sync/engine.js';
import { request } from '../src/sync/api.js';
import { computeBalances } from '../src/logic/split.js';

// --- Pretend phones ---------------------------------------------------------

const started = new Set();
function on(phone) {
  globalThis.testPhone = phone;
  if (!started.has(phone)) {
    initDatabase(); // what App.js does on launch
    started.add(phone);
  }
}

const offline = new Set();
const realFetch = globalThis.fetch;
globalThis.fetch = (...args) =>
  offline.has(globalThis.testPhone)
    ? Promise.reject(new TypeError('Network request failed'))
    : realFetch(...args);

// --- The server ---------------------------------------------------------------

let server;
before(async () => {
  await startTestDb();
  server = createApp().listen(0); // any free port
  await once(server, 'listening');
  process.env.EXPO_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.close();
  await stopTestDb();
});

// --- Helpers ----------------------------------------------------------------

// Balances by member NAME, from this phone's own database.
function balances(groupId) {
  const members = listMembers(groupId);
  const byId = computeBalances(members, listExpenses(groupId), listPayments(groupId));
  return Object.fromEntries(members.map((m) => [m.name, byId[m.id]]));
}

// A meal paid by one person, split equally.
function meal(groupId, description, payerId, amount, forIds) {
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

const unique = Math.random().toString(36).slice(2, 7);

// --- The story ----------------------------------------------------------------

test('two phones, one offline, both add expenses, both end up identical', async () => {
  // Phone A: Ali makes an account and a group, offline-style (all local).
  on('A');
  await signUp('Ali', `ali_${unique}`);
  await syncNow(); // signUp starts a first sync; let it finish on THIS phone
  const group = addGroup('Kund Malir trip');
  const ali = addMember(group.id, 'Ali');
  const bilal = addMember(group.id, 'Bilal');
  const chand = addMember(group.id, 'Chand');
  meal(group.id, 'Breakfast', ali.id, 600, [ali.id, bilal.id, chand.id]);
  // A payment from before the group was online: confirmed straight away.
  assert.equal(addPayment(group.id, { fromId: chand.id, toId: ali.id, amount: 100 }).payment.status, 'confirmed');

  // "Put group online": Ali is the admin.
  await putGroupOnline(group.id, ali.id);
  assert.deepEqual(getMe(group.id), { online: 1, meId: ali.id, isAdmin: true });
  assert.equal(getSyncState().status, 'synced');

  // Phone B: Bilal makes an account; Ali invites @bilal as "Bilal".
  on('B');
  await signUp('Bilal', `bilal_${unique}`);
  await syncNow();
  on('A');
  const invite = await request('POST', `/groups/${group.id}/invites`, {
    member_id: bilal.id,
    username: `bilal_${unique}`,
  });
  on('B');
  await request('POST', `/invites/${invite.invite.id}/accept`);

  // B's first sync brings the whole group — in pages of 2 rows, so paging
  // (and the group's own row arriving on the LAST page) really happens.
  await syncNow({ pageSize: 2 });
  assert.equal(getSyncState().status, 'synced');
  assert.equal(listGroups().length, 1);
  assert.deepEqual(getMe(group.id), { online: 1, meId: bilal.id, isAdmin: false });
  assert.deepEqual(balances(group.id), { Ali: 300, Bilal: -200, Chand: -100 });

  // B goes offline. Saving still works instantly; sync says "offline".
  offline.add('B');
  meal(group.id, 'Lunch', bilal.id, 900, [ali.id, bilal.id, chand.id]);
  await syncNow();
  assert.equal(getSyncState().status, 'offline');

  // Meanwhile A, online, adds dinner and syncs.
  on('A');
  meal(group.id, 'Dinner', chand.id, 300, [ali.id, chand.id]);
  await syncNow();
  assert.equal(getSyncState().status, 'synced');

  // B reconnects and syncs, then A syncs again.
  on('B');
  offline.delete('B');
  await syncNow();
  assert.equal(getSyncState().status, 'synced');
  on('A');
  await syncNow();

  // Same expenses, same balances, on both phones.
  const expected = { Ali: -150, Bilal: 400, Chand: -250 };
  on('A');
  const aExpenses = listExpenses(group.id).map((e) => e.description).sort();
  assert.deepEqual(balances(group.id), expected);
  on('B');
  assert.deepEqual(balances(group.id), expected);
  assert.deepEqual(listExpenses(group.id).map((e) => e.description).sort(), aExpenses);
  assert.deepEqual(aExpenses, ['Breakfast', 'Dinner', 'Lunch']);
});

test('a payment: pending until the receiver confirms it, on both phones', async () => {
  on('B');
  const groupId = listGroups()[0].id;
  const { meId: bilalId } = getMe(groupId);
  on('A');
  const aliId = getMe(groupId).meId;
  const before = balances(groupId);

  // Bilal says "I paid Ali 150" → pending, doesn't count yet.
  on('B');
  const paid = addPayment(groupId, { fromId: bilalId, toId: aliId, amount: 150 });
  assert.equal(paid.payment.status, 'pending');
  await syncNow();

  // Ali sees it and may confirm it.
  on('A');
  await syncNow();
  const pending = listPayments(groupId).find((p) => p.id === paid.payment.id);
  assert.equal(pending.status, 'pending');
  assert.deepEqual(balances(groupId), before);
  assert.deepEqual(paymentActions(pending), { confirm: true, reject: true, cancel: false });
  assert.deepEqual(answerPayment(pending.id, 'confirm'), { ok: true });
  await syncNow();

  // Now it counts — on both phones.
  const after = { ...before, Ali: before.Ali - 150, Bilal: before.Bilal + 150 };
  assert.deepEqual(balances(groupId), after);
  on('B');
  await syncNow();
  assert.equal(listPayments(groupId).find((p) => p.id === paid.payment.id).status, 'confirmed');
  assert.deepEqual(balances(groupId), after);
});

test('a change the server refuses is explained and put back', async () => {
  on('B');
  const groupId = listGroups()[0].id;
  const breakfast = listExpenses(groupId).find((e) => e.description === 'Breakfast'); // Ali's

  // The app itself refuses: Bilal isn't its creator or an admin.
  const tried = updateExpense(breakfast.id, { ...breakfast, description: 'Free breakfast' });
  assert.equal(tried.ok, false);

  // But say an old app version (or a race) saved it anyway. The server is
  // the one that decides: it refuses, and B gets Ali's version back.
  getDb().runSync('UPDATE expenses SET description = ?, updated_at = ?, synced = 0 WHERE id = ?', [
    'Free breakfast',
    Date.now(),
    breakfast.id,
  ]);
  const seen = [];
  const stop = onRejected((list) => seen.push(...list));
  await syncNow();
  stop();

  assert.equal(seen.length, 1);
  assert.equal(seen[0].what, 'The expense “Free breakfast”');
  assert.match(seen[0].reason, /Only the person who added this expense/);
  assert.equal(seen[0].restored, true);
  const restored = listExpenses(groupId).find((e) => e.id === breakfast.id);
  assert.equal(restored.description, 'Breakfast');
  assert.equal(restored.synced, 1);
});
