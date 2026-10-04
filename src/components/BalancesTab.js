// BalancesTab.js — the "Balances" tab on the group screen.
//
// Top: the balance chart (see BalanceChart.js) — blue bars to the right for
// people who get money back, orange bars to the left for people who owe.
// Then: "Settle up" — the payments that clear everything, each with a
// "Mark as paid" button.
// Last: payments already recorded ("D paid B Rs 350").
//
// Between the two, the group's "Simplify debts" switch (see
// setSimplifyDebts in queries.js): on = the fewest payments, off = each
// person pays back exactly the people they owe. Only admins can flip it.
//
// Payments in an ONLINE group need the receiver to confirm them (only
// confirmed ones count). So there:
//   - a pending payment says "Waiting for B to confirm", with Received /
//     Didn't receive buttons for whoever may answer, and Cancel for the payer
//     (see PaymentRow.js);
//   - a settle-up row that already has a pending payment shows "Waiting for
//     B" instead of "Mark as paid", so nobody pays twice (or "Waiting for an
//     admin" when B isn't on YaarSplit yet);
//   - "Mark as paid" only shows on rows you're part of (you can only record
//     money you gave or got).
// In a group that only lives on this phone, every payment counts at once
// and has a "Delete" button in case "Mark as paid" was tapped by mistake.
//
// It only displays what it's given — the maths and the rules are worked out
// in GroupScreen (using split.js and queries.js), and saving happens there.
//
// Props:
//   members           live members of the group
//   balances          { [memberId]: rupees } from computeBalances()
//   transfers         [{ fromId, toId, amount, canMark, waiting, receiverOnApp }]
//                     canMark: show "Mark as paid"; waiting: a pending
//                     payment for this pair already exists
//   payments          from listPayments(), newest first, each with
//                     `actions`, `canDelete` and `receiverOnApp` (PaymentRow)
//   names             { [memberId]: name }
//   meId              my member id (online groups), so my payments say "you"
//   simplify          the group's simplify_debts (1 or 0)
//   canSetSimplify    false → the switch is shown but can't be changed
//   onSetSimplify     called with true/false when the switch is flipped
//   onMarkPaid        called with a transfer when "Mark as paid" is tapped
//   onAnswerPayment   called with (payment, 'confirm' | 'reject' | 'cancel')
//   onDeletePayment   called with a payment when its "Delete" is tapped
//   refreshControl    pull-to-refresh (a <RefreshControl>)

import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from './AppButton';
import BalanceChart from './BalanceChart';
import Card from './Card';
import PaymentRow from './PaymentRow';
import { ArrowRight } from './icons';
import { formatRupees } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

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
  meId,
  simplify,
  canSetSimplify,
  onSetSimplify,
  onMarkPaid,
  onAnswerPayment,
  onDeletePayment,
  refreshControl,
}) {
  const insets = useSafeAreaInsets();
  // Name for a member id, even if they've since been removed from the group.
  const nameOf = (id) => names[id] || 'Removed member';
  // In payment rows, my own payments say "you": "You paid Ali".
  const paymentNameOf = (id) => (id === meId ? 'you' : nameOf(id));

  return (
    <ScrollView
      refreshControl={refreshControl}
      contentContainerStyle={[styles.container, { paddingBottom: 24 + insets.bottom }]}
    >
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
      <Card style={styles.simplifyCard}>
        <View style={styles.simplifyRow}>
          <View style={styles.rowText}>
            <Text style={styles.person}>Simplify debts</Text>
            <Text style={styles.simplifyHint}>
              Fewer payments, but you may pay someone you didn’t eat with.
              {canSetSimplify ? '' : ' Only an admin can change this.'}
            </Text>
          </View>
          <Switch
            value={Boolean(simplify)}
            onValueChange={onSetSimplify}
            disabled={!canSetSimplify}
            trackColor={{ true: colors.ink, false: colors.line }}
            thumbColor={colors.surface}
            accessibilityLabel="Simplify debts"
          />
        </View>
      </Card>
      {transfers.length > 0 && (
        <Card>
          {transfers.map((transfer) => (
            // A pair only appears once in the list, so from+to is unique.
            <View key={`${transfer.fromId}-${transfer.toId}`} style={styles.row}>
              <View style={styles.rowText}>
                <View style={styles.fromTo}>
                  <Text style={styles.person} numberOfLines={1}>
                    {nameOf(transfer.fromId)}
                  </Text>
                  <ArrowRight size={16} color={colors.muted} strokeWidth={2} />
                  <Text style={styles.person} numberOfLines={1}>
                    {nameOf(transfer.toId)}
                  </Text>
                </View>
                <Text style={styles.amount}>{formatRupees(transfer.amount)}</Text>
              </View>
              {transfer.waiting ? (
                <Text style={styles.waiting}>
                  {transfer.receiverOnApp === false ? 'Waiting for an admin' : `Waiting for ${nameOf(transfer.toId)}`}
                </Text>
              ) : (
                transfer.canMark && (
                  <AppButton
                    title="Mark as paid"
                    variant="secondary"
                    small
                    onPress={() => onMarkPaid(transfer)}
                  />
                )
              )}
            </View>
          ))}
        </Card>
      )}

      {/* --- Payments already recorded (only once there is one) --- */}
      {payments.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Text style={styles.heading}>Payments</Text>
          </View>
          <Card>
            {payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                nameOf={paymentNameOf}
                onAnswer={(action) => onAnswerPayment(payment, action)}
                onDelete={() => onDeletePayment(payment)}
              />
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
  simplifyCard: {
    marginBottom: 12,
  },
  simplifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  simplifyHint: {
    ...text.small,
    lineHeight: 19,
  },
  rowText: {
    flex: 1,
    minWidth: 160,
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
  waiting: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.owes,
    maxWidth: 140,
    textAlign: 'right',
  },
});
