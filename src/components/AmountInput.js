// AmountInput.js — a small text box for typing whole rupees inside a row
// (custom split shares, and amounts when several people paid).
//
// Opens the phone's number pad (digits only, no decimal point), since money
// in YaarSplit is always whole rupees. The value stays as TEXT while typing;
// screens turn it into a number with parseRupees() when saving.
// (The big amount at the top of the expense form is its own input.)
//
// Props: value, onChangeText, placeholder (default "0")

import { StyleSheet, TextInput } from 'react-native';
import { colors, fonts, money, radius } from '../theme';

export default function AmountInput({ value, onChangeText, placeholder = '0' }) {
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={9} // up to 999,999,999 — plenty for a meal
    />
  );
}

const styles = StyleSheet.create({
  input: {
    width: 104,
    minHeight: 40,
    paddingHorizontal: 12,
    backgroundColor: colors.fog,
    borderRadius: radius.input - 2,
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.ink,
    textAlign: 'right',
    ...money,
  },
});
