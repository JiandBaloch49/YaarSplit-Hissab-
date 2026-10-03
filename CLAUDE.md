# YaarSplit

The app's name is **YaarSplit** (it used to be "Hisaab"). Use that spelling
in code, docs and commit messages.

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

## Accounts, groups and permissions (server)

The sync server lives in `server/` (Node + Express + MongoDB). **Every rule
below is checked on the server.** The app may check too, for nicer messages,
but the server never trusts it.

- **Accounts.** `POST /accounts` with a name and a unique username (like
  `@nisar`). It returns a device token; the server stores only its hash.
  No passwords yet.
- **Members vs accounts.** A group has member *slots* (e.g. "Nisar"). An
  account is linked to a slot only by accepting an invitation. There is no
  open "claim any member" flow.
- **Roles.** Each group has `admin`s (the creator starts as one) and
  `member`s. Only admins can invite, remove someone, make another admin,
  regenerate invite links and change group settings. A group always keeps
  at least one admin.
- **Invitations.** An admin invites by username, or makes a personal link.
  Each invite targets ONE member slot, expires after 7 days and works once.
  Accepting links the account to that member, including all past expenses.
  Invite and accept endpoints are rate limited.
- **Payments need confirming.** Status is `pending`, `confirmed`, `rejected`
  or `cancelled`.
  - The payer records a payment → `pending`.
  - Only the receiver (the `to_member`'s account) can confirm or reject.
    Only the payer can cancel.
  - A receiver recording "X paid me" is `confirmed` at once.
  - If the receiver has no account yet, only an admin can confirm or reject,
    saved as `confirmed_by: 'admin'`.
  - Payments store `created_at`, `confirmed_at`, `confirmed_by`.
  - **Only confirmed payments count** in balances (`computeBalances`).
  - Partial payments are fine: any whole-rupee amount above 0.
- **Expenses.** Only the expense's creator or an admin can edit or delete it.
  Every row records `created_by` and `updated_by` (member ids).
- **Settle-up.** Group setting `simplify_debts` (default on). On: the short
  simplified list (`settleUp`). Off: pairwise debts (`pairwiseDebts`), where
  each person pays back exactly who they owe.
- **Sync.** Every server write to group data (groups, members, expenses,
  payments) goes through `saveWithSeqs()` (one transaction, per-group seq
  numbers), and deletions stay soft so they sync.

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
