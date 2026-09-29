// AppButton.js — the one button style used across the app.
//
// Props:
//   title     text on the button
//   onPress   what to do when tapped
//   variant   'primary'   filled dark ink (default) — the main action
//             'secondary' white with an ink outline — e.g. "Mark as paid"
//             'danger'    white with orange text — e.g. "Remove", "Delete"
//   icon      optional icon component shown before the title, e.g. Plus
//   small     true for a compact button inside a list row
//   disabled  greys it out and ignores taps
//   style     extra style, e.g. to float the button over a list

import { Pressable, StyleSheet, Text } from 'react-native';
import { colors, fonts, radius } from '../theme';

const TEXT_COLOR = {
  primary: colors.surface,
  secondary: colors.ink,
  danger: colors.owes,
};

export default function AppButton({
  title,
  onPress,
  variant = 'primary',
  icon: Icon,
  small,
  disabled,
  style,
}) {
  const textColor = TEXT_COLOR[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => [
        styles.base,
        small ? styles.small : styles.large,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {Icon && <Icon size={small ? 16 : 20} color={textColor} strokeWidth={2.25} />}
      <Text style={[styles.text, small && styles.smallText, { color: textColor }]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.button,
    borderWidth: 1.5,
  },
  large: {
    minHeight: 56,
    paddingHorizontal: 24,
  },
  small: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  primary: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.ink,
  },
  danger: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.35,
  },
  text: {
    fontFamily: fonts.semibold,
    fontSize: 17,
  },
  smallText: {
    fontSize: 15,
  },
});
