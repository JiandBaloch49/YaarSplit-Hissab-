// engine.js — keeps this phone and the server in step.
//
// The app never waits for the network: every change is saved in SQLite
// first (queries.js), and this engine copies it up later. One sync is:
//
//   1. GET /me                — which groups am I in on the server?
//   2. for every online group on this phone:
//        - not in that list any more (removed / group deleted) → hide it
//        - PUSH: send the rows changed here (synced = 0), up to
//          PUSH_BATCH at a time, to POST /groups/:id/push. The server
//          answers each row: accepted, or refused with the reason. Either
//          way we save the server's version over ours (see settleChange in
//          src/db/sync.js) — that's how a refused change gets "restored".
//   3. for every group I'm in:
//        - PULL: GET /groups/:id/changes?since=<last_seq>, page by page
//          while has_more is true. Rows are saved locally, except rows this
//          phone changed and hasn't pushed yet.
//
// Push comes before pull, so by the time we pull, our own changes are on
// the server and come back in their final form.
//
// When does it run? (see triggers.js) On app open, a moment after every
// change, on pull-to-refresh, and when the internet comes back.
//
// Only one sync runs at a time. Asking for another while one is running
// makes it run once more at the end, so nothing is missed.
//
// Status, for the indicator on screen (see components/SyncStatus.js):
//   'off'      nobody signed in, so nothing syncs
//   'syncing'  "Syncing…"
//   'synced'   "Synced"
//   'offline'  "Offline, will sync later" — couldn't reach the server
//   'error'    the server refused the whole sync (e.g. unknown token);
//              `error` says why
//
// This file has no React Native imports, so the tests can run it in Node.

import { ApiError, OfflineError, request } from './api';
import { getAccount, saveAccount } from './account';
import {
  applyPulled,
  buildUpload,
  forgetGroup,
  getLastSeq,
  listChanges,
  listOnlineGroups,
  markUploaded,
  setMyMember,
  settleChange,
} from '../db/sync';
import { categoryLabel, formatRupees } from '../logic/format';

// How many changed rows go up in one push (the server allows 200).
const PUSH_BATCH = 200;
// How many rows to ask for per pull page (the server allows up to 1000).
const PAGE_SIZE = 500;
// Wait this long after a change before syncing, so a burst of quick
// changes (e.g. adding three members) goes up together.
const DEBOUNCE_MS = 800;

// ---------------------------------------------------------------------------
// Status and listeners
// ---------------------------------------------------------------------------

let state = null; // { status, error } — set on first use, see getSyncState
const stateListeners = new Set();
const dataListeners = new Set();
const rejectListeners = new Set();

/** The current { status, error } (see the top of this file). */
export function getSyncState() {
  if (state === null) state = { status: getAccount() ? 'syncing' : 'off', error: null };
  return state;
}

function setState(status, error = null) {
  state = { status, error };
  for (const listener of stateListeners) listener(state);
}

// Small helper: add a listener to a set, return the "stop listening" function.
function listen(set, listener) {
  set.add(listener);
  return () => set.delete(listener);
}

/** Call `listener({ status, error })` whenever the status changes. */
export function onSyncState(listener) {
  return listen(stateListeners, listener);
}

/** Call `listener()` after a sync changed data on this phone (reload!). */
export function onSyncedData(listener) {
  return listen(dataListeners, listener);
}

/**
 * Call `listener(rejections)` when the server refused some of our changes.
 * Each rejection: { what, reason, errors, restored } — `what` names the row
 * ("The expense “Chai”"), `restored` says whether the server's version was
 * put back (false = the row never reached the server, so it was removed).
 */
export function onRejected(listener) {
  return listen(rejectListeners, listener);
}

function dataChanged() {
  for (const listener of dataListeners) listener();
}

// ---------------------------------------------------------------------------
// Running a sync
// ---------------------------------------------------------------------------

let running = null; // the promise of the sync in progress, or null
let again = false; // asked for another sync while one was running
let timer = null; // the debounce timer of requestSync

/** Sync soon (after DEBOUNCE_MS). Calls in quick succession sync once. */
export function requestSync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    syncNow();
  }, DEBOUNCE_MS);
}

/**
 * Sync now. Returns a promise that settles when it's done (it never
 * rejects: problems end up in the status). Safe to call any time.
 * options.pageSize: rows per pull page (tests use a small one).
 */
