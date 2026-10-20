"use client";

/* Profile, stats and history storage in Firestore:
 *   users/{uid}  and  users/{uid}/games/{gameId}
 * Only an unfinished solo game is kept in this browser's localStorage. */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { fb } from "../firebase";
import { applyRecord, emptyStats, normalizeStats, type GameRecord, type UserStats } from "./stats";
import type { GameState } from "../game/engine";

export interface Account {
  uid: string;
  name: string;
}

export interface Prefs {
  stockSize: number;
  opponents: number;
  difficulty: "easy" | "medium" | "hard";
  speed: "slow" | "normal" | "fast";
}
export const DEFAULT_PREFS: Prefs = { stockSize: 30, opponents: 1, difficulty: "medium", speed: "normal" };

export interface LeaderRow {
  uid: string;
  name: string;
  stats: UserStats;
}

/* ---------- localStorage helpers ---------- */

function lsGet<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v == null ? d : (JSON.parse(v) as T);
  } catch {
    return d;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
}
function lsDel(k: string) {
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/* ---------- profile ---------- */

export async function ensureCloudProfile(uid: string, fallbackName: string): Promise<{ name: string }> {
  const { db } = fb();
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return { name: (snap.data().name as string) || fallbackName };
  const name = fallbackName.slice(0, 30) || "Player";
  await setDoc(ref, { name, createdAt: serverTimestamp(), stats: emptyStats(), prefs: DEFAULT_PREFS });
  return { name };
}

export async function renameAccount(a: Account, name: string) {
  const clean = name.trim().slice(0, 30);
  if (!clean) throw new Error("Name cannot be empty.");
  const { db } = fb();
  await setDoc(doc(db, "users", a.uid), { name: clean }, { merge: true });
  return clean;
}

/* ---------- stats / history ---------- */

export async function loadProfile(a: Account): Promise<{ stats: UserStats; history: GameRecord[]; prefs: Prefs }> {
  const { db } = fb();
  const [snap, games] = await Promise.all([
    getDoc(doc(db, "users", a.uid)),
    getDocs(query(collection(db, "users", a.uid, "games"), orderBy("date", "desc"), limit(20))),
  ]);
  const data = snap.data() ?? {};
  return {
    stats: normalizeStats(data.stats),
    history: games.docs.map((d) => d.data() as GameRecord),
    prefs: { ...DEFAULT_PREFS, ...(data.prefs ?? {}) },
  };
}

/** Folds a finished game into the account's stats. Safe to call twice for the same game. */
export async function recordGame(a: Account, rec: GameRecord): Promise<void> {
  const { db } = fb();
  const userRef = doc(db, "users", a.uid);
  const gameRef = doc(db, "users", a.uid, "games", rec.id);
  await runTransaction(db, async (tx) => {
    const [u, existing] = await Promise.all([tx.get(userRef), tx.get(gameRef)]);
    if (existing.exists()) return;
    const stats = applyRecord(normalizeStats(u.data()?.stats), rec);
    tx.set(userRef, { name: u.data()?.name ?? a.name, stats }, { merge: true });
    tx.set(gameRef, rec);
  });
}

export async function savePrefs(a: Account, prefs: Partial<Prefs>) {
  const { db } = fb();
  await setDoc(doc(db, "users", a.uid), { prefs }, { merge: true }).catch(() => {});
}

export async function loadLeaderboard(): Promise<LeaderRow[]> {
  const { db } = fb();
  const snap = await getDocs(query(collection(db, "users"), orderBy("stats.wins", "desc"), limit(25)));
  return snap.docs
    .map((d) => ({ uid: d.id, name: (d.data().name as string) ?? "Player", stats: normalizeStats(d.data().stats) }))
    .filter((r) => r.stats.gamesPlayed > 0)
    .sort((a, b) => b.stats.wins - a.stats.wins || b.stats.wins / b.stats.gamesPlayed - a.stats.wins / a.stats.gamesPlayed);
}

export async function deleteCloudData(uid: string) {
  const { db } = fb();
  const games = await getDocs(collection(db, "users", uid, "games"));
  const batch = writeBatch(db);
  games.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await deleteDoc(doc(db, "users", uid));
}

/* ---------- in-progress solo game (per device) ---------- */

export interface SavedSolo {
  game: GameState;
  settings: Prefs;
  elapsedMs: number;
}
const soloKey = (uid: string) => `skipbo:solo:${uid}`;

export const solo = {
  load: (uid: string) => lsGet<SavedSolo | null>(soloKey(uid), null),
  save: (uid: string, s: SavedSolo) => lsSet(soloKey(uid), s),
  clear: (uid: string) => lsDel(soloKey(uid)),
};
