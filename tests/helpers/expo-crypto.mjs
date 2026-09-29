// expo-crypto.mjs — a stand-in for expo-crypto, for tests only.
// The app only uses randomUUID(), which Node has built in.

export function randomUUID() {
  return globalThis.crypto.randomUUID();
}
