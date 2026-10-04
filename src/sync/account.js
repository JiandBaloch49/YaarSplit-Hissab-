// account.js — who is signed in on this phone.
//
// Signing up (POST /accounts on the server) gives the phone a secret device
// token. It proves "this phone is @nisar" on every request, so it is kept
// in expo-secure-store — encrypted by the phone (Android Keystore / iOS
// Keychain) — and NEVER in the SQLite database, which isn't encrypted.
// The account's name and username aren't secret, but they're kept right
// next to the token so the two can never disagree.
//
// SecureStore.getItem() is synchronous, so everything here returns straight
// away; it's quick enough to simply read it every time.

import * as SecureStore from 'expo-secure-store';

// SecureStore keys may only use letters, digits, ".", "-" and "_".
const TOKEN_KEY = 'yaarsplit.token';
const ACCOUNT_KEY = 'yaarsplit.account';
const SKIPPED_KEY = 'yaarsplit.signup_skipped';

// Read a key, treating "SecureStore isn't available" (e.g. a web preview)
// the same as "nothing saved".
function read(key) {
  try {
    return SecureStore.getItem(key);
  } catch {
    return null;
  }
}

/** The signed-in account { id, name, username }, or null. */
export function getAccount() {
  const saved = read(ACCOUNT_KEY);
  return saved && read(TOKEN_KEY) ? JSON.parse(saved) : null;
}

/** The device token to send to the server, or null if not signed in. */
export function getToken() {
  return getAccount() ? read(TOKEN_KEY) : null;
}

/** Save what POST /accounts returned: { account, token }. */
export async function saveAccount(newAccount, token) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(newAccount));
}

/**
 * "Not now" on the sign-up screen. We remember it so the sign-up screen
 * isn't shown on every launch; "Put group online" offers it again.
 */
export async function skipSignUp() {
  await SecureStore.setItemAsync(SKIPPED_KEY, '1');
}

/** Show the sign-up screen first? Only until signed up or skipped. */
export function shouldAskToSignUp() {
  return !getAccount() && read(SKIPPED_KEY) !== '1';
}
