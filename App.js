// App.js — the app's entry component: sets up the database and the screens.
//
// Before anything is shown, we set up the local database (create the tables
// if this is the first launch). initDatabase() uses the sync API, so it has
// finished by the time the next line runs.
//
// Navigation is a simple stack (React Navigation native-stack):
//   Groups  →  Group (Expenses / Balances / Members tabs)  →  AddExpense
//   (AddExpense is also used for editing an expense.)

import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { initDatabase } from './src/db/database';
import GroupsScreen from './src/screens/GroupsScreen';
import GroupScreen from './src/screens/GroupScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';

// Runs once, when this file is first loaded (i.e. on app start).
initDatabase();

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Groups">
        <Stack.Screen name="Groups" component={GroupsScreen} options={{ title: 'Hisaab' }} />
        <Stack.Screen
          name="Group"
          component={GroupScreen}
          // Show the group's name in the header (passed in by GroupsScreen).
          options={({ route }) => ({ title: route.params.name })}
        />
        <Stack.Screen
          name="AddExpense"
          component={AddExpenseScreen}
          // Same screen for both: an expenseId in the params means editing.
          options={({ route }) => ({
            title: route.params.expenseId ? 'Edit expense' : 'Add expense',
          })}
        />
      </Stack.Navigator>
      <StatusBar style="auto" />
    </NavigationContainer>
  );
}
