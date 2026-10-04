// MembersTab.js — the "Members" tab on the group screen.
//
// A box to add a friend by name, then a card listing the members, each with
// their balance. Whether removing is allowed (balance must be 0) is decided
// by deleteMember() in queries.js; GroupScreen shows its message.
//
// In a group that only lives on this phone: tap a name to rename it, and a
// card at the top offers "Share group online" (needed before inviting).
//
// In an ONLINE group (shared through the server):
//   - "3 of 5 are on YaarSplit" at the top;
//   - under each name: "@nisar · admin", or "Not on YaarSplit yet";
//   - tapping someone opens the history between you two; the pencil
//     renames (only shown if you may: admins, or your own name);
//   - admins see each pending invite ("Invited @nisar · Expires in 6
//     days") with "Cancel invite", and an "Invite" button on everyone who
//     isn't on YaarSplit yet;
//   - "Remove" is only for admins, and only for people without an account.
//
// Props:
//   members         live members of the group
//   balances        { [memberId]: rupees }, shown under each name
//   meId            my member id, or null (a group only on this phone)
//   online          1 if the group is shared through the server
//   isAdmin         I may invite / remove (always true in a local group)
//   invites         admins: pending invites from the server, or null if
//                   they couldn't be loaded (e.g. offline)
//   canPutOnline    show the "Share group online" card
//   onPutOnline     "Share group online" tapped
//   onAddMember     called with the trimmed name
//   onRenameMember  called with the member to rename
//   onRemoveMember  called with the member when "Remove" is tapped
//   onInvite        called with the member when "Invite" is tapped
//   onCancelInvite  called with (invite, member) for "Cancel invite"
//   onOpenPerson    called with a member to show our history (online only)
//   refreshControl  pull-to-refresh (a <RefreshControl>)

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from './AppButton';
import Card from './Card';
import { LetterTile } from './IconTile';
import { ChevronRight, Pencil, Plus } from './icons';
import { describeBalance, describeExpiry } from '../logic/format';
import { colors, fonts, radius, text } from '../theme';

// Colour for the balance line under a name: blue gets, orange owes.
function balanceColor(balance) {
  if (balance > 0) return colors.gets;
  if (balance < 0) return colors.owes;
  return colors.muted;
}

// "Invited @nisar · Expires in 6 days" / "Invite link shared · Expired"
function describeInvite(invite) {
  const who = invite.kind === 'username' ? `Invited @${invite.username}` : 'Invite link shared';
  return `${who} · ${describeExpiry(invite.expires_at)}`;
}

