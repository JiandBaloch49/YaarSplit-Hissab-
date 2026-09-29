// FundScreen.js — everything about the group fund ("View history").
//
//   Hammal is holding
//   Rs 1,000
//   Rs 4,000 put in · Rs 3,000 spent
//   [+ Add money]
//
//   Return leftover     (only while money is left)
//     Hammal → Bilal  Rs 250          [Mark as returned]
//     Hammal keeps    Rs 250          [Mark as kept]
//
//   Who put money in    Bilal Rs 1,000 ...
//
//   History (oldest first, with the amount left after each step)
//     Bilal put money in      +Rs 1,000   Left Rs 1,000
//     Dinner                  −Rs 3,000   Left Rs 1,000
//
//   Fund holder         [Change holder]  (only when the fund is at Rs 0)
//
// All the numbers come from fundSummary() / suggestReturns() in split.js.
//
// Route params: groupId

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ActionMenu from '../components/ActionMenu';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import { useAfterUndo, useUndo } from '../components/UndoBar';
import { ArrowRight, ChevronRight, Plus } from '../components/icons';
import {
  addPayment,
  deletePayment,
  getGroup,
  listExpenses,
  listMembers,
  listMembersByIds,
  listPayments,
  restorePayment,
  setFundHolder,
} from '../db/queries';
import { categoryLabel, formatRupees, formatShortDate } from '../logic/format';
import { computeBalances, fundSummary, suggestReturns } from '../logic/split';
import { colors, fonts, money, text } from '../theme';

/**
 * Read everything the fund screen shows. Returns null if the group has no
 * fund (e.g. it was just ended).
 */
function loadFund(groupId) {
  const group = getGroup(groupId);
  if (!group || !group.fund_holder_id) return null;

  const members = listMembers(groupId);
  const expenses = listExpenses(groupId);
  const payments = listPayments(groupId);
  const fund = fundSummary(group, expenses, payments);
  const balances = computeBalances(members, expenses, payments);

  // Names for everyone in the fund's history — including people who have
  // since been removed from the group.
  const ids = new Set(members.map((m) => m.id));
  for (const p of payments) {
    ids.add(p.fromId);
    ids.add(p.toId);
  }
  const names = {};
  for (const m of listMembersByIds(groupId, [...ids])) names[m.id] = m.name;

  return {
    holderId: group.fund_holder_id,
    members,
    names,
    fund,
    // How to hand back what's left, based on balances.
    returns: fund.left > 0 ? suggestReturns(fund.left, group.fund_holder_id, balances) : [],
  };
}

