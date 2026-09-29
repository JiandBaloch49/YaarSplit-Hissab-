// AddExpenseScreen.js — the form for adding OR editing an expense.
//
// Opened from the Expenses tab: "Add expense" opens it empty; tapping an
// expense row opens it pre-filled (header says "Edit expense", see App.js),
// with a "Delete expense" button at the bottom.
//
// Layout follows the design: a big centred amount, category and "Paid by"
// as chips, and "For whom" as a checklist that shows each person's share
// live as you type (unticked people show "Didn't join").
//
// The simple case needs no extra taps: equal split, one payer, everyone
// ticked. "Custom split or several payers" unlocks:
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
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AmountInput from '../components/AmountInput';
import AppButton from '../components/AppButton';
import CheckRow from '../components/CheckRow';
import Chip from '../components/Chip';
import ErrorList from '../components/ErrorList';
import { ChevronDown, ChevronUp } from '../components/icons';
import { colors, fonts, money, radius, text } from '../theme';
import {
  addExpense,
  deleteExpense,
  getExpense,
  listMembers,
  listMembersByIds,
  updateExpense,
} from '../db/queries';
import { CATEGORIES, splitAmount } from '../logic/split';
import { categoryLabel, formatRupees, formatTypedAmount, parseRupees } from '../logic/format';

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
  const insets = useSafeAreaInsets(); // space taken by the phone's home bar

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

  // --- Live shares for the "For whom" checklist ---
  // Ticked people in member order — the same list and order buildInput()
  // gives prepareExpense(), so the preview matches what will be saved
  // (including who gets the leftover rupee).
  const tickedIds = members.filter((m) => forIds.includes(m.id)).map((m) => m.id);
  const amountOk = Number.isInteger(amount) && amount > 0;
  // { memberId: share } for an equal split; empty until there's a valid
  // amount and at least one person ticked.
  const equalShares =
    amountOk && tickedIds.length > 0 ? splitAmount(amount, tickedIds) : {};

  // The small text next to "For whom":
  //   equal, even split    → "Rs 400 each"
  //   equal, uneven split  → "Rs 333–Rs 334 each" (some get one extra rupee)
  //   custom split         → "Rs 700 of Rs 1,000"
  let forWhomHint = '';
  if (splitType === 'custom') {
    forWhomHint = `${formatRupees(sumTyped(tickedIds.map((id) => shares[id])))} of ${totalLabel}`;
  } else if (tickedIds.length > 0 && amountOk) {
    const values = Object.values(equalShares);
    const low = Math.min(...values);
    const high = Math.max(...values);
    forWhomHint =
      low === high ? `${formatRupees(low)} each` : `${formatRupees(low)}–${formatRupees(high)} each`;
  }

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
          const typed = (shares[m.id] || '').trim();
          participant.share = typed === '' ? 0 : parseRupees(typed);
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
      contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
      keyboardShouldPersistTaps="handled" // taps on chips work while typing
      automaticallyAdjustKeyboardInsets // iOS: keep inputs above the keyboard
    >
      {/* --- The big amount --- */}
      <Text style={styles.amountLabel}>Amount</Text>
      <View style={styles.amountRow}>
        <Text style={styles.amountRs}>Rs</Text>
        <TextInput
          style={styles.amountInput}
          // Shown with commas ("1,200"), stored without them ("1200").
          value={formatTypedAmount(amountText)}
          onChangeText={(typed) => setAmountText(typed.replace(/,/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.line}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={11} // 9 digits + 2 commas
          autoFocus={!editing} // a new expense starts with the amount
          accessibilityLabel="Amount in rupees"
        />
      </View>

      <Text style={styles.label}>What was it for?</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Lunch at Wadh"
        placeholderTextColor={colors.muted}
      />

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

      {/* --- Paid by: one person (blue chips), or several people with amounts --- */}
      <Text style={styles.label}>Paid by</Text>
      {severalPayers ? (
        <View>
          {members.map((m, index) => (
            <View key={m.id} style={[styles.listRow, index > 0 && styles.listDivider]}>
              <Text style={styles.listName} numberOfLines={1}>
                {m.name}
              </Text>
              <AmountInput
                value={payerAmounts[m.id] || ''}
                onChangeText={(typed) => setPayerAmounts((prev) => ({ ...prev, [m.id]: typed }))}
              />
            </View>
          ))}
          <Text style={styles.hint}>
            Paid so far: {formatRupees(sumTyped(Object.values(payerAmounts)))} of {totalLabel}
          </Text>
        </View>
      ) : (
        <View style={styles.chips}>
          {members.map((m) => (
            <Chip
              key={m.id}
              label={m.name}
              tone="gets"
              selected={paidBy === m.id}
              onPress={() => setPaidBy(m.id)}
            />
          ))}
        </View>
      )}

      {/* --- For whom: a checklist showing each person's share as you type --- */}
      <View style={styles.forWhomHeader}>
        <Text style={[styles.label, styles.labelInRow]}>For whom</Text>
        <Text style={styles.hint}>{forWhomHint}</Text>
      </View>
      <View>
        {members.map((m, index) => {
          const checked = forIds.includes(m.id);
          // Right side for a ticked person: their live equal share, or a box
          // to type their custom share. (Unticked shows "Didn't join".)
          const right =
            splitType === 'custom' ? (
              <AmountInput
                value={shares[m.id] || ''}
                onChangeText={(typed) => setShares((prev) => ({ ...prev, [m.id]: typed }))}
              />
            ) : (
              <Text style={styles.share}>
                {m.id in equalShares ? formatRupees(equalShares[m.id]) : '—'}
              </Text>
            );
          return (
            <View key={m.id} style={index > 0 && styles.listDivider}>
              <CheckRow
                label={m.name}
                checked={checked}
                onToggle={() => toggleFor(m.id)}
                right={right}
              />
            </View>
          );
        })}
      </View>

      {/* --- Custom split and several payers, tucked away until needed --- */}
      <Pressable
        onPress={() => setShowMore(!showMore)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showMore }}
        style={styles.moreLink}
        hitSlop={8}
      >
        <Text style={styles.moreLinkText}>Custom split or several payers</Text>
        {showMore ? (
          <ChevronUp size={18} color={colors.gets} strokeWidth={2.25} />
        ) : (
          <ChevronDown size={18} color={colors.gets} strokeWidth={2.25} />
        )}
      </Pressable>
      {showMore && (
        <View style={styles.optionsBox}>
          <Text style={[styles.label, styles.labelInBox]}>Split</Text>
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

      <View style={styles.saveArea}>
        <ErrorList errors={errors} />
        <AppButton title="Save expense" onPress={handleSave} />
        {editing && <AppButton title="Delete expense" variant="danger" onPress={handleDelete} />}
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

  // Big amount
  amountLabel: {
    ...text.small,
    fontSize: 16,
    textAlign: 'center',
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  amountRs: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.muted,
  },
  amountInput: {
    fontFamily: fonts.display,
    fontSize: 60,
    color: colors.ink,
    minWidth: 60,
    padding: 0, // Android adds padding to inputs by default
    ...money,
  },

  // Labels and inputs
  label: {
    ...text.label,
    marginTop: 22,
    marginBottom: 10,
  },
  labelInRow: {
    marginTop: 0,
    marginBottom: 0,
  },
  labelInBox: {
    marginTop: 0,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap', // chips move onto a new line on narrow phones
    gap: 8,
  },
  hint: {
    ...text.small,
    fontSize: 15,
    ...money,
  },

  // Lists (For whom, several payers)
  forWhomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 22,
    marginBottom: 2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 54,
    paddingVertical: 6,
  },
  listDivider: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.line,
  },
  listName: {
    ...text.body,
    fontSize: 17,
    flexShrink: 1,
  },
  share: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.ink,
    ...money,
  },

  // Custom split or several payers
  moreLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 20,
  },
  moreLinkText: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.gets,
  },
  optionsBox: {
    marginTop: 14,
    padding: 16,
    borderRadius: radius.input,
    backgroundColor: colors.fog,
  },

  saveArea: {
    marginTop: 28,
    gap: 12,
  },
});