export default function MembersTab({
  members,
  balances,
  meId,
  online,
  isAdmin,
  invites,
  canPutOnline,
  onPutOnline,
  onAddMember,
  onRenameMember,
  onRemoveMember,
  onInvite,
  onCancelInvite,
  onOpenPerson,
  refreshControl,
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  function handleAdd() {
    if (trimmed === '') return;
    onAddMember(trimmed);
    setName('');
  }

  const onApp = members.filter((m) => m.account_id).length;
  // The pending invite for each member slot (the server keeps one at most).
  const inviteFor = {};
  for (const invite of invites ?? []) inviteFor[invite.member_id] = invite;

  return (
    <ScrollView
      refreshControl={refreshControl}
      contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled" // so tapping "Add" works while typing
    >
      {canPutOnline && (
        <Card>
          <View style={styles.onlineCard}>
            <Text style={styles.name}>Share this group with friends</Text>
            <Text style={styles.small}>
              Put it online, then invite everyone. Each person sees the group on their own
              phone and can add expenses.
            </Text>
            <AppButton title="Share group online" variant="secondary" small onPress={onPutOnline} />
          </View>
        </Card>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Friend’s name"
          placeholderTextColor={colors.muted}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <AppButton title="Add" icon={Plus} onPress={handleAdd} disabled={trimmed === ''} />
      </View>

      {online && members.length > 0 ? (
        <Text style={styles.summary}>
          {onApp} of {members.length} {members.length === 1 ? 'is' : 'are'} on YaarSplit
          {isAdmin && onApp < members.length ? '. Invite the others below.' : '.'}
          {isAdmin && invites === null ? ' (Invites can’t be shown while offline.)' : ''}
        </Text>
      ) : null}

      {members.length === 0 ? (
        <Text style={styles.empty}>No members yet. Add your friends above.</Text>
      ) : (
        <Card inset={74}>
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              balance={balances[member.id] || 0}
              isMe={member.id === meId}
              online={online}
              invite={inviteFor[member.id]}
              // Invites need the server's list first (so we know there isn't
              // one already); offline (invites === null) the button hides.
              canInvite={Boolean(online && isAdmin && !member.account_id && invites)}
              canRename={!online || isAdmin || member.id === meId}
              canRemove={isAdmin && !member.account_id}
              onRename={() => onRenameMember(member)}
              onRemove={() => onRemoveMember(member)}
              onInvite={() => onInvite(member)}
              onCancelInvite={(invite) => onCancelInvite(invite, member)}
              // History "between us" only means something online, and not with myself.
              onOpen={online && meId && member.id !== meId ? () => onOpenPerson(member) : null}
            />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

// One member: tile, name, who they are on YaarSplit, any pending invite,
// balance; buttons on the right (they wrap underneath on narrow phones).
function MemberRow({
  member,
  balance,
  isMe,
  online,
  invite,
  canInvite,
  canRename,
  canRemove,
  onRename,
  onRemove,
  onInvite,
  onCancelInvite,
  onOpen,
}) {
  // What tapping the name area does: open our history (online), otherwise
  // rename (a local group, or my own row).
  const onPress = onOpen ?? (canRename ? onRename : null);

  // "@nisar · admin" / "Not on YaarSplit yet" (online groups only).
  let account = null;
  if (member.username) {
    account = `@${member.username}${member.role === 'admin' ? ' · admin' : ''}`;
  } else if (online) {
    account = 'Not on YaarSplit yet';
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={onOpen ? `History with ${member.name}` : `Rename ${member.name}`}
        style={({ pressed }) => [styles.mainArea, pressed && styles.pressed]}
      >
        <LetterTile letter={member.name[0].toUpperCase()} tone={member.account_id ? 'gets' : 'plain'} />
        <View style={styles.info}>
          <View style={styles.nameLine}>
            <Text style={styles.name} numberOfLines={1}>
              {member.name}
              {isMe ? ' (you)' : ''}
            </Text>
            {/* Without history to open, the whole area renames: show the pencil there. */}
            {!onOpen && canRename && <Pencil size={15} color={colors.muted} strokeWidth={2} />}
          </View>
          {account && (
            <Text style={styles.small} numberOfLines={1}>
              {account}
            </Text>
          )}
          {invite && (
            <Text style={styles.invite} numberOfLines={2}>
              {describeInvite(invite)}
            </Text>
          )}
          <Text style={[styles.balance, { color: balanceColor(balance) }]}>{describeBalance(balance)}</Text>
        </View>
        {onOpen && <ChevronRight size={20} color={colors.muted} strokeWidth={2} />}
      </Pressable>

      <View style={styles.buttons}>
        {onOpen && canRename && (
          <Pressable
            onPress={onRename}
            accessibilityRole="button"
            accessibilityLabel={`Rename ${member.name}`}
            hitSlop={8}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Pencil size={18} color={colors.muted} strokeWidth={2} />
          </Pressable>
        )}
        {canInvite &&
          (invite ? (
            <AppButton title="Cancel invite" variant="danger" small onPress={() => onCancelInvite(invite)} />
          ) : (
            <AppButton title="Invite" variant="secondary" small onPress={onInvite} />
          ))}
        {canRemove && <AppButton title="Remove" variant="danger" small onPress={onRemove} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 20,
    gap: 16,
  },
  onlineCard: {
    padding: 18,
    gap: 10,
    alignItems: 'flex-start',
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
  },
  summary: {
    ...text.small,
    marginHorizontal: 4,
  },
  empty: {
    ...text.small,
    textAlign: 'center',
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // buttons drop below on narrow phones
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  mainArea: {
    flex: 1,
    minWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: {
    opacity: 0.6,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    ...text.bodyStrong,
    fontSize: 17,
    flexShrink: 1,
  },
  small: {
    ...text.small,
    lineHeight: 19,
  },
  invite: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.owes,
  },
  balance: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 8,
  },
});
