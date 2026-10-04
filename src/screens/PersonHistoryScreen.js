// PersonHistoryScreen.js — everything between me and one other person in a
// group, newest first, with what's left after each step.
//
//   Bilal                       @bilal
//   You owe Bilal Rs 300
//   [ I paid Bilal ]  [ Bilal paid me ]
//
//   Dinner · 28 Sep, 9:10 PM                        Rs 1,000
//   You owe Bilal Rs 333
//   After this: You owe Bilal Rs 300
//
//   You paid Bilal · Rs 200 · 27 Sep, 3:20 PM
//   Waiting for Bilal to confirm
//   After this: You owe Bilal Rs 633
//
// The numbers come from historyBetween() in split.js: each expense adds
// what one of us owes the other because of it, each CONFIRMED payment takes
// it off. Pending, rejected and cancelled payments are listed but change
// nothing. The last "after this" is what's left between us now.
//
// With "Simplify debts" on, the group's settle-up may route money through
// someone else, so the screen says so.
//
// Opened from the Me screen or by tapping someone on the Members tab, only
// in shared groups (where the app knows which member is me).
//
// Route params: groupId, memberId (the other person)

import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import { CategoryTile } from '../components/IconTile';
import PaymentModal from '../components/PaymentModal';
import PaymentRow from '../components/PaymentRow';
import { askPaymentAnswer } from '../components/askPaymentAnswer';
import {
  addPayment,
  answerPayment,
  getGroup,
  getMe,
  listExpenses,
  listMembers,
  listMembersByIds,
  listPayments,
  paymentActions,
} from '../db/queries';
import { historyBetween } from '../logic/split';
import { categoryLabel, describeRemaining, formatRupees, formatWhen } from '../logic/format';
import { useAfterSync, usePullToRefresh } from '../sync/hooks';
import { colors, fonts, money, text } from '../theme';

/** Everything the screen shows, or null if the group or person is gone. */
function loadHistory(groupId, memberId) {
  const group = getGroup(groupId);
  const { meId } = getMe(groupId);
  const other = listMembersByIds(groupId, [memberId])[0];
  if (!group || !meId || !other) return null;

  const members = listMembers(groupId);
  const names = {};
  for (const m of listMembersByIds(groupId, [meId, memberId])) names[m.id] = m.name;
  for (const m of members) names[m.id] = m.name;

  // From my side: remaining > 0 means they owe me.
  const steps = historyBetween(meId, memberId, listExpenses(groupId), listPayments(groupId));
  const remaining = steps.length > 0 ? steps[steps.length - 1].remaining : 0;

  return {
    group,
    meId,
    other,
    names,
    remaining,
    steps: steps.reverse(), // newest first
  };
}

