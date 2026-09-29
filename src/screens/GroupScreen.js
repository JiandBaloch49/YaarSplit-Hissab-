// GroupScreen.js — one group, with three tabs: Expenses, Balances, Members.
//
// This screen loads the group's data and does the saving; the three tabs
// (in src/components) only display it and report taps back here.
//
// It draws its own header (back arrow, group name, "4 friends, Rs 8,500
// spent", and a "..." menu with "Rename group" / "Delete group") instead of
// the standard one, to match the design. The tabs are a segmented control
// underneath.
//
// Route params (set by GroupsScreen):
//   groupId     which group to show
//   name        the group's name, shown until the group is loaded
//   initialTab  optional: 'expenses' (default), 'balances' or 'members'

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../components/SegmentedControl';
import ExpensesTab from '../components/ExpensesTab';
import BalancesTab from '../components/BalancesTab';
import MembersTab from '../components/MembersTab';
import ActionMenu from '../components/ActionMenu';
import TextPromptModal from '../components/TextPromptModal';
import { useAfterUndo, useUndo } from '../components/UndoBar';
import { ChevronLeft, Ellipsis } from '../components/icons';
import { colors, text } from '../theme';
import {
  addMember,
  addPayment,
  deleteGroup,
  deleteMember,
  deletePayment,
  getGroup,
  listExpenses,
  listMembers,
  listPayments,
  renameGroup,
  renameMember,
  restorePayment,
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

  const { showUndo } = useUndo();

  const [tab, setTab] = useState(initialTab || 'expenses');
  const [groupName, setGroupName] = useState(name);
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);

  const [menuOpen, setMenuOpen] = useState(false); // the "..." menu
  // What the rename pop-up is renaming: { kind: 'group' },
  // { kind: 'member', member }, or null when it's closed.
  const [renaming, setRenaming] = useState(null);

  // Read everything for this group from the database.
  const reload = useCallback(() => {
    const group = getGroup(groupId);
    if (group) setGroupName(group.name);
    setMembers(listMembers(groupId));
    setExpenses(listExpenses(groupId));
    setPayments(listPayments(groupId));
  }, [groupId]);

  // Reload whenever this screen comes into view — e.g. after saving a new
  // expense on the Add Expense screen and coming back.
  useFocusEffect(reload);

  // Reload after "Undo" is tapped on the undo bar, so the restored expense
  // or payment reappears straight away.
  useAfterUndo(reload);

  // --- Maths (pure functions from split.js), redone on every render ---
  // This is cheap for a friend group, and means it can never get out of date.
  const balances = computeBalances(members, expenses, payments);
  const transfers = settleUp(balances);
  const { memberCount, totalSpent, toSettle } = summarizeGroup(members, expenses, payments);

  // { [memberId]: name } so the tabs can show names instead of ids.
  const names = {};
  for (const member of members) names[member.id] = member.name;

  // --- Actions ---

  // The same function on every render, so ActionMenu doesn't re-attach its
  // Android back-button listener each time.
  const closeMenu = useCallback(() => setMenuOpen(false), []);

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
            deletePayment(payment.id); // soft delete: deleted = 1
            reload();
            showUndo('Payment deleted.', () => restorePayment(payment.id));
          },
        },
      ]
    );
  }

  function handleAddMember(name) {
    addMember(groupId, name);
    reload();
  }

  // Called with the new name from the rename pop-up (group or member).
  function handleRename(newName) {
    if (renaming.kind === 'group') {
      renameGroup(groupId, newName);
    } else {
      renameMember(renaming.member.id, newName);
    }
    setRenaming(null);
    reload();
  }

  function handleDeleteGroup() {
    // Blocked while money is still owed, so no debt quietly disappears.
    // (deleteGroup checks this too; checking here first means we don't ask
    // "Delete?" only to then say no.)
    if (toSettle > 0) {
      Alert.alert(
        'Can’t delete this group yet',
        `${formatRupees(toSettle)} is still to be settled. Settle up first.`
      );
      return;
    }
    Alert.alert(`Delete “${groupName}”?`, 'The group will disappear from your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const result = deleteGroup(groupId);
          if (!result.ok) {
            Alert.alert('Can’t delete this group yet', result.errors.join('\n'));
            return;
          }
          navigation.goBack(); // back to the Groups list
        },
      },
    ]);
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
            {groupName}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {describeGroup(memberCount, totalSpent)}
          </Text>
        </View>
        <Pressable
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Group options"
          hitSlop={12}
          style={styles.menuButton}
        >
          <Ellipsis size={24} color={colors.ink} strokeWidth={2.25} />
        </Pressable>
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
          // Tapping a row shows its details (with Edit and Delete buttons).
          onOpenExpense={(expense) =>
            navigation.navigate('ExpenseDetails', { groupId, expenseId: expense.id })
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
          onRenameMember={(member) => setRenaming({ kind: 'member', member })}
          onRemoveMember={handleRemoveMember}
        />
      )}

      {/* Only rendered while open, so it starts with the current name. */}
      {renaming && (
        <TextPromptModal
          visible
          title={renaming.kind === 'group' ? 'Rename group' : `Rename ${renaming.member.name}`}
          initialValue={renaming.kind === 'group' ? groupName : renaming.member.name}
          submitLabel="Save"
          onSubmit={handleRename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {/* Last, so it's drawn on top of everything else on this screen. */}
      <ActionMenu
        visible={menuOpen}
        onClose={closeMenu}
        options={[
          { label: 'Rename group', onPress: () => setRenaming({ kind: 'group' }) },
          { label: 'Delete group', onPress: handleDeleteGroup, destructive: true },
        ]}
      />
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
  menuButton: {
    padding: 6,
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
