// SyncStatus.js — the small "Synced" / "Syncing…" / "Offline, will sync
// later" line with a coloured dot. Shown on the Groups screen and on an
// online group's screen.
//
// It reads the sync engine's status itself (useSyncState), so screens just
// drop <SyncStatus /> in. Shows nothing when nobody is signed in (nothing
// syncs then).
//
// Props:
//   style   extra style (e.g. alignment)

import { StyleSheet, Text, View } from 'react-native';
import { useSyncState } from '../sync/hooks';
import { colors, fonts } from '../theme';

// What each engine status looks like (see src/sync/engine.js).
const LOOKS = {
  syncing: { label: 'Syncing…', color: colors.muted },
  synced: { label: 'Synced', color: colors.gets },
  offline: { label: 'Offline, will sync later', color: colors.owes },
  error: { label: 'Couldn’t sync', color: colors.owes },
};

export default function SyncStatus({ style }) {
  const { status, error } = useSyncState();
  const look = LOOKS[status];
  if (!look) return null; // 'off': not signed in

  // For 'error', add the server's reason: "Couldn't sync: ..."
  const label = status === 'error' && error ? `${look.label}: ${error}` : look.label;

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="text"
      accessibilityLiveRegion="polite" // screen readers hear the change
    >
      <View style={[styles.dot, { backgroundColor: look.color }]} />
      <Text style={[styles.text, { color: look.color }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 13,
    flexShrink: 1,
  },
});
