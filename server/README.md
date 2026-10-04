# YaarSplit server

The sync backend for YaarSplit: **Node + Express + MongoDB (Mongoose)**.
It lives in its own folder and has its own `package.json`; it is not part of
the Expo app.

The app still works fully offline. This server is where groups are shared,
friends are invited, and the group's rules (who may change what) are
enforced.

## Files

```
server/
  src/
    index.js        starts the real server (connects to MongoDB, listens)
    app.js          builds the app from the route files below
    routes/
      accounts.js   sign up, GET /me, GET /me/invites, username search
      groups.js     upload, /changes, settings, admin roles, settle-up, history
      invites.js    inviting by username or link, accepting, declining,
                    cancelling, and the /join page shared links open
      expenses.js   add / edit / delete expenses
      payments.js   record / confirm / reject / cancel payments
    models.js       the MongoDB collections
    seq.js          hands out "seq" numbers and saves rows with them atomically
    auth.js         device tokens; "are you in this group / an admin?"
    rateLimit.js    "max 10 tries a minute" for sign-ups and invites
    validate.js     checks data from phones before saving it
    groupData.js    small read helpers the routes share
    errors.js       HttpError: refuse a request with a status code
    logic/split.js  EXACT copy of the app's src/logic/split.js
  tests/            tests, run against an in-memory MongoDB
  .env.example      the settings you need (copy to .env; never commit .env)
```

## How the data is stored

Group data (`groups`, `members`, `expenses`, `payments`) has the same
fields as the app's tables, plus a few server-side ones, and it syncs to
phones. The server also has its own collections: `accounts`, `devices`,
`invites` and `counters`.

- `_id` is the app's own UUID, so a row has the same id on every phone and
  on the server.
- `seq` is a number the server gives each group document every time it's
  saved. Each group counts on its own (1, 2, 3, ...) and it only goes up. A
  phone that has seen up to seq 120 asks for "changes after 120".
- Seq numbers are handed out and the documents saved **in one MongoDB
  transaction**, so a phone can never see seq 6 while seq 5 is still being
  saved (and then skip 5 forever). `src/seq.js` explains this in detail.
  Transactions need a replica set: Atlas always is one, and the tests start
  an in-memory one. **Every write to group data goes through
  `saveWithSeqs()`.**
- `created_at`, `updated_at`, `deleted` work exactly as in the app. Nothing
  is ever really deleted.
- `created_by` / `updated_by` are member ids: who made the row, and who
  changed it last.
- `payers` / `participants` are real arrays here, not JSON text.
- `members` also have `account_id` and `username` (both null until someone
  accepts an invite for that slot) and `role` (`admin` or `member`).
- `payments` also have `status`, `confirmed_at` and `confirmed_by`
  (`receiver` or `admin`).
- `groups` also have `simplify_debts` (1 = on, the default).
- `devices` stores a **hash** of each phone's token, never the token itself.
  `invites` stores only a hash of a link's secret code.

## Accounts, roles and the rules

The server checks every one of these. The app may check them too, but the
server never relies on that:

- **Accounts:** a name and a unique username (`@nisar`). No passwords yet;
  the phone keeps the token it got at sign-up.
- **Joining a group:** only by accepting an invitation. Each invite is for
  ONE member slot ("join as Nisar"), expires after 7 days and works once.
  Accepting links the account to that member, with all its past expenses.
- **Admins** (the creator, at first) can invite, remove someone, make
  another admin, regenerate invite links and change settings. A group
  always keeps at least one admin.
- **Expenses:** any member can add one. Only its creator or an admin can
  edit or delete it.
- **Payments:**
  - The payer records one → `pending`. It doesn't count yet.
  - Only the receiver can confirm or reject it. Only the payer can cancel.
  - The receiver recording "X paid me" → `confirmed` at once.
  - If the receiver has no account yet, only an admin can confirm or reject
    (saved as `confirmed_by: "admin"`).
  - Only `confirmed` payments count in balances. Any amount above 0 is
    fine (partial payments).

## Endpoints

"token" = send `Authorization: Bearer <token>`. "member" = your account must
be in the group. "admin" = and be an admin there.

