// ExpensesTab.js — the "Expenses" tab on the group screen.
//
// Shows the group's expenses (already sorted newest first by listExpenses)
// and an "Add expense" button. Tapping a row opens it for editing. It only
// displays what it's given — loading and saving happen elsewhere.
//
// Props:
//   expenses       from listExpenses()
//   names          { [memberId]: name } for showing who paid
//   canAdd         false when the group has no members yet
//   onAddExpense   called when "Add expense" is tapped
//   onOpenExpense  called with the expense when its row is tapped

import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { categoryLabel, formatRupees, joinNames } from '../logic/format';
import { colors, radius, space } from './theme';

export default function ExpensesTab({ expenses, names, canAdd, onAddExpense, onOpenExpense }) {
  return (
    <FlatList
      data={expenses}
      keyExtractor={(expense) => expense.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <AppButton title="Add expense" onPress={onAddExpense} disabled={!canAdd} />
          {!canAdd && (
            <Text style={styles.hint}>Add members first (Members tab).</Text>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No expenses yet.</Text>}
      renderItem={({ item }) => (
        <ExpenseRow expense={item} names={names} onPress={() => onOpenExpense(item)} />
      )}
    />
  );
}

// One expense: title and amount on top; category, who paid, and how many
// people it was for underneath. The whole row is tappable.
function ExpenseRow({ expense, names, onPress }) {
  const payerNames = expense.payers.map((p) => names[p.member_id] || 'Removed member');
  const count = expense.participants.length;
  const title = expense.description || categoryLabel(expense.category);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Edit this expense"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.amount}>{formatRupees(expense.amount)}</Text>
      </View>
      <Text style={styles.details}>
        {categoryLabel(expense.category)} · Paid by {joinNames(payerNames)} · For{' '}
        {count} {count === 1 ? 'person' : 'people'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: space.lg,
    gap: space.sm,
  },
  header: {
    marginBottom: space.sm,
    gap: space.sm,
  },
  hint: {
    color: colors.muted,
    textAlign: 'center',
  },
  empty: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xl,
  },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  title: {
    flex: 1, // long titles get cut with "…" instead of pushing the amount off
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  amount: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  details: {
    fontSize: 14,
    color: colors.muted,
  },
});
