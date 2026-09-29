// AddExpenseScreen.js — the form for adding OR editing an expense.
//
// Opened from the Expenses tab: "Add expense" opens it empty; tapping an
// expense row opens it pre-filled (header says "Edit expense", see App.js),
// with a "Delete expense" button at the bottom.
//
// The simple case needs no extra taps: equal split, one payer, everyone
// ticked. "More options" unlocks:
//   - Custom split: type each person's exact share
//   - Several payers: type how much each person paid
//
// Everything typed is passed to addExpense() / updateExpense(), which both
// run prepareExpense() (src/logic/split.js). If that finds problems, its
// messages are shown above the Save button and nothing is saved.
//
// Route params:
//   groupId    the group the expense belongs to
//   expenseId  only when editing: which expense to load

import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AmountInput from '../components/AmountInput';
import AppButton from '../components/AppButton';
import CheckRow from '../components/CheckRow';
import Chip from '../components/Chip';
import ErrorList from '../components/ErrorList';
import { colors, radius, space } from '../components/theme';
import {
  addExpense,
  deleteExpense,
  getExpense,
  listMembers,
  listMembersByIds,
  updateExpense,
} from '../db/queries';
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

// Turn [{ member_id, amount: 500 }] into { memberId: '500' } for the text
// boxes. `field` is 'amount' (payers) or 'share' (participants).
function toTextMap(list, field) {
  const map = {};
  for (const item of list) map[item.member_id] = String(item[field]);
  return map;
}

/**
 * Work out everything the form starts with. Runs once when the screen opens
 * (the sync DB API returns straight away).
 *
 * Returns { members, values, notFound }:
 *   members   who can be picked
 *   values    the starting value of every field
 *   notFound  true if we were asked to edit an expense that's gone
 */
function loadForm(groupId, expenseId) {
  const liveMembers = listMembers(groupId);

  // --- Adding: empty form, equal split, first member paid, everyone ticked ---
  if (!expenseId) {
    return {
      notFound: false,
      members: liveMembers,
      values: {
        title: '',
        amountText: '',
        category: 'food',
        paidBy: liveMembers[0]?.id,
        forIds: liveMembers.map((m) => m.id),
        splitType: 'equal',
        severalPayers: false,
        payerAmounts: {},
        shares: {},
      },
    };
  }

  // --- Editing: fill the form from the saved expense ---
  const expense = getExpense(expenseId);
  if (!expense) {
    return { notFound: true, members: liveMembers, values: null };
  }

  // An old expense may mention someone who has since been removed from the
  // group. Add them back to the form (marked "removed") so saving keeps them
  // in the expense instead of silently dropping them.
  const liveIds = new Set(liveMembers.map((m) => m.id));
  const usedIds = [...expense.payers, ...expense.participants].map((p) => p.member_id);
  const removedIds = [...new Set(usedIds)].filter((id) => !liveIds.has(id));
  const removedMembers = listMembersByIds(groupId, removedIds).map((m) => ({
    ...m,
    name: `${m.name} (removed)`,
  }));
  // Keep everyone in the order they joined — the same order used when it
  // was first saved — so an equal split gives leftover rupees to the same
  // people as before.
  const members = [...liveMembers, ...removedMembers].sort((a, b) => a.created_at - b.created_at);

  const severalPayers = expense.payers.length > 1;
  return {
    notFound: false,
    members,
    values: {
      title: expense.description,
      amountText: String(expense.amount),
      category: expense.category,
      // With one payer, they're the "Paid by" chip. With several, the chip
      // isn't used, so just default it to the first member.
      paidBy: severalPayers ? members[0]?.id : expense.payers[0].member_id,
      forIds: expense.participants.map((p) => p.member_id),
      splitType: expense.split_type,
      severalPayers,
      payerAmounts: severalPayers ? toTextMap(expense.payers, 'amount') : {},
      // Equal-split shares are always re-worked on save, so only custom
      // splits need their shares in the boxes.
      shares: expense.split_type === 'custom' ? toTextMap(expense.participants, 'share') : {},
    },
  };
}

export default function AddExpenseScreen({ route, navigation }) {
  const { groupId, expenseId } = route.params;
  const editing = Boolean(expenseId);

  // Read once when the screen opens. Members can't change while this form is
  // open, and reloading on focus would wipe what the user has picked.
  const [form] = useState(() => loadForm(groupId, expenseId));
  const { members } = form;
  const start = form.values || {}; // empty only when the expense is gone

  // --- Basic fields ---
  const [title, setTitle] = useState(start.title);
  const [amountText, setAmountText] = useState(start.amountText);
  const [category, setCategory] = useState(start.category);
  const [paidBy, setPaidBy] = useState(start.paidBy); // single payer
  const [forIds, setForIds] = useState(start.forIds); // who it was for

  // --- "More options" ---
  // Open straight away when editing an expense that uses them, so it's clear
  // why the form looks different.
  const [showMore, setShowMore] = useState(
    start.splitType === 'custom' || Boolean(start.severalPayers)
  );
  const [splitType, setSplitType] = useState(start.splitType); // 'equal' | 'custom'
  const [severalPayers, setSeveralPayers] = useState(start.severalPayers);
  const [payerAmounts, setPayerAmounts] = useState(start.payerAmounts); // { memberId: text }
  const [shares, setShares] = useState(start.shares); // { memberId: text }, custom split

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
    const input = buildInput();
    // Both run prepareExpense() first and save nothing if it finds problems.
    const result = editing ? updateExpense(expenseId, input) : addExpense(groupId, input);
    if (!result.ok) {
      setErrors(result.errors); // shown above the Save button; nothing saved
      return;
    }
    navigation.goBack(); // GroupScreen reloads when it comes back into focus
  }

  function handleDelete() {
    Alert.alert('Delete this expense?', 'It will be taken out of everyone’s balances.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteExpense(expenseId); // soft delete: deleted = 1, synced = 0
          navigation.goBack();
        },
      },
    ]);
  }

  if (form.notFound) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This expense was deleted.</Text>
      </View>
    );
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
        {editing && <AppButton title="Delete expense" variant="danger" onPress={handleDelete} />}
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
