// GroupScreen.js — one group, with three tabs: Expenses, Balances, Members.
//
// This screen loads the group's data and does the saving; the three tabs
// (in src/components) only display it and report taps back here.
//
// Route params (set by GroupsScreen):
//   groupId     which group to show
//   name        the group's name (shown in the header, see App.js)
//   initialTab  optional: 'expenses' (default), 'balances' or 'members'

import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Chip from '../components/Chip';
import ExpensesTab from '../components/ExpensesTab';
import BalancesTab from '../components/BalancesTab';
import MembersTab from '../components/MembersTab';
import { colors, space } from '../components/theme';
import {
  addMember,
  addPayment,
  deleteMember,
  listExpenses,
  listMembers,
  listPayments,
} from '../db/queries';
import { computeBalances, settleUp } from '../logic/split';
import { formatRupees } from '../logic/format';

const TABS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'members', label: 'Members' },
];

export default function GroupScreen({ route, navigation }) {
  const { groupId, initialTab } = route.params;

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
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Chip key={t.key} label={t.label} selected={tab === t.key} onPress={() => setTab(t.key)} />
        ))}
      </View>

      {tab === 'expenses' && (
        <ExpensesTab
          expenses={expenses}
          names={names}
          canAdd={members.length > 0}
          onAddExpense={() => navigation.navigate('AddExpense', { groupId })}
        />
      )}
      {tab === 'balances' && (
        <BalancesTab
          members={members}
          balances={balances}
          transfers={transfers}
          names={names}
          onMarkPaid={handleMarkPaid}
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
    backgroundColor: colors.background,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
});
