# YaarSplit server

The sync backend for YaarSplit: **Node + Express + MongoDB (Mongoose)**.
It lives in its own folder and has its own `package.json`; it is not part of
the Expo app.

The app still works fully offline. This server is only where groups are
shared so friends' phones can join them.

## Files

```
server/
  src/
    index.js        starts the real server (connects to MongoDB, listens)
    app.js          all the endpoints
    models.js       the MongoDB collections
    seq.js          hands out the increasing "seq" numbers
    auth.js         device tokens (making and checking them)
    validate.js     checks uploaded data before saving it
    logic/split.js  EXACT copy of the app's src/logic/split.js
  tests/            tests, run against an in-memory MongoDB
  .env.example      the settings you need (copy to .env; never commit .env)
```

## How the data is stored

Collections: `groups`, `members`, `expenses`, `payments` (same fields as the
app's tables) plus `devices` and `counters`.

- `_id` is the app's own UUID, so a row has the same id on every phone and
  on the server.
- `seq` is a number the server gives each document every time it's saved.
  It only goes up. A phone that has seen up to seq 120 asks for "changes
  after 120".
- `created_at`, `updated_at`, `deleted` work exactly as in the app. Nothing
  is ever really deleted.
- `payers` / `participants` are real arrays here, not JSON text.
- `devices` stores a **hash** of each phone's token, never the token itself.

## Endpoints

| Method | Path | Token? | What it does |
|---|---|---|---|
| GET | `/` | no | Health check → `{ ok: true }` |
| POST | `/groups` | no | Upload a group from a phone → `{ invite_code: "YAR-1234", group_id }` |
| POST | `/join` | no | `{ invite_code }` → `{ group, members }` (live members, each with `claimed`) |
| POST | `/claim` | no | `{ invite_code, member_id }` → `{ token, device_id, group_id, member_id }` |
| GET | `/groups/:groupId/changes?since=N` | **yes** | Everything in the group saved after seq N → `{ group, members, expenses, payments, last_seq }` |

A request that needs a token sends it as a header:

```
Authorization: Bearer <token>
```

The server checks that the token belongs to a device **in that group**:
no or unknown token → 401, a token for a different group → 403.

`POST /groups` body (deleted rows included, so deletions travel too):

```json
{
  "group":    { "id": "...", "name": "Trip", "fund_holder_id": null,
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

- Invite codes have only 10,000 possibilities (`YAR-0000` to `YAR-9999`).
  Anyone who guesses a live code can join that group. That's fine for a
  friend group, but before sharing the app widely, add rate limiting to
  `/join` and `/claim` or use longer codes.
- There are no endpoints yet for sending changes made AFTER the first upload
  (new expenses, edits, deletions). That's the sync phase. It will use `seq`
  and the device token the same way `/changes` does.
- A member can be claimed by more than one phone (new phone, reinstall),
  and old tokens keep working. There's no "log this phone out" yet.