export default function PersonHistoryScreen({ route, navigation }) {
  const { groupId, memberId } = route.params;
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(() => loadHistory(groupId, memberId));
  // The payment being recorded: { fromId, toId, suggested } or null.
  const [paying, setPaying] = useState(null);
  const { refreshing, onRefresh } = usePullToRefresh();

  const reload = useCallback(() => setData(loadHistory(groupId, memberId)), [groupId, memberId]);
  useFocusEffect(reload);
  useAfterSync(reload);

  // Navigation title: the other person's name.
  const otherName = data?.other.name;
  useEffect(() => {
    if (otherName) navigation.setOptions({ title: otherName });
  }, [otherName, navigation]);

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text style={text.small}>There’s nothing to show here.</Text>
      </View>
    );
  }

  const { group, meId, other, names, remaining, steps } = data;
  // In this screen I'm "you": "You paid Bilal", "Bilal paid you".
  const nameOf = (id) => (id === meId ? 'you' : names[id] || 'Removed member');

  function handleSavePayment(amount) {
    const { fromId, toId } = paying;
    setPaying(null);
    const result = addPayment(groupId, { fromId, toId, amount });
    if (!result.ok) Alert.alert('Could not save payment', result.errors.join('\n'));
    reload();
  }

  function handleAnswer(payment, action) {
    askPaymentAnswer(payment, action, (id) => names[id] || 'Removed member', () => {
      const result = answerPayment(payment.id, action);
      if (!result.ok) Alert.alert('Could not save your answer', result.errors.join('\n'));
      reload();
    });
  }

  // What one expense did between us: "You owe Bilal Rs 333".
  function describeStep(change) {
    if (change === 0) return 'Nothing owed between you two';
    return describeRemaining(change, other.name);
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* --- Where we stand now --- */}
        <Card>
          <View style={styles.summary}>
            <Text style={text.small}>
              {other.username ? `@${other.username}` : 'Not on YaarSplit yet'}
              {other.deleted ? ' · removed from the group' : ''}
            </Text>
            <Text style={[styles.remaining, { color: remaining < 0 ? colors.owes : remaining > 0 ? colors.gets : colors.muted }]}>
              {describeRemaining(remaining, other.name)}
            </Text>
            {group.simplify_debts ? (
              <Text style={styles.note}>
                “Simplify debts” is on in {group.name}, so settle-up may ask someone else to pay instead.
              </Text>
            ) : null}
            {!other.deleted && (
              <View style={styles.buttons}>
                <AppButton
                  title={`I paid ${other.name}`}
                  variant="secondary"
                  small
                  onPress={() =>
                    setPaying({ fromId: meId, toId: other.id, suggested: remaining < 0 ? -remaining : undefined })
                  }
                />
                <AppButton
                  title={`${other.name} paid me`}
                  variant="secondary"
                  small
                  onPress={() =>
                    setPaying({ fromId: other.id, toId: meId, suggested: remaining > 0 ? remaining : undefined })
                  }
                />
              </View>
            )}
          </View>
        </Card>

        {/* --- Step by step, newest first --- */}
        <Text style={styles.sectionTitle}>History</Text>
        {steps.length === 0 ? (
          <Text style={styles.empty}>Nothing between you two yet.</Text>
        ) : (
          <Card>
            {steps.map((step) => {
              const after = `After this: ${describeRemaining(step.remaining, other.name)}`;
              if (step.kind === 'payment') {
                const payment = {
                  ...step.item,
                  actions: paymentActions(step.item),
                  receiverOnApp: step.item.toId === meId || Boolean(other.account_id),
                };
                return (
                  <PaymentRow
                    key={step.id}
                    payment={payment}
                    nameOf={nameOf}
                    footer={after}
                    onAnswer={(action) => handleAnswer(payment, action)}
                  />
                );
              }
              const expense = step.item;
              return (
                <Pressable
                  key={step.id}
                  onPress={() => navigation.navigate('ExpenseDetails', { groupId, expenseId: expense.id })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.expenseRow, pressed && styles.pressed]}
                >
                  <CategoryTile category={expense.category} />
                  <View style={styles.expenseText}>
                    <Text style={styles.expenseTitle} numberOfLines={1}>
                      {expense.description || categoryLabel(expense.category)}
                    </Text>
                    <Text style={styles.details}>
                      {formatRupees(expense.amount)} · {formatWhen(expense.created_at)}
                    </Text>
                    <Text style={styles.effect}>{describeStep(step.change)}</Text>
                    <Text style={styles.after}>{after}</Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        )}
      </ScrollView>

      {paying && (
        <PaymentModal
          fromName={names[paying.fromId] || 'Removed member'}
          toName={names[paying.toId] || 'Removed member'}
          suggested={paying.suggested}
          online
          iAmPayer={paying.fromId === meId}
          iAmReceiver={paying.toId === meId}
          receiverOnApp={paying.toId === meId || Boolean(other.account_id)}
          onSave={handleSavePayment}
          onCancel={() => setPaying(null)}
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
  content: {
    padding: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.fog,
  },
  summary: {
    padding: 18,
    gap: 8,
  },
  remaining: {
    fontFamily: fonts.display,
    fontSize: 24,
    ...money,
  },
  note: {
    ...text.small,
    lineHeight: 20,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 24,
    marginBottom: 10,
    marginLeft: 4,
  },
  empty: {
    ...text.small,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 16,
  },
  expenseRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  pressed: {
    backgroundColor: colors.fog,
  },
  expenseText: {
    flex: 1,
    gap: 3,
  },
  expenseTitle: {
    ...text.bodyStrong,
    fontSize: 17,
  },
  details: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
    ...money,
  },
  effect: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
  },
  after: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
    ...money,
  },
});
