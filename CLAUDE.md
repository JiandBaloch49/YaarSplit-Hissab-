# YaarSplit

A bill-splitting app for a friend group. Friends eat meals together (breakfast,
lunch, dinner), but not everyone is present at every meal. **Each expense is
split ONLY among the people who ate it** — never across the whole group.

## Stack

- React Native + Expo (SDK 57) — **JavaScript only, no TypeScript**
- `expo-sqlite` using the **sync API**: `openDatabaseSync`, `runSync`, `getAllSync`
- React Navigation **native-stack** for navigation (not Expo Router)
- `expo-crypto` for `randomUUID()`

Expo APIs change every SDK release. Before using any Expo API, check the docs for
this version: https://docs.expo.dev/versions/v57.0.0/ — don't rely on memory.

## Folder structure

```
src/
  db/          # SQLite setup, schema, and all queries
  logic/       # pure business logic (split.js lives here)
  screens/     # one file per screen
  components/  # reusable UI pieces
```

Keep each kind of code in its folder: screens don't run SQL directly, and
`src/logic` never imports from `src/db`, `src/screens`, or React.

## Data rules

- **Offline-first.** Everything saves to local SQLite first. The app must work
  fully with no internet.
- **Every table has these columns:**
  - `id` — TEXT UUID generated on the phone with `expo-crypto`'s `randomUUID()`
  - `created_at` — timestamp
  - `updated_at` — timestamp, set on every change
  - `deleted` — INTEGER 0/1 (soft delete)
  - `synced` — INTEGER 0/1 (set back to 0 whenever a row changes)
- **Never hard-delete rows.** No `DELETE FROM`. Set `deleted = 1` and update
  `updated_at`. Normal queries filter with `WHERE deleted = 0`.

## Money rules

- Amounts are **whole rupees stored as INTEGER**. Never use floats for money.
- When a split doesn't divide evenly, distribute the leftover rupees explicitly
  (e.g. one extra rupee to the first N people) so shares always add up exactly
  to the total.

## Split logic

- All split math lives in `src/logic/split.js` as **pure functions**: plain
  inputs in, plain outputs out. No DB calls, no UI code, no side effects.
- This keeps the math easy to read and test on its own.

## Commands

- Install packages with `npx expo install <package>` — **never** plain
  `npm install <package>` (it picks versions that may not match the SDK).
- Start the dev server: `npx expo start`
- Lint: `npx expo lint`
- Check config/dependency issues: `npx expo-doctor`

## Code style

- Keep code simple. Prefer plain, readable code over clever abstractions.
- Comment generously — the owner wants to understand every file. Each file
  should start with a short comment explaining what it's for, and non-obvious
  logic (especially split math and SQL) should be explained inline.
