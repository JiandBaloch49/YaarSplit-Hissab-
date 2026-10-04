// sync.js — the database side of syncing with the server.
//
// The sync engine (src/sync/engine.js) does the talking to the server; every
// read and write it needs on the phone's database is here, so all SQL stays
// in src/db.
//
// The main ideas:
//   - Every row has synced = 0 while this phone has a change the server
//     hasn't seen yet (queries.js sets it on every change).
//   - PUSH: listChanges() gives those rows, shaped the way the server wants
//     them. After the server answers, settleChange() marks each row synced
//     and saves the server's version over it.
//   - PULL: applyPulled() saves rows from the server's /changes. A row this
//     phone has changed but not pushed yet (synced = 0) is SKIPPED, so a
//     pull never wipes out a change that's still on its way up. (The push
//     happens first in every sync, so this is rare.)
//   - groups.last_seq remembers how far we've pulled each group.
//
// Writes in this file do NOT call notifyLocalChange(): they come from the
// server, and announcing them would start another sync, forever.

import { getDb } from './database';

// The tables, in the order changes are pushed: the group first, then members
// (so an expense can mention a member added in the same push), expenses,
// payments.
const TABLES = ['groups', 'members', 'expenses', 'payments'];

// The columns we copy FROM the server into each table (besides id). Phone-
// only columns (synced, online, last_seq, my_member_id) are never here, so a
// pull can't change them.
const BASE = ['created_at', 'updated_at', 'deleted', 'created_by', 'updated_by'];
const SERVER_COLUMNS = {
  groups: ['name', 'fund_holder_id', 'simplify_debts', ...BASE],
  members: ['group_id', 'name', 'account_id', 'username', 'role', ...BASE],
  expenses: [
    'group_id', 'description', 'amount', 'category', 'split_type',
    'payers', 'participants', 'from_fund', 'edited_at', ...BASE,
  ],
  payments: [
    'group_id', 'from_member_id', 'to_member_id', 'amount', 'type',
    'status', 'confirmed_at', 'confirmed_by', ...BASE,
  ],
};

// The fields we SEND for each table. Server-only fields (account_id, role,
// confirmed_by...) aren't sent: the server decides those itself.
// (An expense's edited_at is only used when a group is first uploaded; on a
// normal push the server sets it itself.)
const PUSH_FIELDS = {
  groups: ['id', 'name', 'fund_holder_id', 'simplify_debts', 'created_at', 'updated_at', 'deleted'],
  members: ['id', 'group_id', 'name', 'created_at', 'updated_at', 'deleted'],
  expenses: [
    'id', 'group_id', 'description', 'amount', 'category', 'split_type',
    'payers', 'participants', 'from_fund', 'edited_at', 'created_at', 'updated_at', 'deleted',
  ],
  payments: [
    'id', 'group_id', 'from_member_id', 'to_member_id', 'amount', 'type',
    'status', 'created_at', 'updated_at', 'deleted',
  ],
};

// A row from SQLite → the shape the server expects (payers/participants as
// real arrays, only the fields in PUSH_FIELDS).
function toServer(table, row) {
  const out = {};
  for (const field of PUSH_FIELDS[table]) out[field] = row[field];
  if (table === 'expenses') {
    out.payers = JSON.parse(row.payers);
    out.participants = JSON.parse(row.participants);
  }
  return out;
}

// One value from the server → what we store in SQLite. Arrays become JSON
// text; a missing value becomes NULL.
function toLocalValue(column, value) {
  if (column === 'payers' || column === 'participants') return JSON.stringify(value ?? []);
  return value ?? null;
}

/**
 * Save one row from the server into its table, unless this phone has an
 * unpushed change to it.
 *
 * "INSERT ... ON CONFLICT(id) DO UPDATE ... WHERE synced = 1" is SQLite's
 * "upsert": insert the row if it's new; if a row with that id exists,
 * update it — but only where synced = 1 (no local change waiting). The
 * saved row ends up with synced = 1: it now matches the server.
 *
 * A group arriving for the first time (one we've just joined) is saved with
 * online = 1. `table` always comes from this file, so it's safe in the SQL.
 */
function saveServerRow(table, row) {
  const columns = SERVER_COLUMNS[table];
  const values = columns.map((column) => toLocalValue(column, row[column]));
  const insertColumns = ['id', ...columns, 'synced'];
  const insertValues = [row.id, ...values, 1];
  if (table === 'groups') {
    insertColumns.push('online');
    insertValues.push(1);
  }
  const updates = columns.map((column) => `${column} = excluded.${column}`).join(', ');

  getDb().runSync(
    `INSERT INTO ${table} (${insertColumns.join(', ')})
     VALUES (${insertColumns.map(() => '?').join(', ')})
     ON CONFLICT(id) DO UPDATE SET ${updates}, synced = 1
     WHERE ${table}.synced = 1`,
    insertValues
  );
}

// ---------------------------------------------------------------------------
// Which groups sync
// ---------------------------------------------------------------------------

/**
 * Groups on the server that this phone still syncs: online ones that are
 * live, or deleted here with the deletion not pushed yet.
 * Returns [{ id, name, last_seq, my_member_id, deleted }].
 */
export function listOnlineGroups() {
  return getDb().getAllSync(
    `SELECT id, name, last_seq, my_member_id, deleted FROM groups
      WHERE online = 1 AND (deleted = 0 OR synced = 0)
      ORDER BY created_at, rowid`
  );
}

