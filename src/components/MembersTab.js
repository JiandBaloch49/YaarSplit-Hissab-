// MembersTab.js — the "Members" tab on the group screen.
//
// A box to add a friend by name, then a card listing the members, each with
// their balance and a "Remove" button. Tapping a member's name (marked with
// a pencil) renames them. Whether removing is allowed (balance must be 0) is
// decided by deleteMember() in queries.js; GroupScreen shows its message.
//
// Props:
//   members         live members of the group
//   balances        { [memberId]: rupees }, shown under each name
//   onAddMember     called with the trimmed name
//   onRenameMember  called with the member when their name is tapped
//   onRemoveMember  called with the member when "Remove" is tapped

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from './AppButton';
import Card from './Card';
import { LetterTile } from './IconTile';
import { Pencil, Plus } from './icons';
import { describeBalance } from '../logic/format';
import { colors, fonts, radius, text } from '../theme';

// Colour for the balance line under a name: blue gets, orange owes.
function balanceColor(balance) {
  if (balance > 0) return colors.gets;
  if (balance < 0) return colors.owes;
  return colors.muted;
}

export default function MembersTab({
  members,
  balances,
  onAddMember,
  onRenameMember,
  onRemoveMember,
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const trimmed = name.trim();

  function handleAdd() {
    if (trimmed === '') return;
    onAddMember(trimmed);
    setName('');
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}
      keyboardShouldPersistTaps="handled" // so tapping "Add" works while typing
    >
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

      {members.length === 0 ? (
        <Text style={styles.empty}>No members yet. Add your friends above.</Text>
      ) : (
        <Card inset={74}>
          {members.map((member) => {
            const balance = balances[member.id] || 0;
            return (
              <View key={member.id} style={styles.row}>
                {/* Tile + name + pencil = one tap target for renaming. */}
                <Pressable
                  onPress={() => onRenameMember(member)}
                  accessibilityRole="button"
                  accessibilityLabel={`Rename ${member.name}`}
                  style={({ pressed }) => [styles.renameArea, pressed && styles.pressed]}
                >
                  <LetterTile letter={member.name[0].toUpperCase()} />
                  <View style={styles.info}>
                    <View style={styles.nameLine}>
                      <Text style={styles.name} numberOfLines={1}>
                        {member.name}
                      </Text>
                      <Pencil size={15} color={colors.muted} strokeWidth={2} />
                    </View>
                    <Text style={[styles.balance, { color: balanceColor(balance) }]}>
                      {describeBalance(balance)}
                    </Text>
                  </View>
                </Pressable>
                <AppButton
                  title="Remove"
                  variant="danger"
                  small
                  onPress={() => onRemoveMember(member)}
                />
              </View>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 20,
    gap: 16,
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
  empty: {
    ...text.small,
    textAlign: 'center',
    marginTop: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  renameArea: {
    flex: 1,
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
  balance: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
});
