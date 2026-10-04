// InvitationsScreen.js — invitations waiting for me. Opened from the
// envelope (with its badge) on the Groups screen.
//
//   Ali invited you to
//   Kund Malir trip                                         >
//   as Nisar · Expires in 6 days
//
//   HAVE AN INVITE LINK?
//   [ paste the link here      ]  [Open]
//
// Tap an invitation to see the group and Accept / Decline (InviteScreen).
// Invites sent to my username come from the server (GET /me/invites).
// A personal link someone sent on WhatsApp normally opens the app by
// itself; if it doesn't (e.g. in Expo Go), paste it in the box.
//
// Needs the internet. Without an account there's nothing to show, so it
// offers to make one.
//
// Route params: none.

import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import ErrorList from '../components/ErrorList';
import { LetterTile } from '../components/IconTile';
import { ChevronRight } from '../components/icons';
import { describeExpiry } from '../logic/format';
import { parseInviteLink } from '../logic/invite';
import { getAccount } from '../sync/account';
import { ApiError } from '../sync/api';
import { listMyInvites } from '../sync/invites';
import { colors, fonts, radius, text } from '../theme';

export default function InvitationsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [pasted, setPasted] = useState('');
  const signedIn = Boolean(getAccount());

  const load = useCallback(async () => {
    if (!getAccount()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setInvites(await listMyInvites());
      setErrors([]);
    } catch (error) {
      setErrors([
        error instanceof ApiError
          ? error.message
          : 'Couldn’t reach the YaarSplit server. Pull down to try again.',
      ]);
    }
    setLoading(false);
  }, []);

  // Load every time the screen comes into view (e.g. back after declining).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handleOpenLink() {
    const found = parseInviteLink(pasted);
    if (!found) {
      setErrors(['That doesn’t look like a YaarSplit invite link. Paste the whole link.']);
      return;
    }
    setPasted('');
    setErrors([]);
    navigation.navigate('Invite', found);
  }

  if (!signedIn) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.emptyTitle}>Make an account first</Text>
        <Text style={styles.empty}>Friends invite you by your username.</Text>
        <AppButton title="Make account" onPress={() => navigation.navigate('SignUp')} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {invites.length === 0 ? (
        !loading && <Text style={styles.empty}>No invitations right now.</Text>
      ) : (
        <Card inset={74}>
          {invites.map((invite) => (
            <Pressable
              key={invite.id}
              onPress={() => navigation.navigate('Invite', { inviteId: invite.id })}
              accessibilityRole="button"
              accessibilityHint="Shows the group, to accept or decline"
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <LetterTile letter={invite.group_name[0].toUpperCase()} tone="gets" />
              <View style={styles.rowText}>
                <Text style={text.small}>{invite.invited_by_name ?? 'Someone'} invited you to</Text>
                <Text style={styles.groupName} numberOfLines={2}>
                  {invite.group_name}
                </Text>
                <Text style={text.small}>
                  as {invite.member_name} · {describeExpiry(invite.expires_at)}
                </Text>
              </View>
              <ChevronRight size={20} color={colors.muted} strokeWidth={2} />
            </Pressable>
          ))}
        </Card>
      )}

      <Text style={styles.sectionTitle}>Have an invite link?</Text>
      <View style={styles.pasteRow}>
        <TextInput
          style={styles.input}
          value={pasted}
          onChangeText={setPasted}
          placeholder="Paste the link here"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleOpenLink}
        />
        <AppButton title="Open" onPress={handleOpenLink} disabled={pasted.trim() === ''} />
      </View>

      <ErrorList errors={errors} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyTitle: {
    ...text.heading,
  },
  empty: {
    ...text.small,
    fontSize: 16,
    textAlign: 'center',
    marginVertical: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  pressed: {
    backgroundColor: colors.fog,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  groupName: {
    ...text.bodyStrong,
    fontSize: 18,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 16,
    marginLeft: 4,
  },
  pasteRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.ink,
  },
});
