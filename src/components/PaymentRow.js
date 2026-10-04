// PaymentRow.js — one recorded payment, in a Card. Used on the Balances
// tab, the Me screen and the history between two people.
//
//   Bilal paid Nisar                        [Received] [Didn't receive]
//   Rs 500 · 28 Sep, 3:20 PM · Kund Malir trip
//   Waiting for Nisar to confirm
//
// Payments that don't count (pending, rejected, cancelled) are greyed out.
// Which buttons show is decided by the screen (paymentActions in
// queries.js), passed in as payment.actions / payment.canDelete:
//   Received / Didn't receive   the receiver (or an admin, if the receiver
//                               isn't on YaarSplit yet)
//   Cancel                      the payer, while it's pending
//   Delete                      groups that only live on this phone
//
// Props:
//   payment        a payment from listPayments(), plus `actions`
//                  ({ confirm, reject, cancel }), `canDelete` and
//                  `receiverOnApp` (false = the receiver has no account)
//   nameOf(id)     a member's name. May return "you" for me — the first
//                  letter of each line is capitalised, so "you paid Ali"
//                  shows as "You paid Ali".
//   extra          optional text added to the date line (e.g. group name)
//   footer         optional extra line at the bottom (e.g. what's left)
//   onAnswer       called with 'confirm' | 'reject' | 'cancel'
//   onDelete       called when "Delete" is tapped

import { StyleSheet, Text, View } from 'react-native';
import AppButton from './AppButton';
import { describePayment, describePaymentStatus, formatRupees, formatWhen } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

// "you paid Ali" → "You paid Ali"
function capitalise(line) {
  return line ? line[0].toUpperCase() + line.slice(1) : line;
}

export default function PaymentRow({ payment, nameOf, extra, footer, onAnswer, onDelete }) {
  const note = capitalise(describePaymentStatus(payment, nameOf, payment.receiverOnApp !== false));
  const { actions } = payment;
  const counts = payment.status === 'confirmed';
  const details = [formatRupees(payment.amount), formatWhen(payment.created_at), extra].filter(Boolean);

  return (
    <View style={styles.row}>
      <View style={styles.text}>
        {/* Not-confirmed payments are greyed: they don't count. */}
        <Text style={[styles.what, !counts && styles.notCounted]} numberOfLines={2}>
          {capitalise(describePayment(payment, nameOf))}
        </Text>
        <Text style={styles.details}>{details.join(' · ')}</Text>
        {note !== '' && (
          <Text style={[styles.note, payment.status === 'pending' && styles.notePending]}>{note}</Text>
        )}
        {footer ? <Text style={styles.footer}>{footer}</Text> : null}
      </View>
      <View style={styles.buttons}>
        {actions?.confirm && (
          <AppButton title="Received" variant="secondary" small onPress={() => onAnswer('confirm')} />
        )}
        {actions?.reject && (
          <AppButton title="Didn’t receive" variant="danger" small onPress={() => onAnswer('reject')} />
        )}
        {actions?.cancel && (
          <AppButton title="Cancel" variant="danger" small onPress={() => onAnswer('cancel')} />
        )}
        {payment.canDelete && <AppButton title="Delete" variant="danger" small onPress={onDelete} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // buttons drop below the text on narrow phones
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  text: {
    flex: 1,
    minWidth: 180,
    gap: 4,
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  what: {
    ...text.bodyStrong,
    fontSize: 17,
  },
  notCounted: {
    color: colors.muted,
  },
  details: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
    ...money,
  },
  note: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.muted,
  },
  notePending: {
    color: colors.owes,
  },
  footer: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.ink,
    ...money,
  },
});
