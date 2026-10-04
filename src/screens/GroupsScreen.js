// GroupsScreen.js — the first screen: a list of all groups.
//
// The YaarSplit logo at the top, then one card with a row per group:
//   [K]  Kund Malir trip                     Rs 2,950
//        4 friends, Rs 8,500 spent           to settle
// Tap a group to open it. "New group" (pinned to the bottom) asks for a name.
// Under the tagline: the sync status ("Synced" / "Syncing…" / "Offline,
// will sync later"), or a "Sign up" link if you skipped signing up.
// Pull down to sync now; groups also reload by themselves when a sync
// brings changes from friends.
// Signed in, the top corners hold an envelope (Invitations, with a badge
// counting the ones waiting) and a person icon (the "Me" screen). While
// invitations are waiting, a banner above the groups says so too.
// While developing (__DEV__), there's also a "Load test data" button.
// At the very end of the list: "Built with ♥ by Jiand Baloch".

import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import { LetterTile } from '../components/IconTile';
import TextPromptModal from '../components/TextPromptModal';
import SyncStatus from '../components/SyncStatus';
import { Check, Heart, Mail, Plus, User } from '../components/icons';
import { addGroup, listExpenses, listGroups, listMembers, listPayments } from '../db/queries';
import { loadTestData } from '../db/testData';
import { describeGroup, formatRupees } from '../logic/format';
import { summarizeGroup } from '../logic/split';
import { getAccount } from '../sync/account';
import { useAfterSync, useMyInvites, usePullToRefresh } from '../sync/hooks';
import { colors, fonts, money, text } from '../theme';

// Every group with its summary numbers (see summarizeGroup in split.js).
// The sync DB API returns rows straight away, so this is a plain function.
function loadGroups() {
  return listGroups().map((group) => ({
    ...group,
    summary: summarizeGroup(
      listMembers(group.id),
      listExpenses(group.id),
      listPayments(group.id)
    ),
  }));
}

export default function GroupsScreen({ navigation }) {
  const insets = useSafeAreaInsets(); // space taken by the notch / home bar
  const [groups, setGroups] = useState([]);
  const [askingName, setAskingName] = useState(false);
  const [signedIn, setSignedIn] = useState(() => Boolean(getAccount()));
  const { refreshing, onRefresh } = usePullToRefresh();
  const { invites, refresh: refreshInvites } = useMyInvites();

  const reload = useCallback(() => {
    setGroups(loadGroups());
    setSignedIn(Boolean(getAccount()));
    refreshInvites(); // asks the server; offline it keeps the last count
  }, [refreshInvites]);

  // Reload every time this screen comes into view — e.g. coming back from a
  // group after adding expenses, so the "to settle" numbers are fresh.
  useFocusEffect(reload);
  // ...and when a sync brought something new (e.g. a friend's expense).
  useAfterSync(reload);

  function openGroup(group, initialTab) {
    navigation.navigate('Group', { groupId: group.id, name: group.name, initialTab });
  }

  function handleCreate(name) {
    setAskingName(false);
    const group = addGroup(name);
    openGroup(group, 'members'); // a new group needs members first
  }

  // DEV ONLY: create the three-meals example and jump to its balances.
  // Expected: A +200, B +400, C -250, D -350.
  function handleLoadTestData() {
    try {
      const group = loadTestData();
      openGroup(group, 'balances');
    } catch (error) {
      Alert.alert('Test data failed', error.message);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[
          styles.content,
          // Below the status bar at the top. At the bottom, room for the
          // pinned "New group" bar plus a small gap, so the credit line at
          // the end of the list is never hidden behind it.
          { paddingTop: insets.top + 40, paddingBottom: insets.bottom + PINNED_BAR_HEIGHT + 12 },
        ]}
      >
        {signedIn && (
          <View style={[styles.corners, { top: insets.top + 8 }]}>
            <IconButton
              label={invites.length > 0 ? `Invitations, ${invites.length} waiting` : 'Invitations'}
              onPress={() => navigation.navigate('Invitations')}
              badge={invites.length}
            >
              <Mail size={24} color={colors.ink} strokeWidth={2} />
            </IconButton>
            <IconButton label="Me" onPress={() => navigation.navigate('Me')}>
              <User size={24} color={colors.ink} strokeWidth={2} />
            </IconButton>
          </View>
        )}

        {/* The app logo in place of a text title. The label lets screen readers
            still announce the app name. */}
        <Image
          source={require('../../assets/yaarsplit-logo.png')}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="YaarSplit"
        />
        <Text style={styles.tagline}>Split every meal by who actually ate.</Text>
        {signedIn ? (
          <SyncStatus style={styles.syncStatus} />
        ) : (
          <Pressable
            onPress={() => navigation.navigate('SignUp')}
            accessibilityRole="button"
            hitSlop={8}
            style={styles.syncStatus}
          >
            <Text style={styles.signUpLink}>Sign up to share groups with friends</Text>
          </Pressable>
        )}

        {invites.length > 0 && (
          <Pressable
            onPress={() => navigation.navigate('Invitations')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.banner, pressed && styles.rowPressed]}
          >
            <Mail size={20} color={colors.gets} strokeWidth={2} />
            <Text style={styles.bannerText}>
              {invites.length === 1
                ? `${invites[0].invited_by_name ?? 'Someone'} invited you to “${invites[0].group_name}”`
                : `You have ${invites.length} invitations`}
            </Text>
          </Pressable>
        )}

        {groups.length === 0 ? (
          <Text style={styles.empty}>
            No groups yet. Create one for your next trip or hangout.
          </Text>
        ) : (
          <Card inset={74} style={styles.card}>
            {groups.map((group, index) => (
              <GroupRow
                key={group.id}
                group={group}
                index={index}
                onPress={() => openGroup(group)}
              />
            ))}
          </Card>
        )}

        {__DEV__ && (
          <View style={styles.devButton}>
            <AppButton title="Load test data" variant="secondary" small onPress={handleLoadTestData} />
          </View>
        )}

        <CreditLine />
      </ScrollView>

      {/* Pinned to the bottom of the screen, above the home bar. */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 16 }]}>
        <AppButton title="New group" icon={Plus} onPress={() => setAskingName(true)} />
      </View>

      <TextPromptModal
        visible={askingName}
        title="New group"
        placeholder="e.g. Kund Malir trip"
        submitLabel="Create"
        onSubmit={handleCreate}
        onCancel={() => setAskingName(false)}
      />
    </View>
  );
}

