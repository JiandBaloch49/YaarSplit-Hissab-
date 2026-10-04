// expo-secure-store.mjs — a stand-in for expo-secure-store, for tests only.
// A plain in-memory Map per pretend phone (see expo-sqlite.mjs for
// globalThis.testPhone). Only the functions the app uses are here.

const stores = new Map(); // phone name → Map(key → value)

function current() {
  const phone = globalThis.testPhone ?? 'default';
  if (!stores.has(phone)) stores.set(phone, new Map());
  return stores.get(phone);
}

export function getItem(key) {
  return current().get(key) ?? null;
}

export async function setItemAsync(key, value) {
  current().set(key, value);
}

export async function deleteItemAsync(key) {
  current().delete(key);
}
