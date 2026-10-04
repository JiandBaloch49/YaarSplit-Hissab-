// GroupScreen.js — one group, with three tabs: Expenses, Balances, Members.
//
// This screen loads the group's data and does the saving; the three tabs
// (in src/components) only display it and report taps back here.
//
// It draws its own header (back arrow, group name, "4 friends, Rs 8,500
// spent", the sync status for shared groups, and a "..." menu) instead of
// the standard one, to match the design. The tabs are a segmented control
// underneath.
//
// The group fund card sits at the top of the Expenses tab: "Hammal is
// holding Rs 1,000" with "Add money" / "View history", or a small "Start a
// group fund" link when there's no fund yet.
//
// Shared (online) groups follow the server's rules (see queries.js), and
// this screen hides what you aren't allowed to do:
//   - "Mark as paid" opens PaymentModal (the amount can be lowered for a
//     partial payment). "I paid Nisar" is pending until Nisar confirms;
//     pending payments don't change balances.
//   - Received / Didn't receive / Cancel answer a pending payment.
//   - Admins flip "Simplify debts", invite people and cancel invites. The
//     pending invites come from the server (they aren't stored on the phone),
//     so they're fetched when the screen opens and after every sync.
// A group that only lives on this phone can be put online from the "..."
// menu or the Members tab: "Which one is you?" → putGroupOnline().
//
// Pull down on any tab to sync now. The screen reloads by itself when a
// sync brings changes from friends.
//
// Route params (set by GroupsScreen):
//   groupId     which group to show
//   name        the group's name, shown until the group is loaded
//   initialTab  optional: 'expenses' (default), 'balances' or 'members'

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SegmentedControl from '../components/SegmentedControl';
import ExpensesTab from '../components/ExpensesTab';
import BalancesTab from '../components/BalancesTab';
import MembersTab from '../components/MembersTab';
import ActionMenu from '../components/ActionMenu';
import FundCard from '../components/FundCard';
import PaymentModal from '../components/PaymentModal';
import { askPaymentAnswer } from '../components/askPaymentAnswer';
import SyncStatus from '../components/SyncStatus';
import TextPromptModal from '../components/TextPromptModal';
import { useAfterUndo, useUndo } from '../components/UndoBar';
import { ChevronLeft, Ellipsis } from '../components/icons';
import { colors, text } from '../theme';
import {
  addMember,
  addPayment,
  answerPayment,
  deleteGroup,
  deleteMember,
  deletePayment,
  getGroup,
  getMe,
  listExpenses,
  listMembers,
  listPayments,
  paymentActions,
  renameGroup,
  renameMember,
  restorePayment,
  setFundHolder,
  setSimplifyDebts,
} from '../db/queries';
import { computeBalances, fundSummary, settleUpFor, summarizeGroup } from '../logic/split';
import { describeGroup, formatRupees } from '../logic/format';
import { getAccount } from '../sync/account';
import { ApiError } from '../sync/api';
import { putGroupOnline } from '../sync/engine';
import { useAfterSync, usePullToRefresh } from '../sync/hooks';
import { cancelInvite, listGroupInvites } from '../sync/invites';

const TABS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'balances', label: 'Balances' },
  { key: 'members', label: 'Members' },
];

// A readable message for a failed server call (OfflineError / ApiError).
function serverMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'Couldn’t reach the YaarSplit server. Check your internet and try again.';
}

