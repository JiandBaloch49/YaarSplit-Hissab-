// hooks.js — React hooks for screens that show synced data.
//
//   useSyncState()       the current { status, error }, kept up to date
//   useAfterSync(fn)     run `fn` (usually the screen's reload) whenever a
//                        sync changed data on this phone
//   usePullToRefresh()   { refreshing, onRefresh } for a RefreshControl
//   useMyInvites()       { invites, refresh }: invitations waiting for me,
//                        fetched again after every successful sync

import { useCallback, useEffect, useState } from 'react';
import { getSyncState, onSyncedData, onSyncState, syncNow } from './engine';
import { getAccount } from './account';
import { listMyInvites } from './invites';

export function useSyncState() {
  const [state, setState] = useState(getSyncState);
  useEffect(() => onSyncState(setState), []);
  return state;
}

export function useAfterSync(reload) {
  // onSyncedData returns its "stop listening" function — exactly what
  // useEffect wants as cleanup.
  useEffect(() => onSyncedData(reload), [reload]);
}

export function usePullToRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncNow(); // never throws; problems show in the status instead
    setRefreshing(false);
  }, []);
  return { refreshing, onRefresh };
}

export function useMyInvites() {
  const [invites, setInvites] = useState([]);

  // Ask the server. Offline (or not signed in) we keep showing what we had:
  // the badge is a hint, not something that must be exact.
  const refresh = useCallback(async () => {
    if (!getAccount()) {
      setInvites([]);
      return;
    }
    try {
      setInvites(await listMyInvites());
    } catch {
      // OfflineError / ApiError: try again after the next sync.
    }
  }, []);

  // A finished sync means we're online — a good moment to check again.
  useEffect(
    () =>
      onSyncState((state) => {
        if (state.status === 'synced') refresh();
      }),
    [refresh]
  );

  return { invites, refresh };
}
