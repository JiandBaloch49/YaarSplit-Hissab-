// AppButton.js — the one button style used across the app.
//
// Props:
//   title     text on the button
//   onPress   what to do when tapped
//   variant   'primary' (filled blue, default), 'secondary' (outlined),
//             or 'danger' (red text, for things like "Remove")
//   small     true for a compact button inside a list row
//   disabled  greys it out and ignores taps

import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, radius, space } from './theme';

export default function AppButton({ title, onPress, variant = 'primary', small, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.text, small && styles.smallText, styles[`${variant}Text`]]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    borderWidth: 1,
  },
  small: {
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
  },
  danger: {
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
  },
  smallText: {
    fontSize: 14,
  },
  primaryText: {
    color: colors.primaryText,
  },
  secondaryText: {
    color: colors.primary,
  },
  dangerText: {
    color: colors.red,
  },
});
