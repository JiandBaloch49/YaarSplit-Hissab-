// theme.js — the app's whole look in one place: colours, fonts, corner
// radii, spacing, and a few ready-made text styles.
//
// Every screen and component takes its styling from here, so changing a
// colour or font later is a one-line edit.
//
// Fonts are loaded in App.js with @expo-google-fonts. With custom fonts we
// pick the weight by choosing a different fontFamily (e.g. InstrumentSans_600SemiBold)
// instead of setting fontWeight — on Android, fontWeight + a custom font can
// fall back to the system font.

export const colors = {
  ink: '#17223B', // main text, primary buttons, selected chips
  fog: '#EDF0F5', // screen background
  surface: '#FFFFFF', // cards, inputs
  line: '#DCE1EA', // dividers and borders
  muted: '#566074', // secondary text
  gets: '#1B5FAE', // "gets money back" (blue)
  getsSoft: '#E3ECF8', // light blue background (tiles, highlights)
  owes: '#A84E0A', // "owes money" (orange); also used for errors
  owesSoft: '#F8EADF', // light orange background
};

// The loaded font names (see useFonts in App.js).
export const fonts = {
  display: 'BricolageGrotesque_700Bold', // screen titles and the big amount
  regular: 'InstrumentSans_400Regular', // everything else…
  medium: 'InstrumentSans_500Medium',
  semibold: 'InstrumentSans_600SemiBold',
};

// Corner radius for each kind of shape.
export const radius = {
  card: 24,
  button: 18,
  chip: 19, // chips are 38 tall, so 19 makes a full pill
  tile: 14, // category / letter icon tiles
  input: 14, // text boxes
};

// Spacing steps, so padding and margins line up across screens.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

// Money uses tabular (fixed-width) digits so amounts line up in columns and
// don't jiggle while typing. Add this to any style that shows rupees.
export const money = {
  fontVariant: ['tabular-nums'],
};

// Ready-made text styles. Use them with spread: { ...text.body, color: ... }
export const text = {
  // Big screen title, e.g. "YaarSplit" on the first screen.
  screenTitle: { fontFamily: fonts.display, fontSize: 36, color: colors.ink },
  // Group name at the top of a group.
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  // Section heading, e.g. "Settle up".
  heading: { fontFamily: fonts.semibold, fontSize: 20, color: colors.ink },
  // Form label, e.g. "Category".
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 16, color: colors.ink },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 14, color: colors.muted },
};
