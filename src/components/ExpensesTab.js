// ExpensesTab.js — the "Expenses" tab on the group screen.
//
// Expenses are grouped by day ("Sunday, 28 Sep"), newest first. Each day is
// one white card; each row shows the category icon, the title, "Hammal
// paid, for 4", the amount, and an arrow. Tapping a row opens its details.
// A floating "Add expense" button sits in the bottom-right corner; while the
// undo bar is showing, it moves up above the bar so it's never covered.
//
// It only displays what it's given — loading and saving happen elsewhere.
//
// Props:
//   expenses       from listExpenses() (newest first)
//   names          { [memberId]: name }
//   canAdd         false when the group has no members yet
//   onAddExpense   called when "Add expense" is tapped
//   onOpenExpense  called with the expense when its row is tapped (opens details)

import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from './AppButton';
import { CategoryTile } from './IconTile';
import { UNDO_BAR_SPACE, useUndo } from './UndoBar';
import { ChevronRight, Plus } from './icons';
import { categoryLabel, describeExpense, formatRupees, groupByDay } from '../logic/format';
import { colors, fonts, money, radius, text } from '../theme';

export default function ExpensesTab({ expenses, names, canAdd, onAddExpense, onOpenExpense }) {
  const insets = useSafeAreaInsets(); // space taken by the phone's home bar
  const { isShowing: undoShowing } = useUndo();
  // Normally 16 above the home bar; lifted above the undo bar while it shows.
  const buttonBottom = 16 + insets.bottom + (undoShowing ? UNDO_BAR_SPACE : 0);

  return (
    <View style={styles.container}>
      <SectionList
        sections={groupByDay(expenses)}
        keyExtractor={(expense) => expense.id}
        // Room at the bottom so the floating button never hides the last row.
        contentContainerStyle={[styles.list, { paddingBottom: buttonBottom + 80 }]}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={styles.day}>{section.title}</Text>}
        renderItem={({ item, index, section }) => (
          <ExpenseRow
            expense={item}
            names={names}
            // Rows in a day are drawn as one card: round the top of the first
            // row and the bottom of the last, and put a line between rows.
            isFirst={index === 0}
            isLast={index === section.data.length - 1}
            onPress={() => onOpenExpense(item)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {canAdd ? 'No expenses yet.' : 'Add your friends in the Members tab first.'}
          </Text>
        }
      />

      <AppButton
        title="Add expense"
        icon={Plus}
        onPress={onAddExpense}
        disabled={!canAdd}
        style={[styles.addButton, { bottom: buttonBottom }]}
      />
    </View>
  );
}

// One expense row: [icon]  Title / "Hammal paid, for 4"   Rs 3,000
function ExpenseRow({ expense, names, isFirst, isLast, onPress }) {
  const nameOf = (id) => names[id] || 'Removed member';
  const summary = describeExpense(
    expense.payers.map((p) => nameOf(p.member_id)),
    expense.participants.map((p) => nameOf(p.member_id))
  );
  const title = expense.description || categoryLabel(expense.category);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Shows the details of this expense"
      style={({ pressed }) => [
        styles.row,
        isFirst && styles.rowFirst,
        isLast && styles.rowLast,
        pressed && styles.rowPressed,
      ]}
    >
      <CategoryTile category={expense.category} />
      {/* The divider sits on the text part only, so it starts after the icon. */}
      <View style={[styles.rowBody, !isFirst && styles.rowDivider]}>
        <View style={styles.rowText}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.summary} numberOfLines={1}>
            {summary}
          </Text>
        </View>
        <Text style={styles.amount} numberOfLines={1}>
          {formatRupees(expense.amount)}
        </Text>
        {/* The arrow shows the row can be tapped to see details. */}
        <ChevronRight size={20} color={colors.muted} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: 16,
  },
  day: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 4,
  },
  empty: {
    ...text.small,
    textAlign: 'center',
    marginTop: 40,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    paddingLeft: 16,
  },
  rowFirst: {
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingTop: 4,
  },
  rowLast: {
    borderBottomLeftRadius: radius.card,
    borderBottomRightRadius: radius.card,
    paddingBottom: 4,
  },
  rowPressed: {
    backgroundColor: colors.fog,
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingRight: 16,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.line,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...text.bodyStrong,
    fontSize: 17,
  },
  summary: {
    ...text.small,
    fontSize: 15,
  },
  amount: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    color: colors.ink,
    ...money,
  },
  addButton: {
    position: 'absolute',
    right: 16,
    borderRadius: 28, // fully rounded ends on the 56-tall button
  },
});
