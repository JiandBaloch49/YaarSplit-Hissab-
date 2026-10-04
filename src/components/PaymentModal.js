// PaymentModal.js — the pop-up for recording a payment ("Mark as paid").
//
//   I paid Nisar
//   [ Rs 1,200        ]   ← editable: paying part of it is fine
//   Rs 300 will still be left.
//   Nisar will be asked to confirm. It counts once they do.
//   [Cancel]  [I paid Nisar]
//
// The amount starts at what's owed but can be changed to any whole number
// of rupees above 0 (partial payments). The note under it says what will
// happen, following the server's rules (see addPayment in queries.js):
//   - online, I'm the payer         → pending until the receiver confirms;
//                                     an admin confirms if the receiver isn't
//                                     on YaarSplit yet
//   - online, I'm the receiver      → counts straight away
//   - group only on this phone      → counts straight away
//
// Render it only while open, so the amount starts fresh each time.
//
// Props:
//   fromName, toName   who pays whom
//   suggested          the amount to start with (what's owed), or undefined
//   online             the group is shared through the server
//   iAmPayer           I'm the one paying (online groups)
//   iAmReceiver        I'm the one receiving (online groups)
//   receiverOnApp      the receiver has a YaarSplit account
//   onSave             called with the amount (a whole number above 0)
//   onCancel           called when closed without saving

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import AppButton from './AppButton';
import ErrorList from './ErrorList';
import { formatRupees, formatTypedAmount, parseRupees } from '../logic/format';
import { colors, fonts, money, radius, text } from '../theme';

// The title, and the label on the save button.
function titleFor({ fromName, toName, online, iAmPayer, iAmReceiver }) {
  if (online && iAmPayer) return `I paid ${toName}`;
  if (online && iAmReceiver) return `${fromName} paid me`;
  return `${fromName} paid ${toName}`;
}

// What happens after saving, in one or two sentences.
function noteFor({ toName, online, iAmPayer, receiverOnApp }) {
  if (!online || !iAmPayer) return 'This counts straight away.';
  if (!receiverOnApp) {
    return `${toName} isn’t on YaarSplit yet, so a group admin will confirm it. It counts once they do.`;
  }
  return `${toName} will be asked to confirm. It counts once they do.`;
}

export default function PaymentModal(props) {
  const { suggested, onSave, onCancel } = props;
  // Kept as typed digits (no commas); shown with commas.
  const [typed, setTyped] = useState(suggested ? String(suggested) : '');
  const [errors, setErrors] = useState([]);

  const amount = parseRupees(typed);
  const title = titleFor(props);
  // "Rs 300 will still be left." while paying part of what's owed.
  const left = suggested && Number.isInteger(amount) && amount > 0 && amount < suggested ? suggested - amount : 0;

  function handleSave() {
    if (!Number.isInteger(amount) || amount <= 0) {
      setErrors(['Enter a whole number of rupees, more than 0.']);
      return;
    }
    onSave(amount);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>

          <View style={styles.amountBox}>
            <Text style={styles.rs}>Rs</Text>
            <TextInput
              style={styles.amount}
              // Strip the commas again so only digits are kept.
              value={formatTypedAmount(typed)}
              onChangeText={(value) => setTyped(value.replace(/,/g, ''))}
              keyboardType="number-pad"
              inputMode="numeric"
              maxLength={11} // 999,999,999 with commas
              autoFocus
              selectTextOnFocus
              accessibilityLabel="Amount paid"
            />
          </View>
          {suggested ? (
            <Text style={styles.hint}>
              {left > 0
                ? `${formatRupees(left)} will still be left.`
                : `Owed: ${formatRupees(suggested)}. Paying part of it is fine.`}
            </Text>
          ) : null}

          <Text style={styles.note}>{noteFor(props)}</Text>
          <ErrorList errors={errors} />

          <View style={styles.buttons}>
            <View style={styles.buttonWrap}>
              <AppButton title="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.buttonWrap}>
              <AppButton title="Save" onPress={handleSave} disabled={typed === ''} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23, 34, 59, 0.45)', // see-through ink
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 20,
    gap: 12,
  },
  title: {
    ...text.title,
  },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 60,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
  },
  rs: {
    fontFamily: fonts.semibold,
    fontSize: 20,
    color: colors.muted,
  },
  amount: {
    flex: 1,
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.ink,
    paddingVertical: 8,
    ...money,
  },
  hint: {
    ...text.small,
  },
  note: {
    ...text.body,
    fontSize: 15,
    lineHeight: 21,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  buttonWrap: {
    flex: 1,
  },
});
