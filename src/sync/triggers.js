// triggers.js — WHEN the sync engine runs. Started once from App.js.
//
//   - on app open, and whenever the app comes back to the foreground
//   - a moment after every change saved on this phone (db/changes.js)
//   - when the internet comes back (NetInfo)
//   - pull-to-refresh calls syncNow() itself (see the screens)
//
// It also shows a message when the server refused some of our changes
// (the engine has already put the server's version back by then).
//
// Kept apart from engine.js because these are React Native APIs, which the
// Node tests can't load.

import { Alert, AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { onLocalChange } from '../db/changes';
import { onRejected, requestSync, syncNow } from './engine';

/** Start everything. Returns a function that stops it again. */
export function startSyncTriggers() {
  const stops = [];

  // App open.
  syncNow();

  // Back to the foreground (e.g. after switching apps).
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') syncNow();
  });
  stops.push(() => appState.remove());

  // Every local change.
  stops.push(onLocalChange(() => requestSync()));

  // Internet back. NetInfo calls us once straight away and then on every
  // change; we only care about "offline → online". isConnected can be null
  // while NetInfo is still finding out, so only `false` counts as offline.
  let wasOffline = false;
  stops.push(
    NetInfo.addEventListener((net) => {
      if (net.isConnected === false) {
        wasOffline = true;
      } else if (net.isConnected && wasOffline) {
        wasOffline = false;
        syncNow();
      }
    })
  );

  // Refused changes: say what and why.
  stops.push(onRejected(showRejections));

  return () => stops.forEach((stop) => stop());
}

// "The expense “Chai”: Only the person who added this expense, or an admin,
// can change it. It's back to how it is on the server."
function showRejections(rejections) {
  const lines = rejections.map((r) => {
    const details = r.errors.length > 0 ? ` ${r.errors.join(' ')}` : '';
    const after = r.restored ? 'It’s back to how it is on the server.' : 'It was removed.';
    return `${r.what}: ${r.reason}${details} ${after}`;
  });
  Alert.alert(
    rejections.length === 1 ? 'A change wasn’t saved' : 'Some changes weren’t saved',
    lines.join('\n\n')
  );
}
