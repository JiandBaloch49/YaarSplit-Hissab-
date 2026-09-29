// SegmentedControl.js — a row of options on a grey track, with the chosen
// one shown as a white pill. Used for the Expenses / Balances / Members tabs.
//
// Props:
//   options   [{ key, label }]
//   value     the key of the selected option
//   onChange  called with the key of the option tapped

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';

export default function SegmentedControl({ options, value, onChange }) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.selected]}
          >
            <Text style={[styles.text, selected && styles.selectedText]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.line,
    borderRadius: radius.button,
    padding: 4,
  },
  // Each segment takes an equal share of the width.
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  selected: {
    backgroundColor: colors.surface,
    // A soft shadow so the white pill lifts off the grey track.
    shadowColor: colors.ink,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.muted,
  },
  selectedText: {
    fontFamily: fonts.semibold,
    color: colors.ink,
  },
});
