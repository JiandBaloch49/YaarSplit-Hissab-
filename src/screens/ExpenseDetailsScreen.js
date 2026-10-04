// ExpenseDetailsScreen.js — everything about one expense, with clear "Edit"
// and "Delete" buttons. Opened by tapping an expense row.
//
//   [icon]  Dinner
//           Rs 3,000
//           Food · Sunday, 28 Sep
//   Paid by       Hammal  Rs 3,000
//   For whom      Hammal  Rs 750, Bilal Rs 750, ...
//   Didn't join   Naveed
//
// For a group-fund expense, "Paid by" shows how much came out of the fund
// and how much the holder added from their own pocket (if the fund ran out).
//
// Under the date: "Added by Bilal" and "Edited by Bilal, 3:20 PM" (once
// it's been edited). Groups that only live on this phone don't know who
// added what, so there it's just "Edited 3:20 PM".
//
// "Edit" opens the expense form pre-filled. "Delete" soft-deletes it right
// away and shows "Expense deleted. Undo" for 5 seconds. In a shared group
// only the person who added it, or an admin, can change it — for everyone
// else the two buttons are replaced by a line saying who can.
//
// Route params: groupId, expenseId

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import { CategoryTile } from '../components/IconTile';
import { useUndo } from '../components/UndoBar';
import { Pencil, Trash } from '../components/icons';
import {
  deleteExpense,
  expenseChangeRefusal,
  getExpense,
  getGroup,
  listExpenses,
  listMembers,
  listMembersByIds,
  listPayments,
  restoreExpense,
} from '../db/queries';
import { fundSummary } from '../logic/split';
import { categoryLabel, describeAuthors, formatDay, formatRupees } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

/**
 * Read the expense and the names needed to show it.
 * Returns null if the expense is gone (deleted).
 */
function loadDetails(groupId, expenseId) {
  const expense = getExpense(expenseId);
  if (!expense) return null;

  // Names for everyone in the expense, and whoever added / edited it —
  // including people who have since been removed, marked "(removed)".
  const usedIds = [...expense.payers, ...expense.participants].map((p) => p.member_id);
  for (const id of [expense.created_by, expense.updated_by]) if (id) usedIds.push(id);
  const names = {};
  for (const m of listMembersByIds(groupId, [...new Set(usedIds)])) {
    names[m.id] = m.deleted ? `${m.name} (removed)` : m.name;
  }

  // Current members who weren't part of it.
  const participantIds = new Set(expense.participants.map((p) => p.member_id));
  const didntJoin = listMembers(groupId).filter((m) => !participantIds.has(m.id));

  // For a fund expense: how much the fund covered, and any extra the holder
  // paid themselves. fundSummary works that out in time order.
  let fundPart = null;
  if (expense.from_fund) {
    const group = getGroup(groupId);
    const fund = fundSummary(group || {}, listExpenses(groupId), listPayments(groupId));
    fundPart = fund.history.find((h) => h.kind === 'out' && h.id === expense.id) || null;
  }

  // null if I may edit / delete it, otherwise why not.
  const refusal = expenseChangeRefusal(expense);

  return { expense, names, didntJoin, fundPart, refusal };
}

