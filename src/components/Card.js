// Card.js — a white rounded panel holding a list of rows, with thin lines
// between them (like the expense and settle-up lists in the design).
//
//   <Card>
//     <Row>...</Row>
//     <Row>...</Row>
//   </Card>
//
// Props:
//   children   the rows; a divider is drawn between each pair
//   inset      how far from the left the dividers start (default 16).
//              Rows with an icon tile use 72 so the line starts after it.
//   style      extra style for the card itself

import { Children, Fragment } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';

export default function Card({ children, inset = 16, style }) {
  // Drop empty children (e.g. `{show && <Row/>}` when show is false) so we
  // don't draw dividers around nothing.
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <View style={[styles.card, style]}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 && <View style={[styles.divider, { marginLeft: inset }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    overflow: 'hidden', // keep pressed-row highlights inside the rounded corners
  },
  divider: {
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: colors.line,
  },
});