export function syncNow(options = {}) {
  if (!getAccount()) {
    setState('off');
    return Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await syncOnce(options);
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function syncOnce({ pageSize = PAGE_SIZE }) {
  setState('syncing');
  const rejections = [];
  let changed = false;
  try {
    // 1. Which groups am I in?
    const me = await request('GET', '/me');
    const mine = new Map(me.groups.map((g) => [g.group_id, g]));

    // 2. Push each online group's changes (or hide groups I've left).
    for (const group of listOnlineGroups()) {
      if (!mine.has(group.id)) {
        forgetGroup(group.id);
        changed = true;
        continue;
      }
      const pushed = await pushGroup(group.id, rejections);
      if (pushed === null) {
        forgetGroup(group.id); // removed between GET /me and now
        mine.delete(group.id);
      }
      if (pushed !== 0) changed = true;
    }

    // 3. Pull every group I'm in (this is also how a group I've just
    // joined arrives on this phone for the first time).
    for (const group of mine.values()) {
      const pulled = await pullGroup(group.group_id, pageSize);
      if (pulled === null) {
        forgetGroup(group.group_id);
        changed = true;
        continue;
      }
      setMyMember(group.group_id, group.member_id);
      if (pulled > 0) changed = true;
    }

    setState('synced');
  } catch (error) {
    if (error instanceof OfflineError) {
      setState('offline');
    } else if (error instanceof ApiError) {
      setState('error', error.message);
    } else {
      // A bug on our side. Keep the app running; the next sync tries again.
      console.warn('Sync failed', error);
      setState('error', 'Something went wrong while syncing.');
    }
  }

  // Even a sync that failed halfway may have saved some rows.
  if (changed) dataChanged();
  if (rejections.length > 0) {
    for (const listener of rejectListeners) listener(rejections);
  }
}

// Is this error "you're not in this group (any more)" / "no such group"?
function isGone(error) {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

/**
 * Push everything this phone changed in one group.
 * Returns how many rows were sent, or null if the group is gone for us.
 * Refused rows are added to `rejections`.
 */
async function pushGroup(groupId, rejections) {
  let sent = 0;
  while (true) {
    const changes = listChanges(groupId, PUSH_BATCH);
    if (changes.length === 0) break;

    let reply;
    try {
      reply = await request('POST', `/groups/${groupId}/push`, {
        changes: changes.map(({ table, row }) => ({ table, row })),
      });
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }

    // The results come back in the same order as the changes.
    changes.forEach(({ table, local, row }, i) => {
      const result = reply.results[i];
      if (!result) return; // shouldn't happen; the row simply goes up again later
      settleChange(table, local, result.row);
      if (!result.ok) {
        rejections.push({
          what: describeRow(table, row),
          reason: result.error,
          errors: result.errors ?? [],
          restored: Boolean(result.row),
        });
      }
    });
    sent += changes.length;

    // Fewer than a full batch → that was everything.
    if (changes.length < PUSH_BATCH) break;
  }
  return sent;
}

/**
 * Pull everything new in one group, page by page.
 * Returns how many rows arrived, or null if the group is gone for us.
 */
async function pullGroup(groupId, pageSize) {
  let since = getLastSeq(groupId);
  let count = 0;
  while (true) {
    let page;
    try {
      page = await request('GET', `/groups/${groupId}/changes?since=${since}&limit=${pageSize}`);
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
    count += applyPulled(groupId, page);
    since = page.last_seq;
    if (!page.has_more) break;
  }
  return count;
}

// A name for a row in messages: "The expense “Chai”".
function describeRow(table, row) {
  if (table === 'groups') return `The group “${row.name}”`;
  if (table === 'members') return `The member “${row.name}”`;
  if (table === 'expenses') {
    return `The expense “${row.description || categoryLabel(row.category)}”`;
  }
  return `The payment of ${formatRupees(row.amount)}`;
}

// ---------------------------------------------------------------------------
// Signing up, and putting a group online
// ---------------------------------------------------------------------------

/**
 * Make an account: POST /accounts { name, username }. On success the token
 * is saved (account.js) and a first sync starts.
 * Throws OfflineError (no internet) or ApiError (e.g. 409 username taken).
 */
export async function signUp(name, username) {
  const reply = await request('POST', '/accounts', { name, username });
  await saveAccount(reply.account, reply.token);
  syncNow();
  return reply.account;
}

/**
 * Upload a group that so far only lives on this phone. `myMemberId` is the
 * member who is me: the server links my account to that slot and makes me
 * the group's admin. Afterwards the group syncs like any other.
 *
 * This one needs the internet right now (it's a one-off, explicit action).
 * Throws OfflineError or ApiError.
 */
export async function putGroupOnline(groupId, myMemberId) {
  const { body, upTo } = buildUpload(groupId);
  try {
    await request('POST', '/groups', { ...body, my_member_id: myMemberId });
  } catch (error) {
    // 409 = already uploaded. That happens if an earlier try reached the
    // server but its reply got lost. If the group is ours, that's fine.
    const alreadyMine =
      error instanceof ApiError &&
      error.status === 409 &&
      (await request('GET', '/me')).groups.some((g) => g.group_id === groupId);
    if (!alreadyMine) throw error;
  }
  markUploaded(groupId, myMemberId, upTo);
  dataChanged();
  await syncNow(); // pull the server's version: roles, statuses, created_by
}