// A round icon button in the top corner, with an optional count badge.
function IconButton({ label, onPress, badge, children }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && styles.rowPressed]}
    >
      {children}
      {badge > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

// "Built with ♥ by Jiand Baloch" — the last thing in the scrolling list.
// With only a few groups (or none) it's pushed down to sit just above "New
// group" (marginTop: 'auto' in styles.credit); with many, it follows the
// last group. Screen readers hear one sentence instead of separate pieces.
function CreditLine() {
  return (
    <View style={styles.credit} accessible accessibilityLabel="Built with love by Jiand Baloch">
      <Text style={styles.creditText}>Built with </Text>
      <Heart size={13} color={colors.owes} fill={colors.owes} strokeWidth={2} />
      <Text style={styles.creditText}> by Jiand Baloch</Text>
    </View>
  );
}

// One group row. The right side shows what's left to settle, "Settled up",
// or nothing for a brand-new group with no expenses.
function GroupRow({ group, index, onPress }) {
  const { memberCount, totalSpent, toSettle } = group.summary;
  const settled = toSettle === 0;

  // Groups with money still to settle alternate blue and orange tiles so the
  // list is easy to scan; settled groups get a quiet grey tile.
  const tone = settled ? 'plain' : index % 2 === 0 ? 'gets' : 'owes';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <LetterTile letter={group.name[0].toUpperCase()} tone={tone} />
      <View style={styles.rowText}>
        <Text style={styles.groupName} numberOfLines={2}>
          {group.name}
        </Text>
        <Text style={styles.groupInfo} numberOfLines={1}>
          {describeGroup(memberCount, totalSpent)}
        </Text>
      </View>

      {!settled && (
        <View style={styles.status}>
          {/* One line only — a wrapped "Rs / 5,120" is hard to read. */}
          <Text style={styles.toSettle} numberOfLines={1}>
            {formatRupees(toSettle)}
          </Text>
          <Text style={styles.statusCaption}>to settle</Text>
        </View>
      )}
      {settled && totalSpent > 0 && (
        <View style={styles.settled}>
          <Check size={16} color={colors.muted} strokeWidth={2.25} />
          <Text style={styles.statusCaption}>Settled up</Text>
        </View>
      )}
    </Pressable>
  );
}

// Height of the pinned "New group" bar, not counting the home-bar inset:
// 12 padding above + 56 button + 16 padding below (see styles.bottomBar).
const PINNED_BAR_HEIGHT = 12 + 56 + 16;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  content: {
    flexGrow: 1, // fill the screen, so the credit line can sit at the bottom
    paddingHorizontal: 16,
  },
  logo: {
    // A fixed 180 x 117 box. 117 = 180 × 476 / 733, the image file's own
    // shape, so the logo fills the box without being stretched. Both sizes
    // are set explicitly: with only a width, the image can fall back to its
    // full 733px size and spill off the screen.
    width: 180,
    height: 117,
    alignSelf: 'center', // centred, and never stretched to full width
  },
  tagline: {
    ...text.small,
    fontSize: 16,
    textAlign: 'center', // centred under the logo
    marginTop: 8,
  },
  syncStatus: {
    alignSelf: 'center',
    marginTop: 10,
  },
  signUpLink: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.gets,
    textDecorationLine: 'underline',
  },
  card: {
    marginTop: 24,
  },
  corners: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.owes,
  },
  badgeText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.surface,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 20,
    padding: 16,
    borderRadius: 18,
    backgroundColor: colors.getsSoft,
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.gets,
  },
  empty: {
    ...text.small,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 48,
    marginHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  rowPressed: {
    backgroundColor: colors.fog,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  groupName: {
    ...text.bodyStrong,
    fontSize: 18,
  },
  groupInfo: {
    ...text.small,
    fontSize: 15,
    ...money,
  },
  status: {
    alignItems: 'flex-end',
    flexShrink: 0, // never squeeze the amount; the name wraps instead
  },
  toSettle: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.owes,
    ...money,
  },
  statusCaption: {
    ...text.small,
  },
  settled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  devButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  credit: {
    marginTop: 'auto', // push to the bottom when the list is short…
    paddingTop: 24, // …and keep a gap above it when the list is long
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.muted,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.fog,
  },
});
