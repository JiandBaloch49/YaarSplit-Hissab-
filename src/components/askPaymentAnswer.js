// askPaymentAnswer.js — the question before answering a pending payment.
// Used by every screen that shows PaymentRow buttons (group, Me, history).
//
//   Received        → saved straight away (good news needs no question)
//   Didn't receive  → "Didn't receive Rs 500? Bilal will see that you
//                     didn't get it. It won't count."
//   Cancel          → "Cancel this payment? The Rs 500 to Ali won't count."
//
// It only asks: `save()` does the actual saving (the screen calls
// answerPayment in queries.js and reloads), so no database code lives here.

import { Alert } from 'react-native';
import { formatRupees } from '../logic/format';

/**
 * payment  the pending payment ({ fromId, toId, amount })
 * action   'confirm' | 'reject' | 'cancel'
 * nameOf   (id) → name
 * save     called once the person has said yes
 */
export function askPaymentAnswer(payment, action, nameOf, save) {
  if (action === 'confirm') {
    save();
    return;
  }
  const amount = formatRupees(payment.amount);
  if (action === 'reject') {
    Alert.alert(
      `Didn’t receive ${amount}?`,
      `${nameOf(payment.fromId)} will see that you didn’t get it. It won’t count.`,
      [
        { text: 'Back', style: 'cancel' },
        { text: 'Didn’t receive', style: 'destructive', onPress: save },
      ]
    );
    return;
  }
  Alert.alert('Cancel this payment?', `The ${amount} to ${nameOf(payment.toId)} won’t count.`, [
    { text: 'Back', style: 'cancel' },
    { text: 'Cancel payment', style: 'destructive', onPress: save },
  ]);
}
