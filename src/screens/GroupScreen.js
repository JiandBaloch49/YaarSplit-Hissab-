// GroupScreen.js — one group, with three tabs: Expenses, Balances, Members.
//
// This screen loads the group's data and does the saving; the three tabs
// (in src/components) only display it and report taps back here.
//
// It draws its own header (back arrow, group name, "4 friends, Rs 8,500
// spent") instead of the standard one, to match the design. The tabs are a
// segmented control underneath.
//
// Route params (set by GroupsScreen):
//   groupId     which group to show
//   name        the group's name, shown at the top
//   initialTab  optional: 'expenses' (default), 'balances' or 'members'

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../components/SegmentedControl';
import ExpensesTab from '../components/ExpensesTab';
import BalancesTab from '../components/BalancesTab';
import MembersTab from '../components/MembersTab';
import { ChevronLeft } from '../components/icons';
import { colors, text } from '../theme';
import {
  addMember,
  addPayment,
  deleteMember,
  deletePayment,
  listExpenses,
  listMembers,
  listPayments,
} from '../db/queries';
import { computeBalances, settleUp, summarizeGroup } from '../logic/split';
import { describeGroup, formatRupees } from '../logic/format';

const TABS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'members', label: 'Members' },
];

export default function GroupScreen({ route, navigation }) {
  const { groupId, name, initialTab } = route.params;
  const insets = useSafeAreaInsets(); // space taken by the notch / status bar

  const [tab, setTab] = useState(initialTab || 'expenses');
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);

  // Read everything for this group from the database.
  const reload = useCallback(() => {
    setMembers(listMembers(groupId));
    setExpenses(listExpenses(groupId));
    setPayments(listPayments(groupId));
  }, [groupId]);

  // Reload whenever this screen comes into view — e.g. after saving a new
  // expense on the Add Expense screen and coming back.
  useFocusEffect(reload);

  // --- Maths (pure functions from split.js), redone on every render ---
  // This is cheap for a friend group, and means it can never get out of date.
  const balances = computeBalances(members, expenses, payments);
  const transfers = settleUp(balances);
  const { memberCount, totalSpent } = summarizeGroup(members, expenses, payments);

  // { [memberId]: name } so the tabs can show names instead of ids.
  const names = {};
  for (const member of members) names[member.id] = member.name;

  // --- Actions ---

  function handleMarkPaid(transfer) {
    const from = names[transfer.fromId] || 'Removed member';
    const to = names[transfer.toId] || 'Removed member';
    // Ask first: a mistaken tap would record a payment that never happened.
    Alert.alert('Mark as paid?', `${from} paid ${to} ${formatRupees(transfer.amount)}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Mark as paid',
        onPress: () => {
          const result = addPayment(groupId, transfer);
          if (!result.ok) {
            Alert.alert('Could not save payment', result.errors.join('\n'));
          }
          reload();
        },
      },
    ]);
  }

  // Undo a payment (e.g. "Mark as paid" tapped by mistake). It's a soft
  // delete, so the balances simply go back to how they were before it.
  function handleDeletePayment(payment) {
    const from = names[payment.fromId] || 'Removed member';
    const to = names[payment.toId] || 'Removed member';
    Alert.alert(
      'Delete this payment?',
      `${from} paid ${to} ${formatRupees(payment.amount)}. Balances will go back to before it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            deletePayment(payment.id);
            reload();
          },
        },
      ]
    );
  }

  function handleAddMember(name) {
    addMember(groupId, name);
    reload();
  }

  function handleRemoveMember(member) {
    Alert.alert(`Remove ${member.name}?`, 'They will be hidden from this group.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          // deleteMember refuses if their balance isn't 0 and says why,
          // e.g. "Bilal still owes 500. Settle up first."
          const result = deleteMember(member.id);
          if (!result.ok) {
            Alert.alert(`Can't remove ${member.name}`, result.errors.join('\n'));
          }
          reload();
        },
      },
    ]);
  }

  return (
    <View style={styles.screen}>
      {/* --- Header: back arrow, group name, and a one-line summary --- */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.back}
        >
          <ChevronLeft size={28} color={colors.ink} strokeWidth={2.25} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {describeGroup(memberCount, totalSpent)}
          </Text>
        </View>
      </View>

      <View style={styles.tabs}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      {tab === 'expenses' && (
        <ExpensesTab
          expenses={expenses}
          names={names}
          canAdd={members.length > 0}
          onAddExpense={() => navigation.navigate('AddExpense', { groupId })}
          // Same screen, pre-filled: passing expenseId switches it to editing.
          onOpenExpense={(expense) =>
            navigation.navigate('AddExpense', { groupId, expenseId: expense.id })
          }
        />
      )}
      {tab === 'balances' && (
        <BalancesTab
          members={members}
          balances={balances}
          transfers={transfers}
          payments={payments}
          names={names}
          onMarkPaid={handleMarkPaid}
          onDeletePayment={handleDeletePayment}
        />
      )}
      {tab === 'members' && (
        <MembersTab
          members={members}
          balances={balances}
          onAddMember={handleAddMember}
          onRemoveMember={handleRemoveMember}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  back: {
    padding: 4,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...text.title,
  },
  subtitle: {
    ...text.small,
    fontSize: 15,
  },
  tabs: {
    paddingHorizontal: 16,
  },
});