export default function GroupScreen({ route, navigation }) {
  const { groupId, name, initialTab } = route.params;
  const insets = useSafeAreaInsets(); // space taken by the notch / status bar

  const { showUndo } = useUndo();
  const { refreshing, onRefresh } = usePullToRefresh();

  const [tab, setTab] = useState(initialTab || 'expenses');
  // The group row, until loaded just enough to draw the header.
  const [group, setGroup] = useState({ name, fund_holder_id: null, simplify_debts: 1, online: 0 });
  // Who I am here: { online, meId, isAdmin } (see getMe in queries.js).
  const [me, setMe] = useState(() => getMe(groupId));
  const [members, setMembers] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  // Admins of online groups: pending invites from the server, or null if
  // they couldn't be loaded (offline). [] for everyone else.
  const [invites, setInvites] = useState([]);

  const [menuOpen, setMenuOpen] = useState(false); // the "..." menu
  const [pickingHolder, setPickingHolder] = useState(false); // "Start a group fund"
  const [pickingMe, setPickingMe] = useState(false); // "Share group online": which one is you?
  // The payment being recorded: { fromId, toId, suggested } or null.
  const [paying, setPaying] = useState(null);
  // What the rename pop-up is renaming: { kind: 'group' },
  // { kind: 'member', member }, or null when it's closed.
  const [renaming, setRenaming] = useState(null);

  // Read everything for this group from the database.
  const reload = useCallback(() => {
    const row = getGroup(groupId);
    if (!row) {
      // Deleted, or I was removed from it on the server: nothing to show.
      navigation.goBack();
      return;
    }
    setGroup(row);
    setMe(getMe(groupId));
    setMembers(listMembers(groupId));
    setExpenses(listExpenses(groupId));
    setPayments(listPayments(groupId));
  }, [groupId, navigation]);

  // Pending invites, for admins of online groups (asks the server).
  const loadInvites = useCallback(async () => {
    const { online, isAdmin } = getMe(groupId);
    if (!online || !isAdmin) {
      setInvites([]);
      return;
    }
    try {
      setInvites(await listGroupInvites(groupId));
    } catch {
      setInvites(null); // offline: the Members tab says so
    }
  }, [groupId]);

  const reloadAll = useCallback(() => {
    reload();
    loadInvites();
  }, [reload, loadInvites]);

  // Reload whenever this screen comes into view — e.g. after saving a new
  // expense on the Add Expense screen, or inviting someone, and coming back.
  useFocusEffect(reloadAll);
  // ...and when a sync brought something new (a friend's expense, someone
  // accepting an invite).
  useAfterSync(reloadAll);

  // Reload after "Undo" is tapped on the undo bar, so the restored expense
  // or payment reappears straight away.
  useAfterUndo(reload);

  async function handleRefresh() {
    await onRefresh(); // syncs; useAfterSync reloads if anything changed
    loadInvites();
  }
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />;

  // --- Maths (pure functions from split.js), redone on every render ---
  // This is cheap for a friend group, and means it can never get out of date.
  const holderId = group.fund_holder_id;
  const balances = computeBalances(members, expenses, payments);
  const { memberCount, totalSpent, toSettle } = summarizeGroup(members, expenses, payments);
  // The group fund's numbers, or null when there's no fund.
  const fund = holderId ? fundSummary({ fund_holder_id: holderId }, expenses, payments) : null;

  // { [memberId]: name } so the tabs can show names instead of ids.
  const names = {};
  for (const member of members) names[member.id] = member.name;
  const nameOf = (id) => names[id] || 'Removed member';

  // Is this member on YaarSplit (an account linked)? In a group that only
  // lives on this phone nobody needs to be, so it counts as yes.
  const onApp = (id) => !me.online || Boolean(members.find((m) => m.id === id)?.account_id);

  // Settle-up, following the group's "Simplify debts" setting, with what
  // the Balances tab needs to show for each row.
  const transfers = settleUpFor(group.simplify_debts, balances, expenses, payments).map((t) => ({
    ...t,
    receiverOnApp: onApp(t.toId),
    // Online, you can only record money you gave or got.
    canMark: !me.online || t.fromId === me.meId || t.toId === me.meId,
    // Already a payment waiting for an answer: don't offer to pay twice.
    waiting: payments.some(
      (p) => p.status === 'pending' && p.type === 'settlement' && p.fromId === t.fromId && p.toId === t.toId
    ),
  }));

  // Paying-back payments, with the buttons each one gets. (Money in and out
  // of the group fund is listed on the fund screen instead.)
  const settlementPayments = payments
    .filter((p) => p.type === 'settlement')
    .map((p) => ({
      ...p,
      actions: paymentActions(p),
      canDelete: !me.online, // shared payments are cancelled/rejected, never deleted
      receiverOnApp: onApp(p.toId),
    }));

  // --- Actions ---

  // The same function on every render, so ActionMenu doesn't re-attach its
  // Android back-button listener each time.
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeHolderPicker = useCallback(() => setPickingHolder(false), []);
  const closeMePicker = useCallback(() => setPickingMe(false), []);

  // Show a refusal from queries.js ({ ok: false, errors }), if there is one.
  function showIfRefused(title, result) {
    if (!result.ok) Alert.alert(title, result.errors.join('\n'));
  }

  // "Start a group fund" → pick the holder → straight on to adding money.
  function handleStartFund(memberId) {
    const result = setFundHolder(groupId, memberId);
    if (!result.ok) {
      Alert.alert('Could not start the fund', result.errors.join('\n'));
      return;
    }
    reload();
    navigation.navigate('AddMoney', { groupId });
  }

  // "Mark as paid" on a settle-up row: ask how much (partial is fine).
  function handleMarkPaid(transfer) {
    setPaying({ fromId: transfer.fromId, toId: transfer.toId, suggested: transfer.amount });
  }

  function handleSavePayment(amount) {
    const { fromId, toId } = paying;
    setPaying(null);
    showIfRefused('Could not save payment', addPayment(groupId, { fromId, toId, amount }));
    reload();
  }

  // Received / Didn't receive / Cancel on a pending payment (asks first
  // for the last two, see askPaymentAnswer.js).
  function handleAnswerPayment(payment, action) {
    askPaymentAnswer(payment, action, nameOf, () => {
      showIfRefused('Could not save your answer', answerPayment(payment.id, action));
      reload();
    });
  }

  // Remove a payment (e.g. "Mark as paid" tapped by mistake) — only in
  // groups that live on this phone. It's a soft delete, so the balances
  // simply go back to how they were before it.
  // Deletes straight away — no "Are you sure?"; the Undo bar is the safety net.
  function handleDeletePayment(payment) {
    const result = deletePayment(payment.id); // soft delete: deleted = 1
    if (!result.ok) {
      showIfRefused('Can’t delete this payment', result);
      return;
    }
    reload();
    showUndo('Payment deleted.', () => restorePayment(payment.id));
  }

  function handleSetSimplify(on) {
    showIfRefused('Can’t change this', setSimplifyDebts(groupId, on));
    reload();
  }

  function handleAddMember(newName) {
    addMember(groupId, newName);
    reload();
  }

  // Called with the new name from the rename pop-up (group or member).
  function handleRename(newName) {
    const result =
      renaming.kind === 'group' ? renameGroup(groupId, newName) : renameMember(renaming.member.id, newName);
    setRenaming(null);
    showIfRefused('Can’t rename', result);
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
    Alert.alert(`Delete “${group.name}”?`, 'The group will disappear from your list.', [
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
          showIfRefused(`Can't remove ${member.name}`, deleteMember(member.id));
          reload();
        },
      },
    ]);
  }

  // --- Sharing the group and inviting ---

  // "Share group online": needs an account and at least one member (me).
  function handlePutOnline() {
    if (!getAccount()) {
      Alert.alert('Make an account first', 'Friends find you by your username.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Make account', onPress: () => navigation.navigate('SignUp') },
      ]);
      return;
    }
    if (members.length === 0) {
      Alert.alert('Add people first', 'Add yourself and your friends in the Members tab.');
      return;
    }
    setPickingMe(true);
  }

  async function handlePickMe(memberId) {
    try {
      await putGroupOnline(groupId, memberId);
    } catch (error) {
      Alert.alert('Couldn’t share the group', serverMessage(error));
      return;
    }
    reloadAll();
    setTab('members');
    Alert.alert('Your group is online', 'Now invite your friends: tap “Invite” next to each name.');
  }

  function handleCancelInvite(invite, member) {
    Alert.alert(`Cancel the invite for ${member.name}?`, 'The invite stops working straight away.', [
      { text: 'Back', style: 'cancel' },
      {
        text: 'Cancel invite',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelInvite(invite.id);
          } catch (error) {
            Alert.alert('Couldn’t cancel the invite', serverMessage(error));
          }
          loadInvites();
        },
      },
    ]);
  }

  // The "..." menu: only what I'm allowed to do here.
  const menuOptions = [
    (!me.online || me.isAdmin) && { label: 'Rename group', onPress: () => setRenaming({ kind: 'group' }) },
    !me.online && { label: 'Share group online', onPress: handlePutOnline },
    me.isAdmin && { label: 'Delete group', onPress: handleDeleteGroup, destructive: true },
  ].filter(Boolean);

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
            {group.name}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {describeGroup(memberCount, totalSpent)}
          </Text>
          {me.online ? <SyncStatus style={styles.syncStatus} /> : null}
        </View>
        {menuOptions.length > 0 && (
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Group options"
            hitSlop={12}
            style={styles.menuButton}
          >
            <Ellipsis size={24} color={colors.ink} strokeWidth={2.25} />
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      </View>

      {tab === 'expenses' && (
        <ExpensesTab
          expenses={expenses}
          names={names}
          canAdd={members.length > 0}
          refreshControl={refreshControl}
          onAddExpense={() => navigation.navigate('AddExpense', { groupId })}
          // Tapping a row shows its details (with Edit and Delete buttons).
          onOpenExpense={(expense) =>
            navigation.navigate('ExpenseDetails', { groupId, expenseId: expense.id })
          }
          header={
            <FundCard
              fund={fund}
              holderName={nameOf(holderId)}
              canStart={members.length > 0}
              onStart={() => setPickingHolder(true)}
              onAddMoney={() => navigation.navigate('AddMoney', { groupId })}
              onViewFund={() => navigation.navigate('Fund', { groupId })}
            />
          }
        />
      )}
      {tab === 'balances' && (
        <BalancesTab
          members={members}
          balances={balances}
          transfers={transfers}
          payments={settlementPayments}
          names={names}
          meId={me.meId}
          simplify={group.simplify_debts}
          canSetSimplify={me.isAdmin}
          onSetSimplify={handleSetSimplify}
          onMarkPaid={handleMarkPaid}
          onAnswerPayment={handleAnswerPayment}
          onDeletePayment={handleDeletePayment}
          refreshControl={refreshControl}
        />
      )}
      {tab === 'members' && (
        <MembersTab
          members={members}
          balances={balances}
          meId={me.meId}
          online={me.online}
          isAdmin={me.isAdmin}
          invites={invites}
          canPutOnline={!me.online}
          onPutOnline={handlePutOnline}
          onAddMember={handleAddMember}
          onRenameMember={(member) => setRenaming({ kind: 'member', member })}
          onRemoveMember={handleRemoveMember}
          onInvite={(member) => navigation.navigate('InviteMember', { groupId, memberId: member.id })}
          onCancelInvite={handleCancelInvite}
          onOpenPerson={(member) => navigation.navigate('PersonHistory', { groupId, memberId: member.id })}
          refreshControl={refreshControl}
        />
      )}

      {/* Only rendered while open, so it starts with the current name. */}
      {renaming && (
        <TextPromptModal
          visible
          title={renaming.kind === 'group' ? 'Rename group' : `Rename ${renaming.member.name}`}
          initialValue={renaming.kind === 'group' ? group.name : renaming.member.name}
          submitLabel="Save"
          onSubmit={handleRename}
          onCancel={() => setRenaming(null)}
        />
      )}

      {/* "Mark as paid": how much? Only rendered while open. */}
      {paying && (
        <PaymentModal
          fromName={nameOf(paying.fromId)}
          toName={nameOf(paying.toId)}
          suggested={paying.suggested}
          online={me.online}
          iAmPayer={paying.fromId === me.meId}
          iAmReceiver={paying.toId === me.meId}
          receiverOnApp={onApp(paying.toId)}
          onSave={handleSavePayment}
          onCancel={() => setPaying(null)}
        />
      )}

      {/* Last, so it's drawn on top of everything else on this screen. */}
      <ActionMenu visible={menuOpen} onClose={closeMenu} options={menuOptions} />

      {/* "Start a group fund": choose who holds the cash. */}
      <ActionMenu
        visible={pickingHolder}
        title="Who will hold the fund’s money?"
        onClose={closeHolderPicker}
        options={members.map((member) => ({
          key: member.id,
          label: member.name,
          onPress: () => handleStartFund(member.id),
        }))}
      />

      {/* "Share group online": which member slot is my account? */}
      <ActionMenu
        visible={pickingMe}
        title="Which one is you? You’ll be the group’s admin."
        onClose={closeMePicker}
        options={members.map((member) => ({
          key: member.id,
          label: member.name,
          onPress: () => handlePickMe(member.id),
        }))}
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
  syncStatus: {
    marginTop: 2,
  },
  tabs: {
    paddingHorizontal: 16,
  },
});