| Method | Path | Who | What it does |
|---|---|---|---|
| GET | `/` | anyone | Health check → `{ ok: true }` |
| POST | `/accounts` | anyone | `{ name, username }` → `{ account, token, device_id }` |
| GET | `/me` | token | `{ account, groups: [{ group_id, name, member_id, role }] }` |
| GET | `/me/invites` | token | Pending invites to my username |
| GET | `/accounts/search?q=nis` | token | Up to 10 accounts whose username starts with `q` (2+ characters) → `{ accounts }` |
| POST | `/groups` | token | Upload a group (body below); I become its admin → `{ group_id }` |
| GET | `/groups/:groupId/changes?since=N&limit=M` | member | Up to M documents (default 500, max 1000) saved after seq N → `{ group, members, expenses, payments, last_seq, has_more }` |
| PATCH | `/groups/:groupId/settings` | admin | `{ simplify_debts: true/false }` |
| POST | `/groups/:groupId/members/:memberId/make-admin` | admin | Make a member (who has an account) an admin |
| POST | `/groups/:groupId/members/:memberId/remove` | admin | Unlink that person's account (the slot and its history stay) |
| GET | `/groups/:groupId/settle-up` | member | `{ simplify_debts, balances, transfers }`: simplified or pairwise, per the setting |
| GET | `/groups/:groupId/history/:aId/:bId` | member | Every expense and payment between two members, with what's left after each |
| POST | `/groups/:groupId/invites` | admin | `{ member_id, username }`, or `{ member_id }` for a link → `{ invite, code? }` |
| GET | `/groups/:groupId/invites` | admin | Pending invites (with the invited `username`) |
| POST | `/invites/:inviteId/regenerate` | admin | New code for a link invite (the old one stops working) → `{ invite, code }` |
| POST | `/invites/:inviteId/revoke` | admin | Cancel a pending invite → `{ invite }` |
| GET | `/invites/:inviteId?code=...` | token | Look at an invite before answering: group name, its members' names, who invited you |
| POST | `/invites/:inviteId/accept` | token | `{ code }` for links → `{ group_id, member }` |
| POST | `/invites/:inviteId/decline` | token | `{ code }` for links |
| GET | `/join/:inviteId#<code>` | anyone | The web page a shared invite link opens; it hands over to the app (`yaarsplit://invite/...`). The code after `#` never reaches the server. |
| POST | `/groups/:groupId/expenses` | member | `{ id, amount, category, split_type, payers, participants, ... }` |
| PUT | `/groups/:groupId/expenses/:expenseId` | creator or admin | Edit (checked like a new one) |
| DELETE | `/groups/:groupId/expenses/:expenseId` | creator or admin | Soft delete (`deleted: 1`) |
| POST | `/groups/:groupId/payments` | payer or receiver | `{ id, from_member_id, to_member_id, amount, type? }` |
| POST | `/groups/:groupId/payments/:paymentId/confirm` | receiver (admin if no account) | → `confirmed` |
| POST | `/groups/:groupId/payments/:paymentId/reject` | receiver (admin if no account) | → `rejected` |
| POST | `/groups/:groupId/payments/:paymentId/cancel` | payer | → `cancelled` |

Status codes: `400` bad data, `401` no/unknown token, `403` not allowed,
`404` not found, `409` conflict (already used, already answered, slot
taken...), `410` invite expired, `429` too many tries.

**Invite links:** the code is 43 random characters. It's shown only when
the invite is made or regenerated (the server keeps just its hash). The app
builds the link from the invite id and the code.

**Rate limiting:** sign-ups (per IP), making invites, and looking at /
accepting / declining invites (per account) each allow 10 requests a minute.
Username search allows 60 a minute per account (the app searches as you type).
More get `429` with a `Retry-After` header (seconds). On Render the phone's
real IP comes from the `X-Forwarded-For` header (the app trusts one proxy
hop). If friends ever get "Too many tries" without trying much, the IP being
seen is probably Render's, not theirs: check `trust proxy` in `app.js`.

**Pulling changes:** `/changes` includes deleted rows (`deleted: 1`), so
deletions reach every phone. Keep asking with `since=last_seq` while
`has_more` is `true`. When someone joins, becomes an admin or is removed,
that arrives as a change to their member row.

`POST /groups` body (deleted rows included, so deletions travel too):

```json
{
  "my_member_id": "...",
  "group":    { "id": "...", "name": "Trip", "fund_holder_id": null, "simplify_debts": 1,
                "created_at": 1759200000000, "updated_at": 1759200000000, "deleted": 0 },
  "members":  [{ "id": "...", "group_id": "...", "name": "Ali", "created_at": ..., "updated_at": ..., "deleted": 0 }],
  "expenses": [{ "id": "...", "group_id": "...", "description": "Dinner", "amount": 1000,
                 "category": "food", "split_type": "equal",
                 "payers": [{ "member_id": "...", "amount": 1000 }],
                 "participants": [{ "member_id": "...", "share": 334 }, ...],
                 "from_fund": 0, "created_at": ..., "updated_at": ..., "deleted": 0 }],
  "payments": [{ "id": "...", "group_id": "...", "from_member_id": "...", "to_member_id": "...",
                 "amount": 200, "type": "settlement", "created_at": ..., "updated_at": ..., "deleted": 0 }]
}
```

