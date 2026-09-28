// AmountInput.js — a text box for typing whole rupees.
//
// Opens the phone's number pad (digits only, no decimal point), since money
// in Hisaab is always whole rupees. The value stays as TEXT while typing;
// screens turn it into a number with parseRupees() when saving.
//
// Props:
//   value, onChangeText   the text, like a normal TextInput
//   placeholder           hint text (default "0")
//   compact               true for the small box inside a list row

import { StyleSheet, TextInput } from 'react-native';
import { colors, radius, space } from './theme';

export default function AmountInput({ value, onChangeText, placeholder = '0', compact }) {
  return (
    <TextInput
      style={[styles.input, compact && styles.compact]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.grey}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={9} // up to 999,999,999 — plenty for a meal
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: space.md,
    fontSize: 18,
    color: colors.text,
  },
  compact: {
    width: 100,
    paddingVertical: space.sm,
    fontSize: 16,
    textAlign: 'right',
  },
});
