// BigAmountInput.js — the big centred amount at the top of a form:
//
//              Amount
//         Rs  1,200
//
// Used by "Add expense" and "Add money". Shows commas while typing
// ("1,200") but hands the screen plain digits ("1200"); the screen turns
// that into a number with parseRupees() when saving. Opens the number pad,
// since money is always whole rupees.
//
// Props:
//   value      the typed digits, without commas
//   onChange   called with the new digits, without commas
//   autoFocus  open the keyboard straight away (for a new entry)

import { StyleSheet, Text, TextInput, View } from 'react-native';
import { formatTypedAmount } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

export default function BigAmountInput({ value, onChange, autoFocus }) {
  return (
    <View>
      <Text style={styles.label}>Amount</Text>
      <View style={styles.row}>
        <Text style={styles.rs}>Rs</Text>
        <TextInput
          style={styles.input}
          // Shown with commas ("1,200"), stored without them ("1200").
          value={formatTypedAmount(value)}
          onChangeText={(typed) => onChange(typed.replace(/,/g, ''))}
          placeholder="0"
          placeholderTextColor={colors.line}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={11} // 9 digits + 2 commas
          autoFocus={autoFocus}
          accessibilityLabel="Amount in rupees"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    ...text.small,
    fontSize: 16,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
  },
  rs: {
    fontFamily: fonts.display,
    fontSize: 26,
    color: colors.muted,
  },
  input: {
    fontFamily: fonts.display,
    fontSize: 60,
    color: colors.ink,
    minWidth: 60,
    padding: 0, // Android adds padding to inputs by default
    ...money,
  },
});
