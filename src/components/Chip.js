// Chip.js — a rounded "pill" you can tap to select.
//
// Used for picking a category, who paid, and the split options.
//
// Props:
//   label, selected (true/false), onPress
//   tone   colour when selected: 'ink' (dark, default) or 'gets' (blue).
//          The design uses ink for Category and blue for "Paid by".

import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius } from '../theme';

const SELECTED_COLOR = {
  ink: colors.ink,
  gets: colors.gets,
};

export default function Chip({ label, selected, onPress, tone = 'ink' }) {
  const selectedColor = SELECTED_COLOR[tone];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: selectedColor, borderColor: selectedColor },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.text, selected && styles.selectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.ink,
  },
  selectedText: {
    fontFamily: fonts.semibold,
    color: colors.surface,
  },
});
