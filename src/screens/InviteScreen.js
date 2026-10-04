// InviteScreen.js — one invitation: a preview of the group, then Accept or
// Decline.
//
//   Join Kund Malir trip?
//   Ali invited you to join as Nisar.
//   You'll see everything Nisar ate and paid for — past and future.
//   PEOPLE IN THIS GROUP
//   Ali · on YaarSplit / Bilal · not on YaarSplit yet / ...
//   Expires in 6 days
//   [ Accept ]  [ Decline ]
//
// Opened from the Invitations list, from a pasted link, or straight from a
// shared link (yaarsplit://invite/<id>?code=<code>, see App.js).
// Accepting links my account to that member slot; then a sync brings the
// group onto this phone and we open it.
//
// Route params:
//   inviteId   which invite
//   code       the secret code, for link invites (absent for username ones)

import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import ErrorList from '../components/ErrorList';
import { describeExpiry } from '../logic/format';
import { getAccount } from '../sync/account';
import { ApiError } from '../sync/api';
import { acceptInvite, declineInvite, getInvite } from '../sync/invites';
import { colors, fonts, text } from '../theme';

// A readable message for a failed server call (OfflineError / ApiError).
function serverMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'Couldn’t reach the YaarSplit server. Check your internet and try again.';
}

export default function InviteScreen({ route, navigation }) {
  const { inviteId, code } = route.params;
  const insets = useSafeAreaInsets();
  const [preview, setPreview] = useState(null); // what GET /invites/:id says
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(() => Boolean(getAccount()));

  const load = useCallback(async () => {
    if (!getAccount()) return;
    try {
      setPreview(await getInvite(inviteId, code));
      setErrors([]);
    } catch (error) {
      setErrors([serverMessage(error)]);
    }
  }, [inviteId, code]);

  // Load when the screen opens — and when coming back from signing up.
  // Once loaded (preview set) it doesn't ask again.
  useFocusEffect(
    useCallback(() => {
      const nowSignedIn = Boolean(getAccount());
      setSignedIn(nowSignedIn);
      if (nowSignedIn && !preview) load();
    }, [load, preview])
  );

  async function handleAccept() {
    setBusy(true);
    try {
      const groupId = await acceptInvite(inviteId, code);
      // Groups list underneath, the new group on top.
      navigation.reset({
        index: 1,
        routes: [
          { name: 'Groups' },
          { name: 'Group', params: { groupId, name: preview.group.name, initialTab: 'balances' } },
        ],
      });
    } catch (error) {
      setErrors([serverMessage(error)]);
      setBusy(false);
    }
  }

  async function handleDecline() {
    setBusy(true);
    try {
      await declineInvite(inviteId, code);
      navigation.goBack();
    } catch (error) {
      setErrors([serverMessage(error)]);
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <Text style={styles.title}>You’re invited to a group</Text>
        <Text style={styles.body}>Make your YaarSplit account first, then you can join.</Text>
        <AppButton title="Make account" onPress={() => navigation.navigate('SignUp')} />
      </View>
    );
  }

  if (!preview) {
    return (
      <View style={[styles.screen, styles.centered]}>
        {errors.length > 0 ? (
          <>
            <ErrorList errors={errors} />
            <AppButton title="Try again" variant="secondary" onPress={load} />
          </>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }

  const { invite, group, member } = preview;
  // Already answered, or expired: say so instead of offering the buttons.
  const closed = invite.status !== 'pending' || invite.expired;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}>
        <Text style={styles.title}>Join {group.name}?</Text>
        <Text style={styles.body}>
          {preview.invited_by_name ?? 'An admin'} invited you to join as{' '}
          <Text style={styles.strong}>{member.name}</Text>. You’ll see everything {member.name} ate and
          paid for — past and future.
        </Text>

        <Text style={styles.sectionTitle}>People in this group</Text>
        <Card>
          {group.members.map((person, index) => (
            // Names can repeat, so the position is part of the key.
            <View key={`${index}-${person.name}`} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>
                {person.name}
                {person.invited ? ' (you)' : ''}
              </Text>
              <Text style={text.small}>{person.joined ? 'on YaarSplit' : 'not on YaarSplit yet'}</Text>
            </View>
          ))}
        </Card>

        <Text style={styles.expiry}>
          {invite.status !== 'pending'
            ? `This invite was already ${invite.status}.`
            : describeExpiry(invite.expires_at)}
        </Text>
        <ErrorList errors={errors} />
      </ScrollView>

      {!closed && (
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          <AppButton title="Accept" onPress={handleAccept} disabled={busy} style={styles.actionButton} />
          <AppButton
            title="Decline"
            variant="danger"
            onPress={handleDecline}
            disabled={busy}
            style={styles.actionButton}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.fog,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  title: {
    ...text.title,
  },
  body: {
    ...text.body,
    lineHeight: 23,
  },
  strong: {
    fontFamily: fonts.semibold,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 12,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 18,
  },
  name: {
    ...text.body,
    fontSize: 17,
    flexShrink: 1,
  },
  expiry: {
    ...text.small,
    marginLeft: 4,
  },
  actions: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: colors.fog,
  },
  actionButton: {
    flex: 1,
  },
});
