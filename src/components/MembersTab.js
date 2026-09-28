// MembersTab.js — the "Members" tab on the group screen.
//
// A box to add a friend by name, then the list of members, each with a
// "Remove" button. Whether removing is allowed (balance must be 0) is
// decided by deleteMember() in queries.js; GroupScreen shows its message.
//
// Props:
//   members         live members of the group
//   balances        { [memberId]: rupees }, shown under each name
//   onAddMember     called with the trimmed name
//   onRemoveMember  called with the member when "Remove" is tapped

import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import AppButton from './AppButton';
import { describeBalance } from '../logic/format';
import { colors, radius, space } from './theme';

export default function MembersTab({ members, balances, onAddMember, onRemoveMember }) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  function handleAdd() {
    if (trimmed === '') return;
    onAddMember(trimmed);
    setName('');
  }

  return (
    <FlatList
      data={members}
      keyExtractor={(member) => member.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled" // so tapping "Add" works while typing
      ListHeaderComponent={
        <View style={styles.addRow}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Friend's name"
            placeholderTextColor={colors.grey}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />
          <AppButton title="Add" onPress={handleAdd} disabled={trimmed === ''} />
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No members yet. Add your friends above.</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.info}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.balance}>{describeBalance(balances[item.id] || 0)}</Text>
          </View>
          <AppButton title="Remove" variant="danger" small onPress={() => onRemoveMember(item)} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    padding: space.lg,
    gap: space.sm,
  },
  addRow: {
    flexDirection: 'row',
    gap: space.sm,
    marginBottom: space.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    paddingHorizontal: space.md,
    fontSize: 16,
    color: colors.text,
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    color: colors.text,
  },
  balance: {
    fontSize: 14,
    color: colors.muted,
  },
});
