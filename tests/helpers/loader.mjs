// loader.mjs — lets Node run the app's database code in tests.
//
// Two problems, two fixes:
//   1. src/db imports 'expo-sqlite' and 'expo-crypto', which only work on a
//      phone. We point those imports at the stand-ins in this folder.
//   2. The app imports files without ".js" (e.g. './database'), which the
//      app's bundler allows but Node doesn't. We try adding ".js".
//
// This is a Node "resolve hook": Node asks it where each import lives.
// Registered by register.mjs (see the "test" script in package.json).

const STAND_INS = {
  'expo-sqlite': new URL('./expo-sqlite.mjs', import.meta.url).href,
  'expo-crypto': new URL('./expo-crypto.mjs', import.meta.url).href,
};

export async function resolve(specifier, context, nextResolve) {
  if (STAND_INS[specifier]) {
    return { url: STAND_INS[specifier], shortCircuit: true };
  }

  // A relative import with no extension: try the ".js" file first.
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  if (isRelative && !/\.[cm]?js$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.js`, context);
    } catch {
      // Not a .js file — fall through and let Node try it as written.
    }
  }

  return nextResolve(specifier, context);
}
