/* Move suggestions for the Hint button (and the scripted test player).
 * nextMove() never mutates the game. */
import { SB, top, canPlayOn, type Card, type GameState, type Move, type PlayerState, type Source } from "./engine";

export type Difficulty = "easy" | "medium" | "hard";

const MAX_WILDS: Record<Difficulty, number> = { easy: 1, medium: 1, hard: 2 };
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Would raising a pile to value v hand an opponent their stockpile card? */
function helpsOpponent(g: GameState, v: number): boolean {
  return g.players.some((p, i) => {
    if (i === g.current) return false;
    const o = top(p.stock);
    return o !== undefined && o !== SB && o === v + 1;
  });
}

function chooseBuildForStock(g: GameState, p: PlayerState, options: number[], card: Card, diff: Difficulty): number {
  if (card !== SB || options.length === 1) return options[0];
  if (diff === "easy") return pick(options);
  // Wild from the stockpile: pick the pile where we can keep going afterwards.
  const have = new Set(
    p.hand.filter((c) => c !== SB).concat(p.discards.map((d) => top(d)).filter((c): c is Card => c !== undefined && c !== SB)),
  );
  let best = options[0];
  let bestScore = -Infinity;
  for (const b of options) {
    const v = g.builds[b].length + 1;
    let s = v * 0.1;
    if (have.has(v + 1)) s += 5;
    if (diff === "hard" && helpsOpponent(g, v)) s -= 3;
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  return best;
}

/** Cheapest sequence (hand + discard tops, wilds as needed) that makes the stockpile card playable; returns its first move. */
function planToStock(g: GameState, p: PlayerState, s: Card | undefined, maxW: number): Move | null {
  if (s === undefined || s === SB) return null;
  let best: { cost: number; src: Source; build: number } | null = null;
  for (let b = 0; b < g.builds.length; b++) {
    const t = g.builds[b].length;
    if (t >= s - 1) continue;
    const hand = p.hand.map((c, i) => ({ c, i }));
    const disc = p.discards.map((d) => d.slice());
    let wilds = 0;
    let steps = 0;
    let first: Source | null = null;
    let ok = true;
    for (let v = t + 1; v <= s - 1; v++) {
      let src: Source | null = null;
      const di = disc.findIndex((d) => top(d) === v);
      if (di >= 0) {
        disc[di].pop();
        src = { type: "discard", index: di };
      }
      if (!src) {
        const hi = hand.findIndex((h) => h.c === v);
        if (hi >= 0) {
          src = { type: "hand", index: hand[hi].i };
          hand.splice(hi, 1);
        }
      }
      if (!src) {
        const hi = hand.findIndex((h) => h.c === SB);
        if (hi >= 0) {
          src = { type: "hand", index: hand[hi].i };
          hand.splice(hi, 1);
          wilds++;
        }
      }
      if (!src) {
        const dw = disc.findIndex((d) => top(d) === SB);
        if (dw >= 0) {
          disc[dw].pop();
          src = { type: "discard", index: dw };
          wilds++;
        }
      }
      if (!src) {
        ok = false;
        break;
      }
      if (!first) first = src;
      steps++;
    }
    if (!ok || wilds > maxW || !first) continue;
    const cost = wilds * 10 + steps;
    if (!best || cost < best.cost) best = { cost, src: first, build: b };
  }
  return best ? { type: "play", src: best.src, build: best.build } : null;
}

/** Play non-wild cards that fit, to cycle the hand and unblock discard piles. */
function dumpMove(g: GameState, p: PlayerState, diff: Difficulty): Move | null {
  const cands: { src: Source; build: number }[] = [];
  p.hand.forEach((c, i) => {
    if (c === SB) return;
    for (let b = 0; b < g.builds.length; b++) if (canPlayOn(g, c, b)) cands.push({ src: { type: "hand", index: i }, build: b });
  });
  p.discards.forEach((d, i) => {
    const c = top(d);
    if (c === undefined || c === SB) return;
    for (let b = 0; b < g.builds.length; b++) if (canPlayOn(g, c, b)) cands.push({ src: { type: "discard", index: i }, build: b });
  });
  if (!cands.length) return null;

  if (diff === "easy") {
    if (Math.random() < 0.5) return null;
    const m = pick(cands);
    return { type: "play", src: m.src, build: m.build };
  }
  let pool = cands;
  if (diff === "hard") {
    // Avoid setting up an opponent's stockpile card when there is any alternative.
    const safe = cands.filter((m) => !helpsOpponent(g, g.builds[m.build].length + 1));
    if (safe.length) pool = safe;
  }
  pool = [...pool].sort((a, b) => (a.src.type === "hand" ? -1 : 0) - (b.src.type === "hand" ? -1 : 0));
  return { type: "play", src: pool[0].src, build: pool[0].build };
}

function discardMove(p: PlayerState, diff: Difficulty): Move {
  const nonWild = p.hand.map((c, i) => ({ c, i })).filter((h) => h.c !== SB);
  if (diff === "easy" || (diff === "medium" && Math.random() < 0.25)) {
    const h = nonWild.length ? pick(nonWild) : { i: 0 };
    return { type: "discard", hand: h.i, pile: Math.floor(Math.random() * 4) };
  }
  const empties = p.discards.filter((d) => !d.length).length;
  const stockTop = top(p.stock);
  let best = { sc: -Infinity, i: 0, j: 0 };
  p.hand.forEach((c, i) => {
    p.discards.forEach((d, j) => {
      const t = top(d);
      let sc = 0;
      if (c === SB) sc -= 200;
      else sc += c; // shed high cards first
      if (diff === "hard" && c !== SB && stockTop !== undefined && stockTop !== SB && c < stockTop && c >= stockTop - 3) sc -= 6; // keep cards leading to stock
      if (t === undefined) sc += empties > 1 ? 8 : 1;
      else if (t === c) sc += 20; // stack equal values
      else if (t === c + 1) sc += 18; // descending run
      else if (t === SB) sc -= 15; // never bury a wild
      else if (t < c) sc -= 4 + (c - t); // burying a lower card is bad
      else sc -= t - c;
      if (sc > best.sc) best = { sc, i, j };
    });
  });
  return { type: "discard", hand: best.i, pile: best.j };
}

export function nextMove(g: GameState, diff: Difficulty = "medium"): Move {
  const p = g.players[g.current];
  const s = top(p.stock);

  const direct = [0, 1, 2, 3].filter((b) => canPlayOn(g, s, b));
  if (direct.length && s !== undefined) return { type: "play", src: { type: "stock" }, build: chooseBuildForStock(g, p, direct, s, diff) };

  if (diff !== "easy" || Math.random() < 0.6) {
    const plan = planToStock(g, p, s, MAX_WILDS[diff] ?? 1);
    if (plan) return plan;
  }

  if (g.movesThisTurn < 60) {
    const d = dumpMove(g, p, diff);
    if (d) return d;
  }

  if (p.hand.length === 0) return { type: "end" };
  return discardMove(p, diff);
}
