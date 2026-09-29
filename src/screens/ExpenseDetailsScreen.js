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
// "Edit" opens the expense form pre-filled. "Delete" soft-deletes it right
// away and shows "Expense deleted. Undo" for 5 seconds.
//
// Route params: groupId, expenseId

import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import { CategoryTile } from '../components/IconTile';
import { useUndo } from '../components/UndoBar';
import { Pencil, Trash } from '../components/icons';
import {
  deleteExpense,
  getExpense,
  listMembers,
  listMembersByIds,
  restoreExpense,
} from '../db/queries';
import { categoryLabel, formatDay, formatRupees } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

/**
 * Read the expense and the names needed to show it.
 * Returns null if the expense is gone (deleted).
 */
function loadDetails(groupId, expenseId) {
  const expense = getExpense(expenseId);
  if (!expense) return null;

  // Names for everyone in the expense — including people who have since
  // been removed from the group, marked "(removed)".
  const usedIds = [...expense.payers, ...expense.participants].map((p) => p.member_id);
  const names = {};
  for (const m of listMembersByIds(groupId, [...new Set(usedIds)])) {
    names[m.id] = m.deleted ? `${m.name} (removed)` : m.name;
  }

  // Current members who weren't part of it.
  const participantIds = new Set(expense.participants.map((p) => p.member_id));
  const didntJoin = listMembers(groupId).filter((m) => !participantIds.has(m.id));

  return { expense, names, didntJoin };
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

  const { expense, names, didntJoin } = details;
  const nameOf = (id) => names[id] || 'Removed member';
  const title = expense.description || categoryLabel(expense.category);

  // Deletes straight away — no "Are you sure?". A mistake is fixed with the
  // Undo bar instead, which is quicker than confirming every time.
  function handleDelete() {
    deleteExpense(expenseId); // soft delete: deleted = 1, synced = 0
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
          </View>
        </Card>

        {/* --- Who paid, and how much each --- */}
        <Text style={styles.sectionTitle}>Paid by</Text>
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

      {/* --- Edit / Delete, always visible at the bottom --- */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
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
});
