"use client";

/* Online lobbies in the Realtime Database.
 *
 *   rooms/{code}: { hostUid, status: 'waiting'|'playing', createdAt, settings,
 *                   members/{uid}: { name, joinedAt, online },
 *                   game: { state: <GameState JSON>, version } }
 *
 * Every move runs in a transaction against the latest state, so two clients can
 * never apply conflicting moves. Bots are driven by one connected human's browser. */

import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
  type Unsubscribe,
} from "firebase/database";
import { fb } from "../firebase";
import { addLog, applyMove, createGame, isBotSeat, shuffle, type Difficulty, type GameState, type Move } from "../game/engine";
import { nextMove } from "../game/ai";
import type { Account } from "../data/store";

export const MAX_SEATS = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const BOT_NAMES = ["Ada", "Bruno", "Cleo", "Dmitri", "Esme", "Felix", "Greta", "Hugo"];

export interface RoomSettings {
  stockSize: number;
  bots: number;
  botDifficulty: Difficulty;
}

export interface Member {
  name: string;
  joinedAt: number;
  online?: boolean;
}

export interface Room {
  hostUid: string;
  status: "waiting" | "playing";
  createdAt: number;
  settings: RoomSettings;
  members?: Record<string, Member>;
  game?: { state: string; version: number } | null;
}

const roomRef = (code: string) => ref(fb().rtdb, `rooms/${code}`);

export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

function randomCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function sortedMembers(room: Room): [string, Member][] {
  return Object.entries(room.members ?? {}).sort((a, b) => a[1].joinedAt - b[1].joinedAt);
}

export async function createRoom(a: Account, settings: RoomSettings): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const now = Date.now();
    const res = await runTransaction(roomRef(code), (cur) => {
      if (cur !== null) return; // code taken — abort and try another
      const room: Room = {
        hostUid: a.uid,
        status: "waiting",
        createdAt: now,
        settings,
        members: { [a.uid]: { name: a.name, joinedAt: now, online: true } },
      };
      return room;
    });
    if (res.committed) return code;
  }
  throw new Error("Could not create a lobby. Try again.");
}

export async function joinRoom(code: string, a: Account): Promise<void> {
  const snap = await get(roomRef(code));
  if (!snap.exists()) throw new Error(`No lobby with code ${code}.`);
  const room = snap.val() as Room;
  const me = room.members?.[a.uid];
  if (me) {
    if (me.name !== a.name) await update(ref(fb().rtdb, `rooms/${code}/members/${a.uid}`), { name: a.name });
    return;
  }
  if (room.status !== "waiting") throw new Error("That game has already started.");
  const humans = Object.keys(room.members ?? {}).length;
  if (humans + room.settings.bots >= MAX_SEATS) throw new Error("That lobby is full.");
  await set(ref(fb().rtdb, `rooms/${code}/members/${a.uid}`), { name: a.name, joinedAt: Date.now(), online: true });
}

/** Keeps members/{uid}/online accurate, including when the tab closes or the network drops. */
export function trackPresence(code: string, uid: string): Unsubscribe {
  const { rtdb } = fb();
  const onlineRef = ref(rtdb, `rooms/${code}/members/${uid}/online`);
  const memberRef = ref(rtdb, `rooms/${code}/members/${uid}`);
  const stop = onValue(ref(rtdb, ".info/connected"), async (snap) => {
    if (!snap.val()) return;
    const m = await get(memberRef);
    if (!m.exists()) return;
    await onDisconnect(onlineRef).set(false);
    await set(onlineRef, true).catch(() => {});
  });
  return () => {
    stop();
    onDisconnect(onlineRef).cancel().catch(() => {});
    get(memberRef)
      .then((m) => {
        if (m.exists()) return set(onlineRef, false);
      })
      .catch(() => {});
  };
}

