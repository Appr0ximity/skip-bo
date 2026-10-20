/* Dev helper: a second player for testing lobbies locally against the emulators.
 *   npx tsx scripts/fake-friend.ts <LOBBY_CODE> [name] [ms-between-moves]
 * Joins the lobby, stays online, and plays its own turns automatically. */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "demo-api-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-skipbo";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "demo-skipbo.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-skipbo-default-rtdb";
process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";

async function main() {
  const code = (process.argv[2] ?? "").toUpperCase();
  const name = process.argv[3] ?? "Robin";
  const delay = Number(process.argv[4] ?? 600);
  if (!code) throw new Error("usage: fake-friend.ts <CODE> [name]");
  const { fb } = await import("../src/lib/firebase");
  const auth = await import("firebase/auth");
  const rooms = await import("../src/lib/online/rooms");
  const store = await import("../src/lib/data/store");
  const { buildRecord } = await import("../src/lib/data/stats");
  const { nextMove } = await import("../src/lib/game/ai");
  type GameState = import("../src/lib/game/engine").GameState;

  const email = `${name.toLowerCase()}.${Date.now()}@example.test`;
  const cred = await auth.createUserWithEmailAndPassword(fb().auth, email, "test-pass-1");
  const uid = cred.user.uid;
  await store.ensureCloudProfile(uid, name);
  const acct = { uid, name };
  await rooms.joinRoom(code, acct);
  rooms.trackPresence(code, uid);
  console.log(`${name} joined ${code}`);

  let latest: import("../src/lib/online/rooms").Room | null = null;
  const recorded = new Set<string>();
  rooms.subscribeRoom(
    code,
    (room) => {
      if (!room) {
        console.log("room closed");
        process.exit(0);
      }
      latest = room;
    },
    (e) => console.error(e),
  );

  // Act on the latest state at a human-ish pace.
  for (;;) {
    await new Promise((r) => setTimeout(r, delay));
    const room = latest as import("../src/lib/online/rooms").Room | null;
    if (!room || room.status !== "playing" || !room.game) continue;
    const g = JSON.parse(room.game.state) as GameState;
    const seat = g.players.findIndex((p) => p.uid === uid);
    if (seat < 0) continue;
    if (g.winner != null) {
      if (!recorded.has(g.id)) {
        recorded.add(g.id);
        await store.recordGame(acct, buildRecord(g, seat));
        console.log(`game over — winner ${g.players[g.winner].name}`);
      }
      continue;
    }
    if (g.current === seat) await rooms.submitMove(code, uid, nextMove(g, "medium")).catch((e) => console.error(e));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export {};
