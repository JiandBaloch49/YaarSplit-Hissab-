// AddMoneyScreen.js — put money into the group fund.
//
// Pick who is giving and how much. The money goes to the fund holder, and
// is saved as a 'contribution' payment from the giver to the holder (see
// addPayment in queries.js) — so balances need no special maths.
//
// Route params: groupId

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import BigAmountInput from '../components/BigAmountInput';
import Chip from '../components/Chip';
import ErrorList from '../components/ErrorList';
import { addPayment, getGroup, listMembers } from '../db/queries';
import { parseRupees } from '../logic/format';
import { colors, text } from '../theme';

export default function AddMoneyScreen({ route, navigation }) {
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();

  // Read once when the screen opens (the sync DB API returns straight away).
  const [members] = useState(() => listMembers(groupId));
  const [holderId] = useState(() => getGroup(groupId)?.fund_holder_id ?? null);

  const [amountText, setAmountText] = useState('');
  const [giverId, setGiverId] = useState(null); // nobody picked yet
  const [errors, setErrors] = useState([]);

  const holderName = members.find((m) => m.id === holderId)?.name;

  function handleSave() {
    const result = addPayment(groupId, {
      fromId: giverId,
      toId: holderId,
      amount: parseRupees(amountText),
      type: 'contribution',
    });
    if (!result.ok) {
      setErrors(result.errors); // shown above the button; nothing saved
      return;
    }
    navigation.goBack();
  }

  if (!holderId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This group has no fund yet.</Text>
      </View>
    );
  }

  // The line under the chips, explaining where the money goes.
  let hint = `The money goes to ${holderName}, who holds the fund.`;
  if (giverId === holderId) hint = `${holderName} is putting in their own money.`;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <BigAmountInput value={amountText} onChange={setAmountText} autoFocus />

      <Text style={styles.label}>Who is giving?</Text>
      <View style={styles.chips}>
        {members.map((m) => (
          <Chip
            key={m.id}
            label={m.name}
            tone="gets"
            selected={giverId === m.id}
            onPress={() => setGiverId(m.id)}
          />
        ))}
      </View>
      <Text style={styles.hint}>{hint}</Text>

      <View style={styles.saveArea}>
        <ErrorList errors={errors} />
        <AppButton title="Add to fund" onPress={handleSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    padding: 24,
  },
  muted: {
    ...text.small,
    fontSize: 16,
  },
  label: {
    ...text.label,
    marginTop: 28,
    marginBottom: 10,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  hint: {
    ...text.small,
    fontSize: 15,
    marginTop: 12,
  },
  saveArea: {
    marginTop: 28,
    gap: 12,
  },
});