export function subscribeRoom(code: string, cb: (room: Room | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onValue(roomRef(code), (snap) => cb(snap.exists() ? (snap.val() as Room) : null), onError);
}

/** Writes only the changed fields, so quick successive edits can't overwrite each other. */
export async function updateSettings(code: string, patch: Partial<RoomSettings>) {
  await update(ref(fb().rtdb, `rooms/${code}/settings`), patch);
}

export async function startOnlineGame(code: string, room: Room): Promise<void> {
  const humans = sortedMembers(room);
  const bots = Math.min(room.settings.bots, MAX_SEATS - humans.length);
  if (humans.length + bots < 2) throw new Error("Need at least 2 players — invite a friend or add a bot.");
  const names = shuffle(BOT_NAMES.filter((n) => !humans.some(([, m]) => m.name === n)));
  const g = createGame({
    stockSize: room.settings.stockSize,
    players: [
      ...humans.map(([uid, m]) => ({ name: m.name, isHuman: true, uid })),
      ...Array.from({ length: bots }, (_, i) => ({ name: `${names[i]} (bot)`, isHuman: false, difficulty: room.settings.botDifficulty })),
    ],
  });
  await update(roomRef(code), { status: "playing", game: { state: JSON.stringify(g), version: 1 } });
}

export async function backToLobby(code: string) {
  await update(roomRef(code), { status: "waiting", game: null });
}

/** Apply `fn` to the latest game state atomically. `fn` returns false to abort. */
async function mutateGame(code: string, fn: (g: GameState) => boolean): Promise<boolean> {
  const res = await runTransaction(ref(fb().rtdb, `rooms/${code}/game`), (cur: { state: string; version: number } | null) => {
    if (!cur) return cur; // cache not loaded yet — the server will re-run us with real data
    const g = JSON.parse(cur.state) as GameState;
    if (!fn(g)) return; // abort
    return { state: JSON.stringify(g), version: cur.version + 1 };
  });
  return res.committed && res.snapshot.exists();
}

export function submitMove(code: string, uid: string, mv: Move): Promise<boolean> {
  return mutateGame(code, (g) => {
    const p = g.players[g.current];
    if (g.winner != null || p.uid !== uid || p.left) return false;
    return applyMove(g, mv);
  });
}

/** One bot move (bots and seats of players who left). */
export function botStep(code: string): Promise<boolean> {
  return mutateGame(code, (g) => {
    const p = g.players[g.current];
    if (g.winner != null || !isBotSeat(p)) return false;
    const mv = nextMove(g, p.difficulty ?? "medium");
    if (applyMove(g, mv)) return true;
    // Should not happen; never let the game stall.
    return p.hand.length ? applyMove(g, { type: "discard", hand: 0, pile: 0 }) : applyMove(g, { type: "end" });
  });
}

/** Hand a seat to a bot — used when a player leaves or stays disconnected. */
export function botTakeover(code: string, seat: number, reason: string): Promise<boolean> {
  return mutateGame(code, (g) => {
    const p = g.players[seat];
    if (!p || !p.isHuman || p.left || g.winner != null) return false;
    p.left = true;
    p.difficulty = "medium";
    addLog(g, seat, `${p.name} ${reason} — a bot plays their seat.`);
    return true;
  });
}

/** Leave the lobby. The host role passes to the longest-waiting member; the last one out deletes the room. */
export async function leaveRoom(code: string, uid: string): Promise<void> {
  const snap = await get(roomRef(code));
  if (!snap.exists()) return;
  const room = snap.val() as Room;
  if (room.status === "playing" && room.game) {
    const g = JSON.parse(room.game.state) as GameState;
    const seat = g.players.findIndex((p) => p.uid === uid);
    if (seat >= 0 && g.winner == null) await botTakeover(code, seat, "left the game");
  }
  const others = sortedMembers(room).filter(([id]) => id !== uid);
  if (room.hostUid === uid) {
    if (others.length) await update(roomRef(code), { hostUid: others[0][0], [`members/${uid}`]: null });
    else await remove(roomRef(code));
  } else {
    await remove(ref(fb().rtdb, `rooms/${code}/members/${uid}`));
  }
}

/** The connected human (lowest seat) whose browser runs the bots. */
export function botDriver(g: GameState, room: Room, myUid: string): string | null {
  for (const p of g.players) {
    if (!p.isHuman || p.left || !p.uid) continue;
    const m = room.members?.[p.uid];
    if (p.uid === myUid || m?.online) return p.uid;
  }
  return null;
}
