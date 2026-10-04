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
// Syncing: once the app is up, startSyncTriggers() (src/sync/triggers.js)
// syncs on open, after every change, when the app comes back to the
// foreground and when the internet returns. The app never waits for it.
//
// Navigation is a simple stack (React Navigation native-stack):
//   SignUp  (first open only, until you sign up or tap "Not now")
//   Groups  →  Group (Expenses / Balances / Members tabs)
//             →  AddExpense                       (the "Add expense" button)
//             →  ExpenseDetails  →  AddExpense    (tap a row, then "Edit")
//             →  AddMoney                         (group fund: "Add money")
//             →  Fund  →  AddMoney                (group fund: "View history")
//             →  InviteMember                     (Members tab: "Invite")
//             →  PersonHistory → ExpenseDetails   (Members tab: tap someone)
//          →  Invitations  →  Invite               (the envelope: answer an invitation)
//          →  Me  →  PersonHistory                 (the person icon)
//
// Invite links: a shared link opens the server's /join page, which opens
// the app at yaarsplit://invite/<inviteId>?code=<code> (the "scheme" in
// app.json). `linking` below turns that into the Invite screen, with the
// Groups list underneath. (Expo Go can't open custom links; there, paste
// the link on the Invitations screen instead.)
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
import { shouldAskToSignUp } from './src/sync/account';
import { startSyncTriggers } from './src/sync/triggers';
import SignUpScreen from './src/screens/SignUpScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import GroupScreen from './src/screens/GroupScreen';
import AddExpenseScreen from './src/screens/AddExpenseScreen';
import ExpenseDetailsScreen from './src/screens/ExpenseDetailsScreen';
import FundScreen from './src/screens/FundScreen';
import AddMoneyScreen from './src/screens/AddMoneyScreen';
import InviteMemberScreen from './src/screens/InviteMemberScreen';
import InvitationsScreen from './src/screens/InvitationsScreen';
import InviteScreen from './src/screens/InviteScreen';
import MeScreen from './src/screens/MeScreen';
import PersonHistoryScreen from './src/screens/PersonHistoryScreen';
import { UndoProvider } from './src/components/UndoBar';
import { X } from './src/components/icons';
import { colors, fonts } from './src/theme';

// Runs once, when this file is first loaded (i.e. on app start).
initDatabase();

// Keep the splash screen showing until the fonts are loaded (see below).
SplashScreen.preventAutoHideAsync();

const Stack = createNativeStackNavigator();

// Which links open which screen. "?code=..." becomes route.params.code
// by itself. initialRouteName puts the Groups list under the Invite screen,
// so "back" goes somewhere sensible when the app was opened by a link.
const linking = {
  prefixes: ['yaarsplit://'],
  config: {
    initialRouteName: 'Groups',
    screens: {
      Invite: 'invite/:inviteId',
    },
  },
};

// Header for plain screens on the grey background ("Me", "Invitations"...).
const plainHeader = { headerStyle: { backgroundColor: colors.fog } };

// Header for form screens ("Add expense", "Add money"): a centred title,
// an ✕ to close, on a white background.
function formOptions(navigation, title) {
  return {
    title,
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
  };
}

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

  // Start syncing (and stop if the app is ever torn down).
  useEffect(() => startSyncTriggers(), []);

  if (!fontsLoaded && !fontError) {
    return null; // splash screen is still showing
  }

  return (
    <SafeAreaProvider>
      <UndoProvider>
        <NavigationContainer linking={linking}>
          <Stack.Navigator
            // First open: the sign-up screen. After that: the groups.
            initialRouteName={shouldAskToSignUp() ? 'SignUp' : 'Groups'}
            // Defaults for every screen's standard header.
            screenOptions={{
              headerShadowVisible: false,
              headerTintColor: colors.ink,
              headerTitleStyle: { fontFamily: fonts.semibold, fontSize: 18, color: colors.ink },
              contentStyle: { backgroundColor: colors.fog },
            }}
          >
            {/* SignUp, Groups and Group draw their own titles, so no standard header. */}
            <Stack.Screen name="SignUp" component={SignUpScreen} options={{ headerShown: false }} />
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
              options={({ route, navigation }) =>
                formOptions(navigation, route.params.expenseId ? 'Edit expense' : 'Add expense')
              }
            />
            <Stack.Screen
              name="Fund"
              component={FundScreen}
              options={{ title: 'Group fund', headerStyle: { backgroundColor: colors.fog } }}
            />
            <Stack.Screen
              name="AddMoney"
              component={AddMoneyScreen}
              options={({ navigation }) => formOptions(navigation, 'Add money')}
            />
            {/* Their titles are set on the screen itself ("Invite Nisar", "Bilal"). */}
            <Stack.Screen
              name="InviteMember"
              component={InviteMemberScreen}
              options={({ navigation }) => formOptions(navigation, 'Invite')}
            />
            <Stack.Screen name="PersonHistory" component={PersonHistoryScreen} options={{ title: '', ...plainHeader }} />
            <Stack.Screen name="Invitations" component={InvitationsScreen} options={{ title: 'Invitations', ...plainHeader }} />
            <Stack.Screen name="Invite" component={InviteScreen} options={{ title: 'Invitation', ...plainHeader }} />
            <Stack.Screen name="Me" component={MeScreen} options={{ title: 'Me', ...plainHeader }} />
          </Stack.Navigator>
          <StatusBar style="dark" />
        </NavigationContainer>
      </UndoProvider>
    </SafeAreaProvider>
  );
}