`my_member_id` is the uploader's own member slot. It's linked to their
account and becomes the admin. Uploaded payments are saved as confirmed by
the admin, because they happened before anyone had an account to confirm
them.

Every expense goes through the app's own `prepareExpense()` (from the copied
`split.js`). If anything is wrong the whole upload is refused with a 400 and a
list of messages, and nothing is saved.

## Keeping split.js in sync

`server/src/logic/split.js` must stay identical to the app's
`src/logic/split.js`. A test fails if they differ. After changing the app's
money rules, copy the file over (from the repo root):

```bash
cp src/logic/split.js server/src/logic/split.js
```

## Running it on your computer

```bash
cd server
npm install
npm test          # uses an in-memory MongoDB, no setup needed
```

The first `npm test` downloads a MongoDB program for the in-memory database,
so it takes a minute; after that it's quick.

To run the real server locally, copy `.env.example` to `.env`, put your Atlas
connection string in it, then:

```bash
npm run dev       # restarts itself when you edit a file
```

Open http://localhost:3000 and you should see `{"ok":true,...}`.

Packages here are installed with plain `npm install` (this is a normal Node
project). `npx expo install` is only for the app in the repo root.

## Deploying (free): MongoDB Atlas + Render

### 1. Create the database (MongoDB Atlas)

1. Sign up at https://www.mongodb.com/cloud/atlas/register.
2. **Create a cluster** → choose the **free** tier (M0). Pick a region close
   to your friends (e.g. Mumbai). Name it anything, e.g. `Cluster0`.
3. **Database Access** → **Add New Database User**. Username e.g.
   `yaarsplit-app`, click **Autogenerate Secure Password** and copy the
   password somewhere safe. Role: **Read and write to any database**.
4. **Network Access** → **Add IP Address** → **Allow access from anywhere**
   (`0.0.0.0/0`). Render's free servers don't have a fixed IP address, so
   this is needed; the database password still protects it.
5. **Database** → **Connect** → **Drivers**. Copy the connection string. It
   looks like
   `mongodb+srv://yaarsplit-app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Replace `<password>` with the real password, and add the database name
   `yaarsplit` after `.net/`:
   `mongodb+srv://yaarsplit-app:PASSWORD@cluster0.xxxxx.mongodb.net/yaarsplit?retryWrites=true&w=majority`
   This full string is your **MONGODB_URI**. It's a secret: never commit it
   or paste it into code.

### 2. Put the code on GitHub

Render deploys from a GitHub repo. Push this repo (with the `server/` folder)
to GitHub. `.env` is in `server/.gitignore`, so your secret stays local.

### 3. Create the web service (Render)

1. Sign up at https://render.com (signing in with GitHub is easiest).
2. **New** → **Web Service** → pick this repository.
3. Fill in:
   - **Name:** `yaarsplit-server` (becomes part of the URL)
   - **Branch:** the branch you push to (e.g. `main`)
   - **Root Directory:** `server`  ← important, the app is in the same repo
   - **Runtime / Language:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment Variables** → add `MONGODB_URI` = the string from step 1.6.
   Don't add `PORT`; Render sets it itself.
5. **Advanced** → **Health Check Path:** `/`
6. Click **Create Web Service**. Watch the logs until you see
   `Connected to MongoDB` and `YaarSplit server listening`.
7. Open `https://yaarsplit-server.onrender.com/` (your URL is shown at the top
   of the Render page). You should see `{"ok":true,"name":"YaarSplit server"}`.

That URL is what the app will talk to in the next phase.

### Things to know about the free tiers

- **Render free sleeps** after about 15 minutes with no requests. The next
  request wakes it, which takes up to a minute. The app should show a
  "Connecting..." message and retry, rather than treating it as an error.
- **Atlas free** gives 512 MB, which is a lot of expenses for a friend group.
- Every push to the branch redeploys automatically. Pushes that only change
  files outside `server/` don't redeploy it.

## Known limits (for later phases)

- The rate limits are kept in the server's memory. That's fine while there's
  one server; they reset when Render restarts it.
- No passwords and no "log this phone out" yet. A phone that loses its token
  can't get back into that account.
- Usernames can't be changed yet (members keep a copy of the username).
- After the upload, members can't be added and group/member names can't be
  edited through the API yet. Only expenses, payments, settings and roles
  can be changed.
- The app screens for all of this come in phase 6b.
