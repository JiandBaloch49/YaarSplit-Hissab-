// AddExpenseScreen.js — the form for adding an expense to a group.
//
// The simple case needs no extra taps: equal split, one payer, everyone
// ticked. "More options" unlocks:
//   - Custom split: type each person's exact share
//   - Several payers: type how much each person paid
//
// Everything typed is passed to addExpense(), which runs prepareExpense()
// (src/logic/split.js). If that finds problems, its messages are shown above
// the Save button and nothing is saved.
//
// Route params: groupId

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AmountInput from '../components/AmountInput';
import AppButton from '../components/AppButton';
import CheckRow from '../components/CheckRow';
import Chip from '../components/Chip';
import ErrorList from '../components/ErrorList';
import { colors, radius, space } from '../components/theme';
import { addExpense, listMembers } from '../db/queries';
import { CATEGORIES } from '../logic/split';
import { categoryLabel, formatRupees, parseRupees } from '../logic/format';

// Add up typed amounts for the "so far" hints, ignoring anything that isn't
// a whole number yet (e.g. an empty box while the user is still typing).
function sumTyped(texts) {
  let total = 0;
  for (const text of texts) {
    const value = parseRupees(text);
    if (Number.isInteger(value)) total += value;
  }
  return total;
}

export default function AddExpenseScreen({ route, navigation }) {
  const { groupId } = route.params;

  // Members are read once when the screen opens (the sync API returns them
  // straight away). They can't change while this form is open, and reloading
  // on focus would risk wiping what the user has picked.
  const [members] = useState(() => listMembers(groupId));

  // --- Basic fields ---
  const [title, setTitle] = useState('');
  const [amountText, setAmountText] = useState('');
  const [category, setCategory] = useState('food');
  const [paidBy, setPaidBy] = useState(members[0]?.id); // single payer
  // Who it was for: everyone ticked by default.
  const [forIds, setForIds] = useState(() => members.map((m) => m.id));

  // --- "More options" ---
  const [showMore, setShowMore] = useState(false);
  const [splitType, setSplitType] = useState('equal'); // 'equal' | 'custom'
  const [severalPayers, setSeveralPayers] = useState(false);
  const [payerAmounts, setPayerAmounts] = useState({}); // { memberId: text }
  const [shares, setShares] = useState({}); // { memberId: text }, custom split

  const [errors, setErrors] = useState([]);

  const amount = parseRupees(amountText);
  // Show the total in hints only once it's a real whole number.
  const totalLabel = Number.isInteger(amount) ? formatRupees(amount) : '?';

  function toggleFor(memberId) {
    setForIds((ids) =>
      ids.includes(memberId) ? ids.filter((id) => id !== memberId) : [...ids, memberId]
    );
  }

  // Build the plain object prepareExpense() expects from what's on screen.
  function buildInput() {
    // Payers: either the one "Paid by" person paying the whole total, or
    // everyone who has an amount typed in (blank box = didn't pay).
    let payers;
    if (severalPayers) {
      payers = members
        .filter((m) => (payerAmounts[m.id] || '').trim() !== '')
        .map((m) => ({ member_id: m.id, amount: parseRupees(payerAmounts[m.id]) }));
    } else {
      payers = paidBy ? [{ member_id: paidBy, amount }] : [];
    }

    // Participants: ticked members, kept in member order. `name` is only
    // for readable error messages; prepareExpense drops it before saving.
    const participants = members
      .filter((m) => forIds.includes(m.id))
      .map((m) => {
        const participant = { member_id: m.id, name: m.name };
        if (splitType === 'custom') {
          // An empty share box counts as 0, so prepareExpense can say
          // "Remove Bilal or give them a share." instead of a vaguer message.
          const text = (shares[m.id] || '').trim();
          participant.share = text === '' ? 0 : parseRupees(text);
        }
        return participant;
      });

    return {
      description: title.trim(),
      amount,
      category,
      split_type: splitType,
      payers,
      participants,
    };
  }

  function handleSave() {
    const result = addExpense(groupId, buildInput());
    if (!result.ok) {
      setErrors(result.errors); // shown above the Save button; nothing saved
      return;
    }
    navigation.goBack(); // GroupScreen reloads when it comes back into focus
  }

  if (members.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Add members to this group first.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled" // taps on chips work while typing
      automaticallyAdjustKeyboardInsets // iOS: keep inputs above the keyboard
    >
      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Dinner at Monal"
        placeholderTextColor={colors.grey}
      />

      <Text style={styles.label}>Amount (Rs)</Text>
      <AmountInput value={amountText} onChangeText={setAmountText} />

      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={categoryLabel(c)}
            selected={category === c}
            onPress={() => setCategory(c)}
          />
        ))}
      </View>

      {/* More options: custom split and several payers. Placed above
          "Paid by" and "For whom" because it changes how those look. */}
      <AppButton
        title={showMore ? 'Hide options' : 'More options'}
        variant="secondary"
        small
        onPress={() => setShowMore(!showMore)}
      />
      {showMore && (
        <View style={styles.optionsBox}>
          <Text style={styles.label}>Split</Text>
          <View style={styles.chips}>
            <Chip label="Equally" selected={splitType === 'equal'} onPress={() => setSplitType('equal')} />
            <Chip label="Custom amounts" selected={splitType === 'custom'} onPress={() => setSplitType('custom')} />
          </View>

          <Text style={styles.label}>Who paid</Text>
          <View style={styles.chips}>
            <Chip label="One person" selected={!severalPayers} onPress={() => setSeveralPayers(false)} />
            <Chip label="Several people" selected={severalPayers} onPress={() => setSeveralPayers(true)} />
          </View>
        </View>
      )}

      {/* Paid by: one person (chips), or several people with amounts. */}
      <Text style={styles.label}>Paid by</Text>
      {severalPayers ? (
        <>
          {members.map((m) => (
            <View key={m.id} style={styles.amountRow}>
              <Text style={styles.rowName}>{m.name}</Text>
              <AmountInput
                compact
                value={payerAmounts[m.id] || ''}
                onChangeText={(text) => setPayerAmounts((prev) => ({ ...prev, [m.id]: text }))}
              />
            </View>
          ))}
          <Text style={styles.muted}>
            Paid so far: {formatRupees(sumTyped(Object.values(payerAmounts)))} of {totalLabel}
          </Text>
        </>
      ) : (
        <View style={styles.chips}>
          {members.map((m) => (
            <Chip
              key={m.id}
              label={m.name}
              selected={paidBy === m.id}
              onPress={() => setPaidBy(m.id)}
            />
          ))}
        </View>
      )}

      {/* For whom: tick who ate. With a custom split, each ticked person
          also gets a box for their exact share. */}
      <Text style={styles.label}>For whom</Text>
      {members.map((m) => {
        const checked = forIds.includes(m.id);
        return (
          <CheckRow key={m.id} label={m.name} checked={checked} onToggle={() => toggleFor(m.id)}>
            {splitType === 'custom' && checked && (
              <AmountInput
                compact
                value={shares[m.id] || ''}
                onChangeText={(text) => setShares((prev) => ({ ...prev, [m.id]: text }))}
              />
            )}
          </CheckRow>
        );
      })}
      {splitType === 'custom' && (
        <Text style={styles.muted}>
          Shares so far: {formatRupees(sumTyped(forIds.map((id) => shares[id])))} of {totalLabel}
        </Text>
      )}

      <View style={styles.saveArea}>
        <ErrorList errors={errors} />
        <AppButton title="Save" onPress={handleSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: space.lg,
    paddingBottom: space.xl * 2,
    gap: space.sm,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: space.xl,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.muted,
    marginTop: space.md,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
    fontSize: 16,
    color: colors.text,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap', // chips move onto a new line on narrow phones
    gap: space.sm,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.sm,
    paddingLeft: space.md,
  },
  rowName: {
    fontSize: 16,
    color: colors.text,
  },
  muted: {
    fontSize: 14,
    color: colors.muted,
  },
  optionsBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
    paddingTop: 0,
    gap: space.sm,
  },
  saveArea: {
    marginTop: space.lg,
    gap: space.md,
  },
});
