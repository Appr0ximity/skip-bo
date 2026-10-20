import type { GameState } from "../game/engine";

export type GameResult = "win" | "loss" | "forfeit";

export interface GameRecord {
  id: string; // game id — recording is idempotent per game
  date: number;
  result: GameResult;
  opponents: number;
  stockSize: number;
  turns: number;
  durationMs: number;
  cardsPlayed: number;
  skipBoPlayed: number;
  stockPlayed: number;
  pilesCompleted: number;
  stockLeft: number;
  winner: string | null;
}

export interface Tally {
  played: number;
  won: number;
}

export interface UserStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  forfeits: number;
  currentStreak: number;
  bestStreak: number;
  fastestWinTurns: number | null;
  fastestWinMs: number | null;
  totalTurns: number;
  totalTimeMs: number;
  cardsPlayed: number;
  skipBoPlayed: number;
  stockPlayed: number;
  pilesCompleted: number;
  /** Sum over games of the share of the stockpile played (0–1), and how many games that covers. */
  stockClearedSum: number;
  stockClearedGames: number;
  byOpponents: Record<string, Tally>;
}

export const emptyStats = (): UserStats => ({
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  forfeits: 0,
  currentStreak: 0,
  bestStreak: 0,
  fastestWinTurns: null,
  fastestWinMs: null,
  totalTurns: 0,
  totalTimeMs: 0,
  cardsPlayed: 0,
  skipBoPlayed: 0,
  stockPlayed: 0,
  pilesCompleted: 0,
  stockClearedSum: 0,
  stockClearedGames: 0,
  byOpponents: {},
});

export const normalizeStats = (s: Partial<UserStats> | undefined): UserStats => ({ ...emptyStats(), ...(s ?? {}) });

/** Returns a new stats object with the game folded in. */
export function applyRecord(prev: UserStats, rec: GameRecord): UserStats {
  const s: UserStats = JSON.parse(JSON.stringify(normalizeStats(prev)));
  const won = rec.result === "win";
  s.gamesPlayed++;
  if (won) s.wins++;
  else s.losses++;
  if (rec.result === "forfeit") s.forfeits++;
  s.currentStreak = won ? s.currentStreak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.currentStreak);
  if (won) {
    s.fastestWinTurns = s.fastestWinTurns == null ? rec.turns : Math.min(s.fastestWinTurns, rec.turns);
    s.fastestWinMs = s.fastestWinMs == null ? rec.durationMs : Math.min(s.fastestWinMs, rec.durationMs);
  }
  s.totalTurns += rec.turns;
  s.totalTimeMs += rec.durationMs;
  s.cardsPlayed += rec.cardsPlayed;
  s.skipBoPlayed += rec.skipBoPlayed;
  s.stockPlayed += rec.stockPlayed;
  s.pilesCompleted += rec.pilesCompleted;
  if (rec.stockSize > 0) {
    s.stockClearedSum += (rec.stockSize - rec.stockLeft) / rec.stockSize;
    s.stockClearedGames++;
  }
  const bump = (obj: Record<string, Tally>, k: string) => {
    obj[k] = obj[k] ?? { played: 0, won: 0 };
    obj[k].played++;
    if (won) obj[k].won++;
  };
  bump(s.byOpponents, String(rec.opponents));
  return s;
}

/** Build the record for the player in `seat` once a game ends (or is forfeited). */
export function buildRecord(g: GameState, seat: number, opts: { result?: GameResult; durationMs?: number } = {}): GameRecord {
  const me = g.players[seat];
  return {
    id: g.id,
    date: Date.now(),
    result: opts.result ?? (g.winner === seat ? "win" : "loss"),
    opponents: g.players.length - 1,
    stockSize: g.stockSize,
    turns: me.stats.turns,
    durationMs: opts.durationMs ?? (g.finishedAt ?? Date.now()) - g.startedAt,
    cardsPlayed: me.stats.cardsPlayed,
    skipBoPlayed: me.stats.skipBoPlayed,
    stockPlayed: me.stats.stockPlayed,
    pilesCompleted: me.stats.pilesCompleted,
    stockLeft: me.stock.length,
    winner: g.winner != null ? g.players[g.winner].name : null,
  };
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
}

export const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + "%" : "—");

/** Average share of the stockpile cleared per game, e.g. "64%", or "—" before any game. */
export const avgStockCleared = (s: UserStats) =>
  s.stockClearedGames ? `${Math.round((s.stockClearedSum / s.stockClearedGames) * 100)}%` : "—";
