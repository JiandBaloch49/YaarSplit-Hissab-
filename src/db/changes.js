// changes.js — "something was just saved on this phone" notifications.
//
// Every function in queries.js that changes data calls notifyLocalChange()
// after saving. The sync engine (src/sync/engine.js) listens with
// onLocalChange() and uploads the change shortly after — that's how the app
// syncs "after every change" without the database code knowing anything
// about the network.
//
// Rows written BY the sync engine (pulled from the server) don't call this,
// otherwise every pull would trigger another sync, forever.

const listeners = new Set();

/** Tell every listener that data in `groupId` just changed on this phone. */
export function notifyLocalChange(groupId) {
  for (const listener of listeners) listener(groupId);
}

/**
 * Call `listener(groupId)` after every local change.
 * Returns a function that stops listening.
 */
export function onLocalChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
