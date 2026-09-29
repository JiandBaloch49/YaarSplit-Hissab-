// IconTile.js — the small rounded square on the left of a row.
//
// Two kinds:
//   <CategoryTile category="food" />   an icon for the expense's category
//   <LetterTile letter="K" tone="gets" />  a group's first letter
//
// Tones pick the colours: 'gets' (blue), 'owes' (orange) or 'plain' (grey).

import { StyleSheet, Text, View } from 'react-native';
import { Bus, Coffee, Ellipsis, ShoppingBag, Soup, Wrench } from './icons';
import { colors, fonts, radius } from '../theme';

const TONES = {
  gets: { background: colors.getsSoft, foreground: colors.gets },
  owes: { background: colors.owesSoft, foreground: colors.owes },
  plain: { background: colors.fog, foreground: colors.ink },
};

// Which icon and tone each category gets (categories are listed in split.js).
const CATEGORY_LOOK = {
  food: { Icon: Soup, tone: 'gets' },
  tea: { Icon: Coffee, tone: 'plain' },
  transport: { Icon: Bus, tone: 'gets' },
  repair: { Icon: Wrench, tone: 'owes' },
  shopping: { Icon: ShoppingBag, tone: 'owes' },
  other: { Icon: Ellipsis, tone: 'plain' },
};

export function CategoryTile({ category }) {
  const { Icon, tone } = CATEGORY_LOOK[category] || CATEGORY_LOOK.other;
  const { background, foreground } = TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: background }]}>
      <Icon size={22} color={foreground} strokeWidth={2} />
    </View>
  );
}

export function LetterTile({ letter, tone = 'plain' }) {
  const { background, foreground } = TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: background }]}>
      <Text style={[styles.letter, { color: foreground }]}>{letter}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 44,
    height: 44,
    borderRadius: radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: fonts.semibold,
    fontSize: 18,
  },
});
