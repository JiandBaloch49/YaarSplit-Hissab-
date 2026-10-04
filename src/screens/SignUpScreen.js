// SignUpScreen.js — make a YaarSplit account: your name and a username.
//
// Shown on the very first open (App.js), and again from "Put group online"
// if you skipped it. The account is what lets friends find you (@nisar)
// and what the server uses to know it's you. There's no password: the
// server gives this phone a secret token, kept in secure storage
// (src/sync/account.js).
//
// "Not now" is fine: everything works offline without an account. You only
// need one to share a group.
//
// Route params: none. When done, it goes back if it was opened from
// somewhere, otherwise on to the Groups list.

import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import ErrorList from '../components/ErrorList';
import { skipSignUp } from '../sync/account';
import { ApiError } from '../sync/api';
import { signUp } from '../sync/engine';
import { colors, fonts, radius, text } from '../theme';

// The same rules as the server (validate.js there): people may type "@" and
// capitals, which we drop. 3–20 letters, digits or "_".
function cleanUsername(typed) {
  return typed.trim().replace(/^@/, '').toLowerCase();
}

function checkForm(name, username) {
  const errors = [];
  if (name.trim() === '' || name.trim().length > 50) {
    errors.push('Your name must be 1 to 50 characters.');
  }
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    errors.push('Your username must be 3 to 20 characters: letters, digits or _.');
  }
  return errors;
}

export default function SignUpScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [usernameText, setUsernameText] = useState('');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);

  // Leave this screen: back to where we came from, or on to the groups.
  function done() {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('Groups');
  }

  async function handleCreate() {
    const username = cleanUsername(usernameText);
    const problems = checkForm(name, username);
    setErrors(problems);
    if (problems.length > 0) return;

    setSaving(true);
    try {
      await signUp(name.trim(), username);
      done();
    } catch (error) {
      // ApiError: the server said no (e.g. "@nisar is taken"), with details.
      // Anything else: we couldn't reach it.
      if (error instanceof ApiError) {
        setErrors(error.errors?.length ? error.errors : [error.message]);
      } else {
        setErrors([
          'Couldn’t reach the YaarSplit server. Check your internet, or tap “Not now” and sign up later.',
        ]);
      }
      setSaving(false);
    }
  }

  async function handleNotNow() {
    await skipSignUp();
    done();
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
      ]}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Image
        source={require('../../assets/yaarsplit-logo.png')}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="YaarSplit"
      />
      <Text style={styles.title}>Make your account</Text>
      <Text style={styles.intro}>
        Friends add you to their groups by your username. Everything still works without
        internet.
      </Text>

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Jiand Baloch"
        placeholderTextColor={colors.muted}
        autoCapitalize="words"
        returnKeyType="next"
        maxLength={50}
      />

      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        value={usernameText}
        onChangeText={setUsernameText}
        placeholder="@jiandbaloch"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="done"
        onSubmitEditing={handleCreate}
        maxLength={21} // 20 + an "@"
      />
      <Text style={styles.hint}>Letters, digits and _ only. You can’t change it later.</Text>

      <View style={styles.actions}>
        <ErrorList errors={errors} />
        <AppButton
          title={saving ? 'Creating…' : 'Create account'}
          onPress={handleCreate}
          disabled={saving}
        />
        <AppButton title="Not now" variant="secondary" onPress={handleNotNow} disabled={saving} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  content: {
    paddingHorizontal: 20,
  },
  logo: {
    // Same box as on the Groups screen: 180 wide, the image's own shape.
    width: 180,
    height: 117,
    alignSelf: 'center',
  },
  title: {
    ...text.title,
    textAlign: 'center',
    marginTop: 20,
  },
  intro: {
    ...text.small,
    fontSize: 16,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  label: {
    ...text.label,
    marginTop: 20,
    marginBottom: 8,
  },
  input: {
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
  },
  hint: {
    ...text.small,
    marginTop: 8,
  },
  actions: {
    marginTop: 28,
    gap: 12,
  },
});