// How far we've pulled a group (0 = nothing yet, or not on this phone).
export function getLastSeq(groupId) {
  return getDb().getFirstSync('SELECT last_seq FROM groups WHERE id = ?', [groupId])?.last_seq ?? 0;
}

// Remember which member of the group is me (from the server's GET /me).
export function setMyMember(groupId, memberId) {
  getDb().runSync('UPDATE groups SET my_member_id = ? WHERE id = ?', [memberId, groupId]);
}

/**
 * I'm no longer in this group on the server (an admin removed me, or the
 * group was deleted): hide it here too. Like every delete it's soft, and
 * synced = 1 because there's nothing to tell the server.
 */
export function forgetGroup(groupId) {
  getDb().runSync('UPDATE groups SET deleted = 1, synced = 1 WHERE id = ?', [groupId]);
}

// ---------------------------------------------------------------------------
// Putting a local group online
// ---------------------------------------------------------------------------

/**
 * Everything in a local group, shaped as the body of POST /groups (without
 * my_member_id, which the engine adds). Deleted rows are included, so the
 * server knows about them too.
 *
 * Also returns `upTo`: the time just before we read. markUploaded() only
 * marks rows synced if they haven't changed since then.
 */
export function buildUpload(groupId) {
  const upTo = Date.now();
  const db = getDb();
  const group = db.getFirstSync('SELECT * FROM groups WHERE id = ?', [groupId]);
  const rowsOf = (table) =>
    db
      .getAllSync(`SELECT * FROM ${table} WHERE group_id = ? ORDER BY created_at, rowid`, [groupId])
      .map((row) => toServer(table, row));

  return {
    upTo,
    body: {
      group: toServer('groups', group),
      members: rowsOf('members'),
      expenses: rowsOf('expenses'),
      payments: rowsOf('payments'),
    },
  };
}

/**
 * The server accepted the upload: the group is online from now on, and
 * `myMemberId` is me. Every row that hasn't changed since `upTo` is now on
 * the server (synced = 1). The next pull brings the server's version of
 * everything (e.g. payments confirmed by the admin, who created what).
 */
export function markUploaded(groupId, myMemberId, upTo) {
  const db = getDb();
  db.withTransactionSync(() => {
    db.runSync(
      'UPDATE groups SET online = 1, my_member_id = ?, last_seq = 0 WHERE id = ?',
      [myMemberId, groupId]
    );
    db.runSync('UPDATE groups SET synced = 1 WHERE id = ? AND updated_at <= ?', [groupId, upTo]);
    for (const table of ['members', 'expenses', 'payments']) {
      db.runSync(`UPDATE ${table} SET synced = 1 WHERE group_id = ? AND updated_at <= ?`, [
        groupId,
        upTo,
      ]);
    }
  });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Up to `limit` rows of this group changed on this phone (synced = 0),
 * group first, then members, expenses, payments; oldest change first.
 * Returns [{ table, local, row }]: `local` is the row as stored here (the
 * engine needs its updated_at later), `row` is what to send.
 */
export function listChanges(groupId, limit) {
  const db = getDb();
  const changes = [];
  for (const table of TABLES) {
    const left = limit - changes.length;
    if (left <= 0) break;
    const where = table === 'groups' ? 'id = ?' : 'group_id = ?';
    const rows = db.getAllSync(
      `SELECT * FROM ${table} WHERE ${where} AND synced = 0 ORDER BY updated_at, rowid LIMIT ?`,
      [groupId, left]
    );
    for (const local of rows) changes.push({ table, local, row: toServer(table, local) });
  }
  return changes;
}

/**
 * The server answered one pushed row.
 *   serverRow  the server's version now (accepted or not), or null if the
 *              server has none (a new row it refused)
 *
 * If the row has changed AGAIN on this phone since we sent it (its
 * updated_at moved on), we leave it alone: it's still synced = 0 and the
 * newer version goes up next time.
 *
 * Otherwise this phone takes the server's version: for an accepted change
 * that's the same data plus what the server decided (a payment's status,
 * created_by...); for a refused one it restores what the server has. A
 * refused NEW row has no server version, so it's soft-deleted here.
 */
export function settleChange(table, local, serverRow) {
  const db = getDb();
  db.withTransactionSync(() => {
    const { changes } = db.runSync(
      `UPDATE ${table} SET synced = 1 WHERE id = ? AND updated_at = ? AND synced = 0`,
      [local.id, local.updated_at]
    );
    if (changes === 0) return; // changed again meanwhile
    if (serverRow) {
      saveServerRow(table, serverRow);
    } else {
      db.runSync(`UPDATE ${table} SET deleted = 1 WHERE id = ?`, [local.id]);
    }
  });
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Save one page from GET /groups/:id/changes, and remember how far we got,
 * in ONE transaction: if the app is killed halfway, neither happens, and the
 * next pull simply asks for the same page again.
 *
 * Returns how many rows the page had (0 = nothing new).
 */
export function applyPulled(groupId, page) {
  const db = getDb();
  let count = 0;
  db.withTransactionSync(() => {
    if (page.group) {
      saveServerRow('groups', page.group);
      count++;
    }
    for (const table of ['members', 'expenses', 'payments']) {
      for (const row of page[table] ?? []) {
        saveServerRow(table, row);
        count++;
      }
    }
    // A group's own row can arrive on a later page than its members (it
    // has the highest seq when uploaded), so this may update nothing yet;
    // the engine keeps track of `since` itself until the last page.
    db.runSync('UPDATE groups SET last_seq = ? WHERE id = ?', [page.last_seq, groupId]);
  });
  return count;
}