export default function FundScreen({ route, navigation }) {
  const { groupId } = route.params;
  const insets = useSafeAreaInsets();
  const { showUndo } = useUndo();
  const [data, setData] = useState(() => loadFund(groupId));
  const [pickingHolder, setPickingHolder] = useState(false);

  const reload = useCallback(() => setData(loadFund(groupId)), [groupId]);
  useFocusEffect(reload); // e.g. after "Add money" or editing an expense
  useAfterUndo(reload); // after "Undo" on the undo bar
  const closeHolderPicker = useCallback(() => setPickingHolder(false), []);

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>This group has no fund.</Text>
      </View>
    );
  }

  const { holderId, members, names, fund, returns } = data;
  const nameOf = (id) => names[id] || 'Removed member';
  const holderName = nameOf(holderId);

  // --- Actions ---

  // Record the holder handing leftover back (or keeping their own share).
  function handleReturn(suggestion) {
    const keeping = suggestion.toId === holderId;
    const message = keeping
      ? `${holderName} keeps ${formatRupees(suggestion.amount)} — their own share.`
      : `${holderName} gave ${nameOf(suggestion.toId)} ${formatRupees(suggestion.amount)} from the fund.`;
    Alert.alert(keeping ? 'Mark as kept?' : 'Mark as returned?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: keeping ? 'Mark as kept' : 'Mark as returned',
        onPress: () => {
          const result = addPayment(groupId, {
            fromId: holderId,
            toId: suggestion.toId,
            amount: suggestion.amount,
            type: 'return',
          });
          if (!result.ok) Alert.alert('Could not save', result.errors.join('\n'));
          reload();
        },
      },
    ]);
  }

  // Delete money put in / given back — straight away, with Undo.
  function handleDeleteEntry(entry) {
    deletePayment(entry.id); // soft delete
    reload();
    showUndo(
      entry.kind === 'in' ? 'Money in deleted.' : 'Return deleted.',
      () => restorePayment(entry.id)
    );
  }

  function handleChangeHolder(newHolderId) {
    const result = setFundHolder(groupId, newHolderId);
    if (!result.ok) {
      Alert.alert('Can’t change the holder yet', result.errors.join('\n'));
      return;
    }
    if (newHolderId === null) {
      navigation.goBack(); // the fund has ended; nothing left to show here
      return;
    }
    reload();
  }

  // --- Screen ---

  // Everyone who put money in, biggest first.
  const contributors = Object.entries(fund.contributions).sort((a, b) => b[1] - a[1]);

  // "Rs 4,000 put in · Rs 3,000 spent · Rs 250 returned"
  const totals = [`${formatRupees(fund.totalIn)} put in`, `${formatRupees(fund.totalSpent)} spent`];
  if (fund.totalReturned > 0) totals.push(`${formatRupees(fund.totalReturned)} returned`);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}>
        {/* --- Summary --- */}
        <Card>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>{holderName} is holding</Text>
            <Text style={styles.heroAmount}>{formatRupees(fund.left)}</Text>
            <Text style={styles.heroTotals}>{totals.join(' · ')}</Text>
            {fund.holderExtra > 0 && (
              <Text style={styles.heroExtra}>
                When the fund ran out, {formatRupees(fund.holderExtra)} was paid from the
                holder’s own pocket.
              </Text>
            )}
            <AppButton
              title="Add money"
              icon={Plus}
              onPress={() => navigation.navigate('AddMoney', { groupId })}
              style={styles.heroButton}
            />
          </View>
        </Card>

        {/* --- Return leftover (only while there's money left) --- */}
        {returns.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.heading}>Return leftover</Text>
              <Text style={styles.subtitle}>Suggested from everyone’s balance.</Text>
            </View>
            <Card>
              {returns.map((suggestion) => {
                const keeping = suggestion.toId === holderId;
                return (
                  <View key={suggestion.toId} style={styles.row}>
                    <View style={styles.rowText}>
                      {keeping ? (
                        <Text style={styles.rowTitle}>{holderName} keeps</Text>
                      ) : (
                        <View style={styles.fromTo}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {holderName}
                          </Text>
                          <ArrowRight size={16} color={colors.muted} strokeWidth={2} />
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {nameOf(suggestion.toId)}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.rowSub}>
                        {formatRupees(suggestion.amount)}
                        {keeping ? ' · their own share' : ''}
                      </Text>
                    </View>
                    <AppButton
                      title={keeping ? 'Mark as kept' : 'Mark as returned'}
                      variant="secondary"
                      small
                      onPress={() => handleReturn(suggestion)}
                    />
                  </View>
                );
              })}
            </Card>
          </>
        )}

        {/* --- Who put money in --- */}
        {contributors.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.heading}>Who put money in</Text>
            </View>
            <Card>
              {contributors.map(([memberId, amount]) => (
                <View key={memberId} style={styles.row}>
                  <Text style={[styles.rowTitle, styles.grow]} numberOfLines={1}>
                    {nameOf(memberId)}
                  </Text>
                  <Text style={styles.value}>{formatRupees(amount)}</Text>
                </View>
              ))}
            </Card>
          </>
        )}

        {/* --- History, oldest first, with the running amount left --- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.heading}>History</Text>
        </View>
        {fund.history.length === 0 ? (
          <Text style={styles.muted}>No money in the fund yet.</Text>
        ) : (
          <Card>
            {fund.history.map((entry) => (
              <HistoryRow
                key={`${entry.kind}-${entry.id}`}
                entry={entry}
                holderId={holderId}
                nameOf={nameOf}
                onDelete={() => handleDeleteEntry(entry)}
                onOpenExpense={() =>
                  navigation.navigate('ExpenseDetails', { groupId, expenseId: entry.id })
                }
              />
            ))}
          </Card>
        )}

        {/* --- Who holds the money --- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.heading}>Fund holder</Text>
          <Text style={styles.subtitle}>
            {fund.left === 0
              ? `${holderName} holds the fund.`
              : `${holderName} holds the fund. You can change the holder once the fund is back to Rs 0.`}
          </Text>
        </View>
        <AppButton
          title="Change holder"
          variant="secondary"
          onPress={() => setPickingHolder(true)}
          disabled={fund.left !== 0}
        />
      </ScrollView>

      {/* Change holder: everyone else, plus ending the fund. */}
      <ActionMenu
        visible={pickingHolder}
        title="Who should hold the fund now?"
        onClose={closeHolderPicker}
        options={[
          ...members
            .filter((m) => m.id !== holderId)
            .map((m) => ({ key: m.id, label: m.name, onPress: () => handleChangeHolder(m.id) })),
          { key: 'end', label: 'End the fund', onPress: () => handleChangeHolder(null), destructive: true },
        ]}
      />
    </View>
  );
}

