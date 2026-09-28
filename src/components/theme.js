// theme.js — the few colours and sizes the whole app shares.
//
// Keeping them in one place means every screen looks the same, and changing
// a colour later is a one-line edit.

export const colors = {
  background: '#f6f7f9', // screen background (light grey)
  card: '#ffffff', // rows, inputs, panels
  border: '#e2e5ea',
  text: '#1c1f24',
  muted: '#6b7280', // secondary text (dates, hints)
  primary: '#2563eb', // buttons, selected chips
  primaryText: '#ffffff', // text on a primary background
  green: '#15803d', // "gets money"
  red: '#dc2626', // "owes money" and errors
  grey: '#9ca3af', // "settled"
  errorBackground: '#fef2f2',
};

// Spacing steps, so padding/margins line up across screens.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = 10;
