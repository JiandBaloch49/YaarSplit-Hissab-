// MeScreen.js — "Me": what I owe and what I'm owed, in every shared group,
// and every payment I'm part of. Opened from the person icon on the Groups
// screen.
//
//   Nisar  @nisar
//   [ You owe Rs 300 ]  [ You get back Rs 450 ]
//   KUND MALIR TRIP
//     You owe Bilal                           Rs 300  >
//     Ali owes you                            Rs 450  >
//   PAYMENT HISTORY
//     You paid Bilal · Rs 200 · 28 Sep, 3:20 PM · Kund Malir trip
//     Waiting for Bilal to confirm                      [Cancel]
//
// "Whom I owe / who owes me" is each group's own settle-up list (so it
// follows the group's "Simplify debts" setting), filtered to me (myDebts in
// split.js). Only confirmed payments count; pending ones show in the
// history, waiting for an answer. Tap a person to see everything between
// you two (PersonHistoryScreen).
//
// Only groups shared through the server are here: in a group that only
// lives on this phone there's no "me".
//
// Everything comes from this phone's database, so it works offline. Pull
// down to sync.
//
// Route params: none.

import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Card from '../components/Card';
import PaymentRow from '../components/PaymentRow';
import { askPaymentAnswer } from '../components/askPaymentAnswer';
import { ChevronRight } from '../components/icons';
import {
  answerPayment,
  listExpenses,
  listMembers,
  listMembersByIds,
  listMyGroups,
  listPayments,
  paymentActions,
} from '../db/queries';
import { computeBalances, myDebts, settleUpFor } from '../logic/split';
import { formatRupees } from '../logic/format';
import { getAccount } from '../sync/account';
import { useAfterSync, usePullToRefresh } from '../sync/hooks';
import { colors, fonts, money, text } from '../theme';

/**
 * Everything the screen shows, read from the database:
 *   groups    [{ group, meId, iOwe, owedToMe, nameOf }]
 *   payments  my payments in every group, newest first, ready for PaymentRow
 *   totalOwe, totalOwed
 */
function loadMe() {
  const groups = [];
  const payments = [];
  for (const group of listMyGroups()) {
    const meId = group.my_member_id;
    const members = listMembers(group.id);
    const expenses = listExpenses(group.id);
    const groupPayments = listPayments(group.id);

    // Names, including anyone removed since (old payments may mention them).
    const mentioned = groupPayments.flatMap((p) => [p.fromId, p.toId]);
    const names = {};
    for (const m of listMembersByIds(group.id, [...new Set(mentioned)])) names[m.id] = m.name;
    for (const m of members) names[m.id] = m.name;
    const accountOf = {};
    for (const m of members) accountOf[m.id] = m.account_id;
    const nameOf = (id) => names[id] || 'Removed member';

    const balances = computeBalances(members, expenses, groupPayments);
    const transfers = settleUpFor(group.simplify_debts, balances, expenses, groupPayments);
    groups.push({ group, meId, nameOf, ...myDebts(meId, transfers) });

    for (const p of groupPayments) {
      if (p.fromId !== meId && p.toId !== meId) continue;
      payments.push({
        ...p,
        actions: paymentActions(p),
        receiverOnApp: Boolean(accountOf[p.toId]),
        groupName: group.name,
        // In my own history, I'm "you": "You paid Ali", "Ali paid you".
        nameOf: (id) => (id === meId ? 'you' : nameOf(id)),
      });
    }
  }
  payments.sort((a, b) => b.created_at - a.created_at);

  const sum = (list) => list.reduce((total, d) => total + d.amount, 0);
  return {
    groups,
    payments,
    totalOwe: groups.reduce((total, g) => total + sum(g.iOwe), 0),
    totalOwed: groups.reduce((total, g) => total + sum(g.owedToMe), 0),
  };
}

