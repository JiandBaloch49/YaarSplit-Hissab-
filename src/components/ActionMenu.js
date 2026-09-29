// ActionMenu.js — a list of choices that slides up from the bottom, used for
// the "..." menu on the group screen ("Rename group", "Delete group").
//
// It's drawn as an overlay on top of the screen rather than a native Modal:
// on iOS, opening a pop-up (like the rename box) while a Modal is still
// closing can fail silently, and the menu often leads straight into one.
// Render it LAST inside a full-screen view so it covers everything.
//
// Props:
//   visible   show or hide it
//   options   [{ label, onPress, destructive }]  destructive = shown in orange
//   onClose   called when the menu should close (Cancel, tap outside, back)

import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../theme';

export default function ActionMenu({ visible, options, onClose }) {
  const insets = useSafeAreaInsets();

  // Android's back button closes the menu instead of leaving the screen.
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true; // "handled" — don't also go back
    });
    return () => subscription.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Tapping the dimmed area outside the menu closes it. */}
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close menu"
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.options}>
          {options.map((option, index) => (
            <Pressable
              key={option.label}
              onPress={() => {
                onClose();
                option.onPress();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.option,
                index > 0 && styles.divider,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.optionText, option.destructive && styles.destructive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(23, 34, 59, 0.45)', // see-through ink
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    gap: 10,
  },
  options: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  option: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: colors.line,
  },
  pressed: {
    backgroundColor: colors.fog,
  },
  optionText: {
    fontFamily: fonts.medium,
    fontSize: 18,
    color: colors.ink,
  },
  destructive: {
    color: colors.owes,
  },
  cancel: {
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
  },
  cancelText: {
    fontFamily: fonts.semibold,
    fontSize: 18,
    color: colors.ink,
  },
});
