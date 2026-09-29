// App.js — the app's entry component: sets up the database, loads the fonts,
// and lists the screens.
//
// Before anything is shown, we set up the local database (create the tables
// if this is the first launch). initDatabase() uses the sync API, so it has
// finished by the time the next line runs.
//
// Fonts (Bricolage Grotesque + Instrument Sans, see src/theme.js) load from
// the app bundle in a moment. Until they're ready we keep the splash screen
// up, so text never flashes in the wrong font.
//
// Navigation is a simple stack (React Navigation native-stack):
//   Groups  →  Group (Expenses / Balances / Members tabs)
//             →  AddExpense                       (the "Add expense" button)
//             →  ExpenseDetails  →  AddExpense    (tap a row, then "Edit")
//
// <UndoProvider> draws the "Expense deleted. Undo" bar on top of every
// screen (see src/components/UndoBar.js).

import { useEffect } from 'react';
import { Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Each weight is imported from its own folder, so only these 4 font files
// go into the app (importing from the package itself would bundle all 14).
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/database';
import GroupsScreen from './src/screens/GroupsScreen';
import GroupScreen from './src/screens/GroupScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';
import ExpenseDetailsScreen from './src/screens/ExpenseDetailsScreen';
import { UndoProvider } from './src/components/UndoBar';
import { X } from './src/components/icons';
import { colors, fonts } from './src/theme';

// Runs once, when this file is first loaded (i.e. on app start).
initDatabase();

// Keep the splash screen showing until the fonts are loaded (see below).
SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator();

export default function App() {
  // The names used here are the fontFamily names in src/theme.js.
  const [fontsLoaded, fontError] = useFonts({
    BricolageGrotesque_700Bold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
  });

  // Hide the splash once fonts are ready. If they fail to load we still
  // carry on — the app works with the system font, it just looks plainer.
  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null; // splash screen is still showing
  }

  return (
    <SafeAreaProvider>
      <UndoProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName="Groups"
            // Defaults for every screen's standard header.
            screenOptions={{
              headerShadowVisible: false,
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
              contentStyle: { backgroundColor: colors.fog },
            }}
          >
            {/* Groups and Group draw their own big titles, so no standard header. */}
            <Stack.Screen name="Groups" component={GroupsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Group" component={GroupScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="ExpenseDetails"
              component={ExpenseDetailsScreen}
              options={{ title: 'Expense details', headerStyle: { backgroundColor: colors.fog } }}
            />
            <Stack.Screen
              name="AddExpense"
              component={AddExpenseScreen}
              // Same screen for both: an expenseId in the params means editing.
              // A centred title with an ✕ to close, on a white background.
              options={({ route, navigation }) => ({
                title: route.params.expenseId ? 'Edit expense' : 'Add expense',
                headerTitleAlign: 'center',
                headerStyle: { backgroundColor: colors.surface },
                contentStyle: { backgroundColor: colors.surface },
                headerLeft: () => (
                  <Pressable
                    onPress={() => navigation.goBack()}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    hitSlop={12}
                  >
                    <X size={24} color={colors.ink} strokeWidth={2.25} />
                  </Pressable>
                ),
              })}
            />
          </Stack.Navigator>
          <StatusBar style="dark" />
        </NavigationContainer>
      </UndoProvider>
    </SafeAreaProvider>
  );
}
