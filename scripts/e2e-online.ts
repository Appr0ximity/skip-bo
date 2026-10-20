/* End-to-end check of lobbies, moves, security rules and stats against the
 * Firebase emulators. Run:  npm run emulators  (in another terminal), then
 *   npx tsx scripts/e2e-online.ts */
process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "demo-api-key";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-skipbo";
process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = "demo-skipbo.firebaseapp.com";
process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-skipbo-default-rtdb";
process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS = "true";

async function main() {
  const { fb } = await import("../src/lib/firebase");
  const auth = await import("firebase/auth");
  const rtdb = await import("firebase/database");
  const rooms = await import("../src/lib/online/rooms");
  const store = await import("../src/lib/data/store");
  const chat = await import("../src/lib/online/chat");
  const { buildRecord } = await import("../src/lib/data/stats");
  const { nextMove } = await import("../src/lib/game/ai");
  type GameState = import("../src/lib/game/engine").GameState;

  const { auth: a, rtdb: db } = fb();
  const stamp = Date.now();
  const users: Record<string, { email: string; uid: string; name: string }> = {};
  for (const name of ["alice", "bob", "mallory"]) {
    const email = `${name}.${stamp}@example.test`;
    const cred = await auth.createUserWithEmailAndPassword(a, email, "test-pass-1");
    await auth.updateProfile(cred.user, { displayName: name });
    await store.ensureCloudProfile(cred.user.uid, name);
    users[name] = { email, uid: cred.user.uid, name };
  }
  const as = async (name: string) => {
    if (a.currentUser?.uid === users[name].uid) return;
    await auth.signInWithEmailAndPassword(a, users[name].email, "test-pass-1");
    // The database client picks up the new user's token asynchronously.
    await new Promise((r) => setTimeout(r, 400));
  };
  const acct = (n: string) => ({ uid: users[n].uid, name: n });
  const expectDenied = async (label: string, p: Promise<unknown>) => {
    try {
      await p;
      throw new Error(`EXPECTED DENIAL: ${label}`);
    } catch (e) {
      if ((e as Error).message.startsWith("EXPECTED")) throw e;
      console.log(`  ✓ denied: ${label}`);
    }
  };
  const roomVal = async (code: string) => (await rtdb.get(rtdb.ref(db, `rooms/${code}`))).val() as import("../src/lib/online/rooms").Room;

  await as("alice");
  const code = await rooms.createRoom(acct("alice"), { stockSize: 5 });
  console.log("room", code);

  await as("bob");
  await rooms.joinRoom(code, acct("bob"));
  await expectDenied("non-host changes settings", rooms.updateSettings(code, { stockSize: 9 }));
  await expectDenied("member edits another member", rtdb.set(rtdb.ref(db, `rooms/${code}/members/${users.alice.uid}/name`), "hacked"));
  await expectDenied("non-host starts game", rtdb.update(rtdb.ref(db, `rooms/${code}`), { status: "playing" }));

  await as("alice");
  await rooms.startOnlineGame(code, await roomVal(code));
  console.log("  ✓ host started game");

  await as("mallory");
  await expectDenied("joining a started game", rtdb.set(rtdb.ref(db, `rooms/${code}/members/${users.mallory.uid}`), { name: "mallory", joinedAt: Date.now() }));
  await expectDenied("non-member writes game", rtdb.set(rtdb.ref(db, `rooms/${code}/game/version`), 999));

  // Play the game out: each player moves on their own turn.
  let moves = 0, wrongTurnChecked = false;
  for (let i = 0; i < 5000; i++) {
    const room = await roomVal(code);
    const g = JSON.parse(room.game!.state) as GameState;
    if (g.winner != null) break;
    const p = g.players[g.current];
    const name = Object.keys(users).find((n) => users[n].uid === p.uid)!;
    if (!wrongTurnChecked) {
      const other = name === "alice" ? "bob" : "alice";
      await as(other);
      const ok = await rooms.submitMove(code, users[other].uid, nextMove(g, "medium"));
      if (ok) throw new Error("out-of-turn move was accepted");
      console.log("  ✓ rejected: move out of turn");
      wrongTurnChecked = true;
    }
    await as(name);
    const ok = await rooms.submitMove(code, users[name].uid, nextMove(g, "hard"));
    if (!ok) throw new Error(`legal move rejected for ${name}`);
    moves++;
  }
  const final = await roomVal(code);
  const g = JSON.parse(final.game!.state) as GameState;
  if (g.winner == null) throw new Error("game did not finish");
  console.log(`  ✓ game finished after ${moves} moves, version ${final.game!.version}; winner ${g.players[g.winner].name}`);

  // Each player records their own result — twice, to prove it's idempotent.
  for (const n of ["alice", "bob"]) {
    await as(n);
    const seat = g.players.findIndex((p) => p.uid === users[n].uid);
    const rec = buildRecord(g, seat);
    await store.recordGame(acct(n), rec);
    await store.recordGame(acct(n), rec);
    const prof = await store.loadProfile(acct(n));
    if (prof.stats.gamesPlayed !== 1 || prof.history.length !== 1) throw new Error(`stats wrong for ${n}: ${JSON.stringify(prof.stats)}`);
    console.log(`  ✓ ${n}: ${prof.stats.wins}W ${prof.stats.losses}L recorded once`);
  }
  await as("mallory");
  await expectDenied("writing someone else's stats", store.recordGame(acct("alice"), { ...buildRecord(g, 0), id: "forged" }));
  const board = await store.loadLeaderboard();
  console.log("  ✓ leaderboard:", board.filter((r) => [users.alice.uid, users.bob.uid].includes(r.uid)).map((r) => `${r.name} ${r.stats.wins}W`).join(", "));

  // Chat: members can talk (emoji included); nobody else can read, impersonate, edit or spam.
  await as("bob");
  await chat.sendChat(code, acct("bob"), "gg 🎉🔥 nice game");
  const msgs = await new Promise<import("../src/lib/online/chat").ChatMessage[]>((res) => {
    const stop = chat.subscribeChat(code, (m) => {
      stop();
      res(m);
    });
  });
  if (msgs.length !== 1 || msgs[0].text !== "gg 🎉🔥 nice game" || msgs[0].uid !== users.bob.uid) throw new Error("chat message wrong: " + JSON.stringify(msgs));
  console.log("  ✓ member posted a chat message with emoji");
  await expectDenied("chat message posing as someone else", Promise.resolve(rtdb.push(rtdb.ref(db, `chats/${code}`), { uid: users.alice.uid, name: "alice", text: "fake", ts: Date.now() })));
  await expectDenied("editing a chat message", rtdb.set(rtdb.ref(db, `chats/${code}/${msgs[0].id}/text`), "edited"));
  await expectDenied("chat message over 300 characters", Promise.resolve(rtdb.push(rtdb.ref(db, `chats/${code}`), { uid: users.bob.uid, name: "bob", text: "x".repeat(301), ts: Date.now() })));
  await as("mallory");
  await expectDenied("non-member reading chat", rtdb.get(rtdb.ref(db, `chats/${code}`)));
  await expectDenied("non-member posting chat", Promise.resolve(rtdb.push(rtdb.ref(db, `chats/${code}`), { uid: users.mallory.uid, name: "mallory", text: "hi", ts: Date.now() })));

  // Second round: bob leaves mid-game, so alice (the only one left) wins.
  await as("alice");
  await rooms.backToLobby(code);
  await rooms.startOnlineGame(code, await roomVal(code));
  await as("bob");
  await rooms.removeFromGame(code, (JSON.parse((await roomVal(code)).game!.state) as GameState).players.findIndex((p) => p.uid === users.bob.uid), "left the game");
  const g2 = JSON.parse((await roomVal(code)).game!.state) as GameState;
  if (g2.winner == null || g2.players[g2.winner].uid !== users.alice.uid) throw new Error("leaver's opponent did not win");
  console.log("  ✓ when bob left, alice won by default");

  // Host returns everyone to the lobby, then both leave; the room is deleted.
  await as("alice");
  await rooms.backToLobby(code);
  await rooms.leaveRoom(code, users.alice.uid);
  const afterHost = await roomVal(code);
  if (afterHost.hostUid !== users.bob.uid) throw new Error("host was not transferred");
  console.log("  ✓ host role passed to bob");
  await as("bob");
  await rooms.leaveRoom(code, users.bob.uid);
  if (await roomVal(code)) throw new Error("room not removed");
  console.log("  ✓ empty room removed");
  // Read with emulator admin access (members can no longer read it once the room is gone).
  const leftover = await fetch(`http://127.0.0.1:9000/chats/${code}.json?ns=demo-skipbo-default-rtdb`, { headers: { Authorization: "Bearer owner" } }).then((r) => r.json());
  if (leftover !== null) throw new Error("chat not removed with the room");
  console.log("  ✓ its chat was deleted too");
  console.log("ALL CHECKS PASSED");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

export {};
