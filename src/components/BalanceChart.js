// BalanceChart.js — everyone's balance as a diverging bar chart.
//
//   ■ Owes                               Gets back ■
//   Hammal          │██████           Rs 2,350  gets back
//   Zarak     ██████│                 Rs 2,950  owes
//
// How the bars are sized:
//   - A vertical centre line splits each row's track into two halves.
//   - Positive balances (gets money back) grow RIGHT from the line in blue.
//   - Negative balances (owes money) grow LEFT from the line in orange.
//   - bar width = |balance| / (biggest |balance| in the group) × 50% of the
//     track. So the biggest balance fills its whole half, and everyone else
//     is drawn to the same scale.
//
// Props:
//   members   live members of the group
//   balances  { [memberId]: rupees } from computeBalances()

import { StyleSheet, Text, View } from 'react-native';
import { formatRupees } from '../logic/format';
import { colors, fonts, money, text } from '../theme';

export default function BalanceChart({ members, balances }) {
  // The biggest balance either way sets the scale for every bar.
  let maxAbs = 0;
  for (const member of members) {
    maxAbs = Math.max(maxAbs, Math.abs(balances[member.id] || 0));
  }

  return (
    <View style={styles.chart}>
      <View style={styles.legend}>
        <LegendItem color={colors.owes} label="Owes" />
        <LegendItem color={colors.gets} label="Gets back" alignRight />
      </View>

      {members.map((member) => (
        <ChartRow
          key={member.id}
          name={member.name}
          balance={balances[member.id] || 0}
          maxAbs={maxAbs}
        />
      ))}
    </View>
  );
}

function LegendItem({ color, label, alignRight }) {
  const square = <View style={[styles.legendSquare, { backgroundColor: color }]} />;
  return (
    <View style={styles.legendItem}>
      {!alignRight && square}
      <Text style={styles.legendText}>{label}</Text>
      {alignRight && square}
    </View>
  );
}

function ChartRow({ name, balance, maxAbs }) {
  // Fraction of a half-track this bar fills, from 0 to 1.
  // (maxAbs is 0 only when everyone is settled — then there are no bars.)
  const fraction = maxAbs === 0 ? 0 : Math.abs(balance) / maxAbs;
  const barWidth = `${fraction * 100}%`; // percent of ONE half = × 50% of the track

  let color = colors.muted;
  let caption = 'settled up';
  if (balance > 0) {
    color = colors.gets;
    caption = 'gets back';
  } else if (balance < 0) {
    color = colors.owes;
    caption = 'owes';
  }

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${name}: ${balance === 0 ? caption : `${caption} ${formatRupees(balance)}`}`}
    >
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>

      <View style={styles.track}>
        {/* Left half: "owes" bars grow leftwards from the centre. */}
        <View style={[styles.half, styles.leftHalf]}>
          {balance < 0 && (
            <View style={[styles.bar, styles.barLeft, { width: barWidth, backgroundColor: color }]} />
          )}
        </View>
        {/* Right half: "gets back" bars grow rightwards from the centre. */}
        <View style={[styles.half, styles.rightHalf]}>
          {balance > 0 && (
            <View style={[styles.bar, styles.barRight, { width: barWidth, backgroundColor: color }]} />
          )}
        </View>
        {/* The centre line. Rows touch each other, so the line looks continuous. */}
        <View style={styles.centreLine} />
      </View>

      <View style={styles.amountColumn}>
        {/* One line only, shrinking if needed — a wrapped "Rs / 5,120" is hard to read. */}
        <Text style={[styles.amount, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatRupees(balance)}
        </Text>
        <Text style={styles.caption}>{caption}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    padding: 18,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendText: {
    ...text.small,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 62,
    gap: 10,
  },
  name: {
    ...text.bodyStrong,
    width: 84,
    alignSelf: 'center',
  },
  track: {
    flex: 1,
    flexDirection: 'row',
  },
  half: {
    flex: 1,
    justifyContent: 'center', // bar sits in the middle of the row's height
  },
  leftHalf: {
    alignItems: 'flex-end', // push "owes" bars against the centre line
  },
  rightHalf: {
    alignItems: 'flex-start', // "gets back" bars start at the centre line
  },
  bar: {
    height: 22,
    minWidth: 3, // a tiny balance (e.g. Rs 50) still shows a sliver
  },
  // Round only the outer end; the end touching the centre line stays square.
  barLeft: {
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
  },
  barRight: {
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  centreLine: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.line,
  },
  amountColumn: {
    width: 92,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  amount: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    ...money,
  },
  caption: {
    ...text.small,
  },
});
