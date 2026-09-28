// BalancesTab.js — the "Balances" tab on the group screen.
//
// Top: each member and their balance, coloured
//   green = gets money back, red = owes money, grey = settled up.
// Below: the settle-up suggestions from settleUp(), each with a
// "Mark as paid" button.
//
// It only displays what it's given — the maths happens in GroupScreen
// (using split.js) and saving the payment happens there too.
//
// Props:
//   members     live members of the group
//   balances    { [memberId]: rupees } from computeBalances()
//   transfers   [{ fromId, toId, amount }] from settleUp()
//   names       { [memberId]: name }
//   onMarkPaid  called with a transfer when "Mark as paid" is tapped

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { describeBalance, formatRupees } from '../logic/format';
import { colors, radius, space } from './theme';

// Pick the colour for a balance: + gets money, - owes money, 0 settled.
function balanceColor(balance) {
  if (balance > 0) return colors.green;
  if (balance < 0) return colors.red;
  return colors.grey;
}

export default function BalancesTab({ members, balances, transfers, names, onMarkPaid }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Balances</Text>
      {members.length === 0 && <Text style={styles.empty}>No members yet.</Text>}
      {members.map((member) => {
        const balance = balances[member.id] || 0;
        return (
          <View key={member.id} style={styles.row}>
            <Text style={styles.name}>{member.name}</Text>
            <Text style={[styles.balance, { color: balanceColor(balance) }]}>
              {describeBalance(balance)}
            </Text>
          </View>
        );
      })}

      <Text style={[styles.heading, styles.secondHeading]}>Settle up</Text>
      {transfers.length === 0 && <Text style={styles.empty}>Everyone is settled up.</Text>}
      {transfers.map((transfer) => (
        // A pair only appears once in settleUp's result, so from+to is unique.
        <View key={`${transfer.fromId}-${transfer.toId}`} style={styles.row}>
          <View style={styles.transferText}>
            <Text style={styles.name}>
              {names[transfer.fromId] || 'Removed member'} pays{' '}
              {names[transfer.toId] || 'Removed member'}
            </Text>
            <Text style={styles.amount}>{formatRupees(transfer.amount)}</Text>
          </View>
          <AppButton
            title="Mark as paid"
            variant="secondary"
            small
            onPress={() => onMarkPaid(transfer)}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: space.lg,
    gap: space.sm,
  },
  heading: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  secondHeading: {
    marginTop: space.lg,
  },
  empty: {
    color: colors.muted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  transferText: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 16,
    color: colors.text,
  },
  balance: {
    fontSize: 16,
    fontWeight: '600',
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
});
