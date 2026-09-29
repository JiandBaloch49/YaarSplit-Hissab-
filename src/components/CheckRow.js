// CheckRow.js — one line of the "For whom" checklist on the expense form.
//
//   (✓) Hammal                     Rs 400     ← ticked: their share
//   ( ) Naveed                  Didn't join   ← not ticked
//
// The left side (circle + name) is the tap target. The right side is
// whatever the screen passes as `right`: a share, a share input for a custom
// split, or nothing. Unticked rows show "Didn't join" automatically.
//
// Props: label, checked (true/false), onToggle, right (optional)

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from './icons';
import { colors, fonts } from '../theme';

export default function CheckRow({ label, checked, onToggle, right }) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        style={styles.touchArea}
        hitSlop={4}
      >
        <View style={[styles.circle, checked && styles.circleChecked]}>
          {checked && <Check size={15} color={colors.surface} strokeWidth={3} />}
        </View>
        <Text style={[styles.label, !checked && styles.labelOff]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {checked ? right : <Text style={styles.didntJoin}>Didn’t join</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    gap: 12,
  },
  // Circle + name fill all the space the right side doesn't use, so the
  // whole left part of the row is easy to tap.
  touchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  circle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleChecked: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
  },
  labelOff: {
    color: colors.muted,
  },
  didntJoin: {
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.muted,
  },
});