export default function MeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const account = getAccount();
  const [data, setData] = useState(loadMe);
  const { refreshing, onRefresh } = usePullToRefresh();

  const reload = useCallback(() => setData(loadMe()), []);
  useFocusEffect(reload);
  useAfterSync(reload);

  function handleAnswer(payment, action) {
    askPaymentAnswer(payment, action, payment.nameOf, () => {
      const result = answerPayment(payment.id, action);
      if (!result.ok) Alert.alert('Could not save your answer', result.errors.join('\n'));
      reload();
    });
  }

  const { groups, payments, totalOwe, totalOwed } = data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {account && (
        <View style={styles.who}>
          <Text style={styles.name}>{account.name}</Text>
          <Text style={text.small}>@{account.username}</Text>
        </View>
      )}

      {groups.length === 0 ? (
        <Text style={styles.empty}>
          Share a group online, or join one from Invitations, to see what you owe here.
        </Text>
      ) : (
        <>
          {/* --- Totals --- */}
          <View style={styles.totals}>
            <Card style={styles.total}>
              <View style={styles.totalInner}>
                <Text style={text.small}>You owe</Text>
                <Text style={[styles.totalAmount, { color: totalOwe ? colors.owes : colors.muted }]}>
                  {formatRupees(totalOwe)}
                </Text>
              </View>
            </Card>
            <Card style={styles.total}>
              <View style={styles.totalInner}>
                <Text style={text.small}>You get back</Text>
                <Text style={[styles.totalAmount, { color: totalOwed ? colors.gets : colors.muted }]}>
                  {formatRupees(totalOwed)}
                </Text>
              </View>
            </Card>
          </View>

          {/* --- One card per group --- */}
          {groups.map(({ group, iOwe, owedToMe, nameOf }) => (
            <View key={group.id}>
              <Pressable
                onPress={() => navigation.navigate('Group', { groupId: group.id, name: group.name })}
                accessibilityRole="button"
                hitSlop={6}
              >
                <Text style={styles.sectionTitle}>{group.name}</Text>
              </Pressable>
              <Card>
                {iOwe.length === 0 && owedToMe.length === 0 && (
                  <Text style={styles.settled}>You’re settled up here.</Text>
                )}
                {iOwe.map((debt) => (
                  <DebtRow
                    key={`owe-${debt.memberId}`}
                    label={`You owe ${nameOf(debt.memberId)}`}
                    amount={debt.amount}
                    color={colors.owes}
                    onPress={() => navigation.navigate('PersonHistory', { groupId: group.id, memberId: debt.memberId })}
                  />
                ))}
                {owedToMe.map((debt) => (
                  <DebtRow
                    key={`owed-${debt.memberId}`}
                    label={`${nameOf(debt.memberId)} owes you`}
                    amount={debt.amount}
                    color={colors.gets}
                    onPress={() => navigation.navigate('PersonHistory', { groupId: group.id, memberId: debt.memberId })}
                  />
                ))}
              </Card>
            </View>
          ))}

          {/* --- Every payment I'm part of --- */}
          <Text style={styles.sectionTitle}>Payment history</Text>
          {payments.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : (
            <Card>
              {payments.map((payment) => (
                <PaymentRow
                  key={payment.id}
                  payment={payment}
                  nameOf={payment.nameOf}
                  extra={payment.groupName}
                  onAnswer={(action) => handleAnswer(payment, action)}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

// "You owe Bilal   Rs 300  >" — tap for the history between you two.
function DebtRow({ label, amount, color, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Shows everything between you two"
      style={({ pressed }) => [styles.debtRow, pressed && styles.pressed]}
    >
      <Text style={styles.debtLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.debtAmount, { color }]}>{formatRupees(amount)}</Text>
      <ChevronRight size={20} color={colors.muted} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  who: {
    marginLeft: 4,
    marginBottom: 4,
  },
  name: {
    ...text.title,
  },
  empty: {
    ...text.small,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginVertical: 24,
    marginHorizontal: 12,
  },
  totals: {
    flexDirection: 'row',
    gap: 12,
  },
  total: {
    flex: 1,
  },
  totalInner: {
    padding: 16,
    gap: 4,
  },
  totalAmount: {
    fontFamily: fonts.display,
    fontSize: 26,
    ...money,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 16,
    marginBottom: 10,
    marginLeft: 4,
  },
  settled: {
    ...text.small,
    fontSize: 15,
    padding: 18,
  },
  debtRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 18,
  },
  pressed: {
    backgroundColor: colors.fog,
  },
  debtLabel: {
    ...text.body,
    fontSize: 17,
    flex: 1,
  },
  debtAmount: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    ...money,
  },
});
