// InviteMemberScreen.js — an admin invites someone to take one member slot.
// Opened from "Invite" on the Members tab.
//
//   Invite Nisar
//   Already on YaarSplit?
//   [ @ search username   ]
//     Nisar Ahmed  @nisar                      [Invite]
//   Not on YaarSplit yet?
//   [ Share on WhatsApp ]  [ Share another way ]
//
// Two ways in (both handled by the server, see src/sync/invites.js):
//   - By username: the invite shows up in that person's Invitations.
//   - A personal link: sent on WhatsApp (or anywhere). Whoever opens it can
//     join as this member, once, within 7 days.
// Either way, accepting links their account to this member slot, with all
// its past expenses. A new invite replaces any older one for the slot, so a
// link is made only once per visit to this screen and reused for both
// share buttons.
//
// Everything here needs the internet.
//
// Route params: groupId, memberId

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import ErrorList from '../components/ErrorList';
import { LetterTile } from '../components/IconTile';
import { MessageCircle, Search, Share2 } from '../components/icons';
import { getGroup, listMembersByIds } from '../db/queries';
import { inviteMessage } from '../logic/invite';
import { ApiError } from '../sync/api';
import { createInviteLink, inviteByUsername, searchAccounts } from '../sync/invites';
import { colors, fonts, radius, text } from '../theme';

// Wait this long after the last keystroke before searching, so typing
// "nisar" asks the server once instead of five times.
const SEARCH_DELAY_MS = 350;

// A readable message for a failed server call (OfflineError / ApiError).
function serverMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'Couldn’t reach the YaarSplit server. Check your internet and try again.';
}

export default function InviteMemberScreen({ route, navigation }) {
  const { groupId, memberId } = route.params;
  const insets = useSafeAreaInsets();
  // Read once: the slot and the group don't change while inviting.
  const [member] = useState(() => listMembersByIds(groupId, [memberId])[0]);
  const [groupName] = useState(() => getGroup(groupId)?.name ?? '');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false); // inviting / making a link
  const [link, setLink] = useState(null); // the link, once made

  // What's been typed, as a username: "@Nis " → "Nis".
  const typed = query.trim().replace(/^@/, '');

  // Typing: clear old results straight away when it's too short to search,
  // otherwise show the spinner until the search below answers.
  function handleQueryChange(value) {
    setQuery(value);
    const enough = value.trim().replace(/^@/, '').length >= 2;
    setSearching(enough);
    if (!enough) setResults([]);
  }

  // Search a moment after typing stops. `cancelled` drops the answer to an
  // older search that arrives after a newer one started.
  useEffect(() => {
    if (typed.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const found = await searchAccounts(typed);
        if (!cancelled) {
          setResults(found);
          setErrors([]);
        }
      } catch (error) {
        if (!cancelled) setErrors([serverMessage(error)]);
      }
      if (!cancelled) setSearching(false);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typed]);

  // Navigation title: "Invite Nisar".
  useEffect(() => {
    if (member) navigation.setOptions({ title: `Invite ${member.name}` });
  }, [member, navigation]);

  if (!member) {
    return (
      <View style={styles.centered}>
        <Text style={text.small}>This person is no longer in the group.</Text>
      </View>
    );
  }

  async function handleInvite(account) {
    setBusy(true);
    try {
      await inviteByUsername(groupId, member, account.username);
      Alert.alert(
        `Invited @${account.username}`,
        `They’ll see it under Invitations in YaarSplit and can join as ${member.name}.`
      );
      navigation.goBack();
    } catch (error) {
      setErrors([serverMessage(error)]);
      setBusy(false);
    }
  }

  // The link, made the first time it's needed (making another would cancel
  // the first one).
  async function getLink() {
    if (link) return link;
    setBusy(true);
    try {
      const made = await createInviteLink(groupId, member);
      setLink(made.link);
      return made.link;
    } catch (error) {
      setErrors([serverMessage(error)]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  // WhatsApp's "wa.me" address opens WhatsApp with the message ready to
  // send (pick the chat there). Without WhatsApp, fall back to the phone's
  // share sheet.
  async function handleWhatsApp() {
    const made = await getLink();
    if (!made) return;
    const message = inviteMessage(groupName, member.name, made);
    try {
      await Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`);
    } catch {
      await Share.share({ message });
    }
  }

  async function handleShare() {
    const made = await getLink();
    if (!made) return;
    await Share.share({ message: inviteMessage(groupName, member.name, made) });
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        When they accept, {member.name}’s expenses and payments — past and future — show up on their
        phone.
      </Text>

      {/* --- By username --- */}
      <Text style={styles.sectionTitle}>Already on YaarSplit?</Text>
      <View style={styles.searchBox}>
        <Search size={20} color={colors.muted} strokeWidth={2} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={handleQueryChange}
          placeholder="Search their @username"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searching && <ActivityIndicator color={colors.muted} />}
      </View>
      {results.length > 0 && (
        <Card inset={74}>
          {results.map((account) => (
            <View key={account.id} style={styles.resultRow}>
              <LetterTile letter={account.name[0].toUpperCase()} tone="gets" />
              <View style={styles.resultText}>
                <Text style={styles.resultName} numberOfLines={1}>
                  {account.name}
                </Text>
                <Text style={text.small} numberOfLines={1}>
                  @{account.username}
                </Text>
              </View>
              <AppButton
                title="Invite"
                variant="secondary"
                small
                disabled={busy}
                onPress={() => handleInvite(account)}
              />
            </View>
          ))}
        </Card>
      )}
      {!searching && typed.length >= 2 && results.length === 0 && errors.length === 0 && (
        <Text style={styles.hint}>Nobody with that username. Send them a link instead.</Text>
      )}

      {/* --- By link --- */}
      <Text style={styles.sectionTitle}>Not on YaarSplit yet?</Text>
      <Text style={styles.hint}>
        Send {member.name} a personal link. It works once and expires in 7 days.
      </Text>
      <AppButton title="Share on WhatsApp" icon={MessageCircle} onPress={handleWhatsApp} disabled={busy} />
      <AppButton
        title="Share another way"
        icon={Share2}
        variant="secondary"
        onPress={handleShare}
        disabled={busy}
      />
      {link && (
        <Text style={styles.hint}>
          Link ready. Sending it again later? Come back here — a new link replaces this one.
        </Text>
      )}

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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  intro: {
    ...text.body,
    lineHeight: 23,
    color: colors.muted,
  },
  sectionTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.muted,
    marginTop: 16,
    marginLeft: 4,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 17,
    color: colors.ink,
    paddingVertical: 12,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  resultText: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    ...text.bodyStrong,
    fontSize: 17,
  },
  hint: {
    ...text.small,
    lineHeight: 20,
    marginHorizontal: 4,
  },
});
