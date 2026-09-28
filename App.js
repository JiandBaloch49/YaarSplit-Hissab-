// App.js — the app's entry component.
//
// Before anything is shown, we set up the local database (create the tables
// if this is the first launch). initDatabase() uses the sync API, so it has
// finished by the time the next line runs.
//
// TEMPORARY: while developing (__DEV__ is true), there's a "Load test data"
// button that fills in the three-meals example and prints the balances, so we
// can check the database + split math on a real phone. Remove it once real
// screens exist. In a release build __DEV__ is false and the button is hidden.

import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';
import { initDatabase } from './src/db/database';
import {
  addExpense,
  addGroup,
  addMember,
  listExpenses,
  listMembers,
  listPayments,
} from './src/db/queries';
import { computeBalances, settleUp } from './src/logic/split';

// Runs once, when this file is first loaded (i.e. on app start).
initDatabase();

// DEV ONLY: create a "Test Trip" group with the three-meals example, then
// return the balances and settle-up transfers as lines of plain text.
//   Meal 1: A paid 600 for A, B, C
//   Meal 2: B paid 800 for A, B, C, D
//   Meal 3: C paid 300 for C, D
// Expected balances: A +200, B +400, C -250, D -350.
function loadTestData() {
  const group = addGroup('Test Trip');

  // Make the members, and remember each one's id by name.
  const ids = {};
  for (const name of ['A', 'B', 'C', 'D']) {
    ids[name] = addMember(group.id, name).id;
  }

  // Small helper: an equal-split food expense paid in full by one person.
  function meal(description, payer, amount, forNames) {
    const result = addExpense(group.id, {
      description,
      amount,
      category: 'food',
      split_type: 'equal',
      payers: [{ member_id: ids[payer], amount }],
      participants: forNames.map((name) => ({ member_id: ids[name] })),
    });
    // If validation ever fails, make it loud instead of silently skipping.
    if (!result.ok) throw new Error(result.errors.join(' '));
  }
  meal('Meal 1', 'A', 600, ['A', 'B', 'C']);
  meal('Meal 2', 'B', 800, ['A', 'B', 'C', 'D']);
  meal('Meal 3', 'C', 300, ['C', 'D']);

  // Read everything back FROM THE DATABASE (not from the values above), so
  // this also checks that saving and loading work.
  const members = listMembers(group.id);
  const balances = computeBalances(members, listExpenses(group.id), listPayments(group.id));
  const transfers = settleUp(balances);

  // Turn member ids back into names for display.
  const nameOf = {};
  for (const m of members) nameOf[m.id] = m.name;

  const lines = ['Balances:'];
  for (const m of members) {
    const b = balances[m.id];
    lines.push(`  ${m.name} ${b > 0 ? '+' : ''}${b}`); // show "+" for positives
  }
  lines.push('', 'Settle up:');
  for (const t of transfers) {
    lines.push(`  ${nameOf[t.fromId]} pays ${nameOf[t.toId]} ${t.amount}`);
  }
  return lines.join('\n');
}

export default function App() {
  // Text shown after pressing the dev button (empty until then).
  const [output, setOutput] = useState('');

  function handleLoadTestData() {
    try {
      setOutput(loadTestData());
    } catch (error) {
      setOutput(`Error: ${error.message}`);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text>Open up App.js to start working on your app!</Text>

      {__DEV__ && (
        <>
          <Button title="Load test data" onPress={handleLoadTestData} />
          <Text style={styles.output}>{output}</Text>
        </>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  output: {
    fontSize: 16,
  },
});
