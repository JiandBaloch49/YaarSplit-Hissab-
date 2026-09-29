// ErrorList.js — shows a box listing what's wrong (e.g. the messages from
// prepareExpense). Shows nothing when there are no errors.
//
// Props: errors (array of strings)

import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts, radius } from '../theme';

export default function ErrorList({ errors }) {
  if (!errors || errors.length === 0) return null;

  return (
    <View style={styles.box} accessibilityRole="alert">
      {errors.map((message) => (
        <Text key={message} style={styles.text}>
          • {message}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.owesSoft,
    borderRadius: radius.input,
    padding: 14,
    gap: 4,
  },
  text: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
    color: colors.owes,
  },
});
