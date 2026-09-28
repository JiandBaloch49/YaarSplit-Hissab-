// CheckRow.js — a tappable row with a checkbox and a label.
//
// Used for "For whom" on the Add Expense screen. Anything passed as
// `children` is shown on the right side of the row (e.g. a share input for a
// custom split).
//
// Props: label, checked (true/false), onToggle, children (optional)

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';

export default function CheckRow({ label, checked, onToggle, children }) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        style={styles.touchArea}
      >
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked && <Text style={styles.tick}>✓</Text>}
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: space.md,
    minHeight: 52,
  },
  // The checkbox + name take up all the space not used by `children`,
  // so the whole left side is easy to tap.
  touchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: space.md,
    gap: space.md,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.grey,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tick: {
    color: colors.primaryText,
    fontSize: 15,
    fontWeight: '700',
  },
  label: {
    fontSize: 16,
    color: colors.text,
  },
});
