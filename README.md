# Skip-Bo Online

Skip-Bo in the browser for 2–6 friends: create a lobby, share the invite link, and play live. Accounts, stats and history sync across devices.

- **Next.js 16 + Tailwind CSS 4**, exported as a fully static site (`out/`) — no server to run or pay for.
- **Firebase (free Spark plan)**
  - **Auth** — players sign in with a **username + 4-digit PIN** (see *Accounts* below).
  - **Firestore** — profiles, stats, game history, leaderboard.
  - **Realtime Database** — live lobbies and games (moves are transactions, so players can't clash).

## Project layout

```
src/lib/game/engine.ts     rules engine (pure functions over JSON state)
src/lib/game/ai.ts         move suggestions for the Hint button
src/lib/data/              stats math + Firestore / localStorage storage
src/lib/online/rooms.ts    lobbies, presence, moves, leaving (Realtime Database)
src/components/            GameBoard, cards, dashboard, sign-in screen
src/app/                   routes: /  (home)  /room/?code=XXXXX  (lobby + game)
firestore.rules            who may read/write profiles and history
database.rules.json        who may create/join lobbies and write game state
scripts/                   emulator test + a scripted "friend" for local testing
legacy-static/             the original plain HTML/JS version (safe to delete)
```

## Run locally (no Firebase project needed)

Everything runs against the Firebase emulators. Java 11+ is required for them.

```bash
npm install
npm run emulators      # terminal 1 — auth, Firestore, Realtime DB (UI at http://localhost:4000)
npm run dev            # terminal 2 — http://localhost:3000
```

`.env.development` points `npm run dev` at the emulators (`demo-skipbo` project). Emulator data is wiped when they stop.

Testing helpers:

```bash
npm run test:online                          # full lobby/game/rules/stats check against the emulators
npx tsx scripts/fake-friend.ts ABCDE Robin   # a second player joins lobby ABCDE and plays its own turns
```

## Go live on Firebase (free)

1. **Create the project** — [console.firebase.google.com](https://console.firebase.google.com) → *Add project*. You stay on the free **Spark** plan; no credit card is needed. Analytics is optional.
2. **Authentication** → *Get started* → *Sign-in method*: enable **Email/Password** only (first toggle; leave "Email link" off). Don't add Google or any other provider — usernames + PINs run on top of Email/Password.
3. **Firestore Database** → *Create database* → *Start in production mode* → pick a location near your players.
4. **Realtime Database** → *Create database* → same region if offered → *Start in locked mode*.
5. **Register the web app** — *Project settings* (gear) → *Your apps* → the `</>` icon → register (no need to tick Hosting here). Copy the config values.
6. **Production env file** — create `.env.production.local` (used by `next build`; git-ignored):

   ```bash
   NEXT_PUBLIC_FIREBASE_API_KEY=...
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project
   NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
   NEXT_PUBLIC_FIREBASE_APP_ID=...
   NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
   ```

   The database URL is shown at the top of the Realtime Database page (some regions use `*.firebasedatabase.app`). These values are public identifiers, not secrets — the rules files protect the data.
7. **Deploy** (builds the site, uploads it to Firebase Hosting, and publishes both rules files):

   ```bash
   npx firebase login
   npx firebase use --add          # pick your project
   npm run deploy
   ```

   Your site is live at `https://your-project.web.app`. Hosting is free up to 10 GB storage / 360 MB per day of transfer.

If you host somewhere else (GitHub Pages, Netlify, Vercel), upload `out/` and add that domain under *Authentication → Settings → Authorized domains*. Still publish the rules with `npx firebase deploy --only firestore:rules,database`.

## Free-plan limits (Spark)

| Service | Limit | What it means here |
|---|---|---|
| Realtime Database | 100 simultaneous connections, 1 GB stored, 10 GB/month download | ~100 players online at once |
| Firestore | 1 GiB stored, 50k reads + 20k writes per day | a game end costs ~2 writes per player; opening the dashboard ~45 reads |
| Auth | free for email/password sign-in | usernames + PINs use this |

Hitting a limit pauses that service until it resets — it never starts charging you. Check the current numbers on Firebase's pricing page.

## Accounts: username + 4-digit PIN

Firebase's free sign-in only supports email + password (6+ characters), so the app maps:

- **username → internal address** `username@users.skipbo.local` (lower-cased, so login is case-insensitive). It's never shown and never receives mail.
- **PIN → internal password** `skipbo-pin-1234`.

Consequences:

- **Don't change either mapping** in `src/context/AccountProvider.tsx` once real players exist — their logins would stop working.
- **No PIN reset.** There's no real email to send a reset to. If someone forgets their PIN, delete them in the Firebase console (*Authentication → Users*, search for `name@users.skipbo.local`) and they can sign up again — their old stats are lost.
- **Usernames can't be renamed** (the username is the login).
- **A 4-digit PIN is weak** (10,000 combinations). Firebase temporarily blocks repeated wrong attempts, which is reasonable for a game among friends — players shouldn't reuse an important PIN.

## Known trade-offs

- **Rules run in players' browsers.** The database rules stop obvious abuse (writing someone else's stats, acting in a lobby you're not in, joining a started game, non-hosts changing settings), but a determined player using developer tools could peek at hidden cards or forge their own stats. Fine for friends; a cheat-proof version would need server-side code (Cloud Functions, paid plan).
- **Leaving:** a player who leaves forfeits, and their turns are skipped. If only one player is left, they win.
- **Disconnected players** show as offline. The game waits on their turn; anyone in the game can remove them, which counts as a forfeit for them.
- **Empty lobbies** are deleted when the last player leaves. Lobbies abandoned by closed tabs stay in the database (they are tiny).
