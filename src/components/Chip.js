// Chip.js — a small rounded "pill" you can tap to select.
//
// Used for picking a category, a split type, the tabs on the group screen,
// and "Paid by". Selected chips are filled blue.
//
// Props: label, selected (true/false), onPress

import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, space } from './theme';

export default function Chip({ label, selected, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.selected]}
    >
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md + 2,
    borderRadius: 999, // fully rounded ends
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  selected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  text: {
    fontSize: 15,
    color: colors.text,
  },
  selectedText: {
    color: colors.primaryText,
    fontWeight: '600',
  },
});
