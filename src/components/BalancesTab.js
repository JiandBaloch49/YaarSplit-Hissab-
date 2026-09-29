// BalancesTab.js — the "Balances" tab on the group screen.
//
// Top: the balance chart (see BalanceChart.js) — blue bars to the right for
// people who get money back, orange bars to the left for people who owe.
// Then: "Settle up" — the payments from settleUp() that clear everything,
// each with a "Mark as paid" button.
// Last: payments already recorded ("D paid B Rs 350"), each with a "Delete"
// button in case "Mark as paid" was tapped by mistake.
//
// It only displays what it's given — the maths happens in GroupScreen
// (using split.js) and saving/deleting payments happens there too.
//
// Props:
//   members          live members of the group
//   balances         { [memberId]: rupees } from computeBalances()
//   transfers        [{ fromId, toId, amount }] from settleUp()
//   payments         from listPayments(), newest first
//   names            { [memberId]: name }
//   onMarkPaid       called with a transfer when "Mark as paid" is tapped
//   onDeletePayment  called with a payment when its "Delete" is tapped

import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from './AppButton';
import BalanceChart from './BalanceChart';
import Card from './Card';
import { ArrowRight } from './icons';
import { formatRupees, formatShortDate } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

// Name for a member id, even if they've since been removed from the group.
function nameOf(names, id) {
  return names[id] || 'Removed member';
}

// "1 payment clears everything." / "3 payments clear everything."
function settleUpSubtitle(count) {
  if (count === 0) return 'Everyone is settled up.';
  if (count === 1) return '1 payment clears everything.';
  return `${count} payments clear everything.`;
}

export default function BalancesTab({
  members,
  balances,
  transfers,
  payments,
  names,
  onMarkPaid,
  onDeletePayment,
}) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}>
      {members.length === 0 ? (
        <Text style={styles.empty}>Add your friends in the Members tab first.</Text>
      ) : (
        <Card>
          <BalanceChart members={members} balances={balances} />
        </Card>
      )}

      {/* --- Settle up --- */}
      <View style={styles.sectionHeader}>
        <Text style={styles.heading}>Settle up</Text>
        <Text style={styles.subtitle}>{settleUpSubtitle(transfers.length)}</Text>
      </View>
      {transfers.length > 0 && (
        <Card>
          {transfers.map((transfer) => (
            // A pair only appears once in settleUp's result, so from+to is unique.
            <View key={`${transfer.fromId}-${transfer.toId}`} style={styles.row}>
              <View style={styles.rowText}>
                <View style={styles.fromTo}>
                  <Text style={styles.person} numberOfLines={1}>
                    {nameOf(names, transfer.fromId)}
                  </Text>
                  <ArrowRight size={16} color={colors.muted} strokeWidth={2} />
                  <Text style={styles.person} numberOfLines={1}>
                    {nameOf(names, transfer.toId)}
                  </Text>
                </View>
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
        </Card>
      )}

      {/* --- Payments already made (only once there is one) --- */}
      {payments.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.heading}>Payments</Text>
          </View>
          <Card>
            {payments.map((payment) => (
              <View key={payment.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.person} numberOfLines={2}>
                    {nameOf(names, payment.fromId)} paid {nameOf(names, payment.toId)}
                  </Text>
                  <Text style={styles.amount}>
                    {formatRupees(payment.amount)} · {formatShortDate(payment.created_at)}
                  </Text>
                </View>
                <AppButton
                  title="Delete"
                  variant="danger"
                  small
                  onPress={() => onDeletePayment(payment)}
                />
              </View>
            ))}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    paddingTop: 20,
  },
  empty: {
    ...text.small,
    textAlign: 'center',
    marginTop: 24,
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
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowText: {
    flex: 1,
    gap: 4,
  },
  fromTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  person: {
    ...text.bodyStrong,
    fontSize: 17,
    flexShrink: 1,
  },
  amount: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
    ...money,
  },
});