// One line of the fund's history.
//   in      "Bilal put money in"   +Rs 1,000   (Delete)
//   return  "Returned to Bilal"    −Rs 250     (Delete)
//   out     "Dinner"               −Rs 3,000   (tap → expense details)
function HistoryRow({ entry, holderId, nameOf, onDelete, onOpenExpense }) {
  let title;
  let amountText;
  let amountColor;
  if (entry.kind === 'in') {
    title = `${nameOf(entry.memberId)} put money in`;
    amountText = `+${formatRupees(entry.amount)}`;
    amountColor = colors.gets;
  } else if (entry.kind === 'return') {
    title =
      entry.memberId === holderId
        ? `${nameOf(holderId)} kept their share`
        : `Returned to ${nameOf(entry.memberId)}`;
    amountText = `−${formatRupees(entry.amount)}`;
    amountColor = colors.owes;
  } else {
    title = entry.expense.description || categoryLabel(entry.expense.category);
    // Only what the FUND paid; any extra came from the holder's pocket.
    amountText = `−${formatRupees(entry.fromFund)}`;
    amountColor = colors.owes;
  }

  // Second line: date, the holder's extra (if any), and what was left after.
  const details = [formatShortDate(entry.created_at)];
  if (entry.kind === 'out' && entry.extra > 0) {
    details.push(`${nameOf(entry.memberId)} paid ${formatRupees(entry.extra)} extra`);
  }
  details.push(`Left ${formatRupees(entry.left)}`);

  const content = (
    <>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowSub} numberOfLines={2}>
          {details.join(' · ')}
        </Text>
      </View>
      <Text style={[styles.value, { color: amountColor }]}>{amountText}</Text>
    </>
  );

  // Expenses open their details; money in/out can be deleted here.
  if (entry.kind === 'out') {
    return (
      <Pressable
        onPress={onOpenExpense}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        {content}
        <ChevronRight size={20} color={colors.muted} strokeWidth={2} />
      </Pressable>
    );
  }
  return (
    <View style={styles.row}>
      {content}
      <AppButton title="Delete" variant="danger" small onPress={onDelete} />
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
    marginLeft: 4,
  },
  hero: {
    alignItems: 'center',
    padding: 24,
    gap: 4,
  },
  heroLabel: {
    ...text.small,
    fontSize: 16,
  },
  heroAmount: {
    fontFamily: fonts.display,
    fontSize: 44,
    color: colors.ink,
    ...money,
  },
  heroTotals: {
    ...text.small,
    fontSize: 15,
    textAlign: 'center',
    ...money,
  },
  heroExtra: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.owes,
    textAlign: 'center',
    marginTop: 6,
  },
  heroButton: {
    alignSelf: 'stretch',
    marginTop: 16,
  },
  sectionHeader: {
    marginTop: 28,
    marginBottom: 12,
    marginLeft: 4,
    gap: 2,
  },
  heading: {
    ...text.heading,
  },
  subtitle: {
    ...text.small,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  rowPressed: {
    backgroundColor: colors.fog,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  grow: {
    flex: 1,
  },
  fromTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    ...text.bodyStrong,
    flexShrink: 1,
  },
  rowSub: {
    ...text.small,
    ...money,
  },
  value: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
    ...money,
  },
});
