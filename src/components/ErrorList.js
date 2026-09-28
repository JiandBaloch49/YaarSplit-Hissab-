// ErrorList.js — shows a red box listing what's wrong (e.g. the messages
// from prepareExpense). Shows nothing when there are no errors.
//
// Props: errors (array of strings)

import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';

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
    backgroundColor: colors.errorBackground,
    borderColor: colors.red,
    borderWidth: 1,
    borderRadius: radius,
    padding: space.md,
    gap: space.xs,
  },
  text: {
    color: colors.red,
    fontSize: 15,
  },
});