export default function ExpenseDetailsScreen({ route, navigation }) {
  const { groupId, expenseId } = route.params;
  const insets = useSafeAreaInsets();
  const { showUndo } = useUndo();
  const [details, setDetails] = useState(() => loadDetails(groupId, expenseId));

  // Reload when coming back from "Edit", so changes show straight away.
  useFocusEffect(
    useCallback(() => {
      setDetails(loadDetails(groupId, expenseId));
    }, [groupId, expenseId])
  );

  if (!details) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This expense was deleted.</Text>
      </View>
    );
  }

  const { expense, names, didntJoin, fundPart, refusal } = details;
  const nameOf = (id) => names[id] || 'Removed member';
  const title = expense.description || categoryLabel(expense.category);
  const authors = describeAuthors(expense, nameOf);

  // Deletes straight away — no "Are you sure?". A mistake is fixed with the
  // Undo bar instead, which is quicker than confirming every time.
  function handleDelete() {
    const result = deleteExpense(expenseId); // soft delete: deleted = 1, synced = 0
    if (!result.ok) {
      Alert.alert('Can’t delete this expense', result.errors.join('\n'));
      return;
    }
    // The bar lives above all screens, so it stays after we go back.
    showUndo('Expense deleted.', () => restoreExpense(expenseId));
    navigation.goBack();
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        // Room at the bottom so the pinned buttons never cover the last row.
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {/* --- Summary --- */}
        <Card style={styles.hero}>
          <View style={styles.heroInner}>
            <CategoryTile category={expense.category} />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.amount}>{formatRupees(expense.amount)}</Text>
            <Text style={styles.meta}>
              {categoryLabel(expense.category)} · {formatDay(expense.created_at)}
            </Text>
            {authors.added && <Text style={styles.meta}>{authors.added}</Text>}
            {authors.edited && <Text style={styles.meta}>{authors.edited}</Text>}
          </View>
        </Card>

        {/* --- Who paid, and how much each --- */}
        <Text style={styles.sectionTitle}>Paid by</Text>
        {fundPart ? (
          // Fund expense: the fund's part, then the holder's extra (if any).
          <Card>
            <View style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                Group fund (held by {nameOf(fundPart.memberId)})
              </Text>
              <Text style={styles.value}>{formatRupees(fundPart.fromFund)}</Text>
            </View>
            {fundPart.extra > 0 && (
              <View style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {nameOf(fundPart.memberId)}, out of pocket
                </Text>
                <Text style={styles.value}>{formatRupees(fundPart.extra)}</Text>
              </View>
            )}
          </Card>
        ) : (
          <Card>
            {expense.payers.map((payer) => (
              <View key={payer.member_id} style={styles.row}>
                <Text style={styles.name} numberOfLines={1}>
                  {nameOf(payer.member_id)}
                </Text>
                <Text style={styles.value}>{formatRupees(payer.amount)}</Text>
              </View>
            ))}
          </Card>
        )}

        {/* --- Who it was for, and each person's share --- */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, styles.sectionTitleInRow]}>For whom</Text>
          <Text style={styles.sectionHint}>
            {expense.split_type === 'custom' ? 'Custom split' : 'Split equally'}
          </Text>
        </View>
        <Card>
          {expense.participants.map((participant) => (
            <View key={participant.member_id} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {nameOf(participant.member_id)}
              </Text>
              <Text style={styles.value}>{formatRupees(participant.share)}</Text>
            </View>
          ))}
        </Card>

        {/* --- Members who weren't part of it (only if any) --- */}
        {didntJoin.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Didn’t join</Text>
            <Card>
              {didntJoin.map((member) => (
                <View key={member.id} style={styles.row}>
                  <Text style={[styles.name, styles.nameMuted]} numberOfLines={1}>
                    {member.name}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>

      {/* --- Edit / Delete, always visible at the bottom (or who may change it) --- */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        {refusal ? (
          <Text style={styles.refusal}>
            Only {expense.created_by ? nameOf(expense.created_by) : 'the person who added it'} or a group
            admin can edit or delete this expense.
          </Text>
        ) : (
          <>
            <AppButton
              title="Edit"
              icon={Pencil}
              onPress={() => navigation.navigate('AddExpense', { groupId, expenseId })}
              style={styles.actionButton}
            />
            <AppButton
              title="Delete"
              icon={Trash}
              variant="danger"
              onPress={handleDelete}
              style={styles.actionButton}
            />
          </>
        )}
      </View>
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
    backgroundColor: colors.fog,
    padding: 24,
  },
  muted: {
    ...text.small,
    fontSize: 16,
  },
  hero: {
    marginBottom: 8,
  },
  heroInner: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  title: {
    ...text.title,
    textAlign: 'center',
    marginTop: 8,
  },
  amount: {
    fontFamily: fonts.display,
    fontSize: 44,
    color: colors.ink,
    ...money,
  },
  meta: {
    ...text.small,
    fontSize: 15,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 20,
    marginBottom: 10,
    marginHorizontal: 4,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 4,
  },
  sectionTitleInRow: {
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
  },
  sectionHint: {
    ...text.small,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 54,
    paddingHorizontal: 18,
  },
  name: {
    ...text.body,
    fontSize: 17,
    flexShrink: 1,
  },
  nameMuted: {
    color: colors.muted,
  },
  value: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.ink,
    ...money,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.fog,
  },
  actionButton: {
    flex: 1,
  },
  refusal: {
    ...text.small,
    flex: 1,
    textAlign: 'center',
    paddingVertical: 8,
  },
});
