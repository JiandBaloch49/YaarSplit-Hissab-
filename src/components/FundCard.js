// FundCard.js — the group fund at the top of the Expenses tab.
//
// With a fund:
//   GROUP FUND
//   Hammal is holding Rs 1,000
//   [+ Add money]  [View history]
//
// Without one: a small "Start a group fund" link, so the option is visible
// but doesn't take up much room.
//
// Props:
//   fund        fundSummary() result, or null when there's no fund
//   holderName  the fund holder's name
//   canStart    false when the group has no members yet
//   onStart     "Start a group fund" tapped
//   onAddMoney  "Add money" tapped
//   onViewFund  "View history" tapped

import { Pressable, StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import Card from './Card';
import { Plus } from './icons';
import { formatRupees } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

export default function FundCard({ fund, holderName, canStart, onStart, onAddMoney, onViewFund }) {
  if (!fund) {
    if (!canStart) return null;
    return (
      <Pressable
        onPress={onStart}
        accessibilityRole="button"
        hitSlop={8}
        style={({ pressed }) => [styles.startLink, pressed && styles.pressed]}
      >
        <Plus size={18} color={colors.gets} strokeWidth={2.25} />
        <Text style={styles.startText}>Start a group fund</Text>
      </Pressable>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.inner}>
        <Text style={styles.label}>GROUP FUND</Text>
        <Text style={styles.headline}>
          {holderName} is holding{' '}
          <Text style={styles.amount}>{formatRupees(fund.left)}</Text>
        </Text>
        <View style={styles.buttons}>
          <AppButton
            title="Add money"
            icon={Plus}
            variant="secondary"
            small
            onPress={onAddMoney}
            style={styles.button}
          />
          <AppButton
            title="View history"
            variant="secondary"
            small
            onPress={onViewFund}
            style={styles.button}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
  },
  inner: {
    padding: 18,
    gap: 6,
  },
  label: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    letterSpacing: 0.8,
    color: colors.muted,
  },
  headline: {
    ...text.bodyStrong,
    fontSize: 18,
  },
  amount: {
    color: colors.gets,
    ...money,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  button: {
    flex: 1,
  },
  startLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 16,
    marginLeft: 4,
  },
  startText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.gets,
  },
  pressed: {
    opacity: 0.6,
  },
});
