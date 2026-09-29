// UndoBar.js — the small dark bar that appears at the bottom for 5 seconds
// after deleting something:   "Expense deleted.            Undo"
//
// How it fits together:
//   - <UndoProvider> wraps the whole app (see App.js) and draws the bar on
//     top of every screen. That way the bar stays visible even when the
//     screen that deleted something closes (e.g. Expense details → back).
//   - Any screen calls useUndo().showUndo(message, onUndo) right after a
//     delete. `onUndo` is what to run if "Undo" is tapped (e.g. restore the
//     row in the database).
//   - Screens showing that data call useAfterUndo(reload), so they reload
//     as soon as "Undo" is tapped (see GroupScreen).
//   - Floating buttons use useUndo().isShowing and UNDO_BAR_SPACE to move up
//     out of the bar's way while it's visible (see ExpensesTab).
//
// Only one bar at a time: a new delete replaces the old bar (the older
// delete simply stays deleted).

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts, radius } from '../theme';

const SHOW_FOR_MS = 5000; // 5 seconds
const BAR_HEIGHT = 56;

// How far a floating button must move up to sit just above the bar
// (the bar's height plus a 12px gap).
export const UNDO_BAR_SPACE = BAR_HEIGHT + 12;

const UndoContext = createContext(null);

export function UndoProvider({ children }) {
  const insets = useSafeAreaInsets();
  // What the bar is showing: { message, onUndo }, or null when hidden.
  const [current, setCurrent] = useState(null);
  const timer = useRef(null);
  // Functions to call after an undo (registered with useAfterUndo).
  const listeners = useRef(new Set());

  function stopTimer() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  const showUndo = useCallback((message, onUndo) => {
    stopTimer();
    setCurrent({ message, onUndo });
    // Hide by itself after 5 seconds.
    timer.current = setTimeout(() => setCurrent(null), SHOW_FOR_MS);
  }, []);

  // Register a function to run after every undo. Returns an "unregister"
  // function, which is exactly what useEffect wants as its cleanup.
  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  // Don't leave a timer running if the app closes the provider.
  useEffect(() => stopTimer, []);

  function handleUndo() {
    stopTimer();
    current.onUndo();
    setCurrent(null);
    // Tell screens showing this data to reload.
    for (const listener of listeners.current) listener();
  }

  return (
    <UndoContext.Provider value={{ showUndo, subscribe, isShowing: current !== null }}>
      {children}
      {current && (
        <View
          style={[styles.bar, { bottom: insets.bottom + 16 }]}
          // Screen readers announce the message when the bar appears.
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
        >
          <Text style={styles.message} numberOfLines={1}>
            {current.message}
          </Text>
          <Pressable onPress={handleUndo} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.undo}>Undo</Text>
          </Pressable>
        </View>
      )}
    </UndoContext.Provider>
  );
}

// { showUndo(message, onUndo), isShowing }
export function useUndo() {
  return useContext(UndoContext);
}

// Run `callback` every time "Undo" is tapped, e.g. useAfterUndo(reload).
// Pass a stable function (from useCallback) so it isn't re-registered on
// every render.
export function useAfterUndo(callback) {
  const { subscribe } = useContext(UndoContext);
  useEffect(() => subscribe(callback), [subscribe, callback]);
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    height: BAR_HEIGHT, // fixed, so UNDO_BAR_SPACE is always right
    paddingHorizontal: 20,
    borderRadius: radius.button,
    backgroundColor: colors.ink,
    // Lift it above the screen so it reads as floating.
    shadowColor: colors.ink,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  message: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 16,
    color: colors.surface,
  },
  undo: {
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: '#9CC2F0', // light blue: readable on the dark ink bar
  },
});
