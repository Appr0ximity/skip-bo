/* Skip-Bo rules engine. Pure functions over a plain, JSON-serializable state
 * so the same state can live in React, localStorage or the Realtime Database.
 * Mutating functions change the state passed in — clone first if needed. */

export const SB = 0; // Skip-Bo wild card
export const HAND_SIZE = 5;
export const PILE_MAX = 12;
export const NUM_BUILD = 4;
export const NUM_DISCARD = 4;
const DECK_SIZE = 162; // 144 numbered (12 × 1–12) + 18 Skip-Bo

export type Card = number;

export type Source =
  | { type: "hand"; index: number }
  | { type: "stock" }
  | { type: "discard"; index: number };

export type Move =
  | { type: "play"; src: Source; build: number }
  | { type: "discard"; hand: number; pile: number }
  | { type: "end" };

export interface PlayerStats {
  cardsPlayed: number;
  skipBoPlayed: number;
  stockPlayed: number;
  pilesCompleted: number;
  turns: number;
}

export interface PlayerState {
  id: number;
  uid: string | null; // account id
  name: string;
  left?: boolean; // left or was removed — their turns are skipped
  stock: Card[];
  hand: Card[];
  discards: Card[][];
  stats: PlayerStats;
}

export interface LogEntry {
  p: number;
  t: string;
}

export interface GameState {
  id: string;
  decks: number;
  drawPile: Card[];
  completed: Card[];
  builds: Card[][];
  players: PlayerState[];
  stockSize: number;
  current: number;
  turn: number;
  winner: number | null;
  startedAt: number;
  finishedAt: number | null;
  movesThisTurn: number;
  log: LogEntry[];
}

export interface PlayerSetup {
  name: string;
  uid?: string | null;
}

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck(decks: number): Card[] {
  const d: Card[] = [];
  for (let k = 0; k < decks; k++) {
    for (let r = 0; r < 12; r++) for (let v = 1; v <= 12; v++) d.push(v);
    for (let i = 0; i < 18; i++) d.push(SB);
  }
  return shuffle(d);
}

export const top = <T>(a: T[]): T | undefined => a[a.length - 1];
export const cardName = (c: Card) => (c === SB ? "Skip-Bo" : String(c));
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function createGame(opts: { stockSize: number; players: PlayerSetup[]; startPlayer?: number }): GameState {
  const n = opts.players.length;
  // Official setups (30 each for 2–4 players, 20 for 5–6) always use one 162-card deck.
  // Extra decks are added only when custom stockpiles plus first hands can't be dealt from one.
  const decks = Math.max(1, Math.ceil((n * (opts.stockSize + HAND_SIZE)) / DECK_SIZE));
  const g: GameState = {
    id: newId(),
    decks,
    drawPile: buildDeck(decks),
    completed: [],
    builds: Array.from({ length: NUM_BUILD }, () => []),
    players: opts.players.map((p, i) => ({
      id: i,
      uid: p.uid ?? null,
      name: p.name,
      stock: [],
      hand: [],
      discards: Array.from({ length: NUM_DISCARD }, () => []),
      stats: { cardsPlayed: 0, skipBoPlayed: 0, stockPlayed: 0, pilesCompleted: 0, turns: 0 },
    })),
    stockSize: opts.stockSize,
    current: opts.startPlayer ?? Math.floor(Math.random() * n),
    turn: 1,
    winner: null,
    startedAt: Date.now(),
    finishedAt: null,
    movesThisTurn: 0,
    log: [],
  };
  for (let k = 0; k < opts.stockSize; k++) for (const p of g.players) p.stock.push(g.drawPile.pop()!);
  addLog(g, g.current, `${g.players[g.current].name} goes first.`);
  startTurn(g);
  return g;
}

export function addLog(g: GameState, p: number, t: string) {
  g.log.push({ p, t });
  if (g.log.length > 60) g.log.shift();
}

function draw(g: GameState): Card | undefined {
  if (g.drawPile.length === 0 && g.completed.length) {
    g.drawPile = shuffle(g.completed);
    g.completed = [];
  }
  if (g.drawPile.length === 0) {
    // Every card is tied up in stock/discard piles: shuffle in a fresh deck to avoid a stalemate.
    g.drawPile = buildDeck(1);
    g.decks++;
    addLog(g, g.current, "Draw pile ran out — a fresh deck was shuffled in.");
  }
  return g.drawPile.pop();
}

function refill(g: GameState, p: PlayerState) {
  while (p.hand.length < HAND_SIZE) {
    const c = draw(g);
    if (c === undefined) break;
    p.hand.push(c);
  }
}

function startTurn(g: GameState) {
  const p = g.players[g.current];
  refill(g, p);
  p.stats.turns++;
  g.movesThisTurn = 0;
}

export function canPlayOn(g: GameState, card: Card | undefined, b: number): boolean {
  if (card === undefined) return false;
  const n = g.builds[b].length;
  return n < PILE_MAX && (card === SB || card === n + 1);
}

export function sourceCard(p: PlayerState, src: Source): Card | undefined {
  switch (src.type) {
    case "hand":
      return p.hand[src.index];
    case "stock":
      return top(p.stock);
    case "discard":
      return p.discards[src.index] ? top(p.discards[src.index]) : undefined;
  }
}

function takeSource(p: PlayerState, src: Source): Card {
  if (src.type === "hand") return p.hand.splice(src.index, 1)[0];
  if (src.type === "stock") return p.stock.pop()!;
  return p.discards[src.index].pop()!;
}

/** Play a card from hand / stockpile / own discard pile onto a building pile. */
export function play(g: GameState, src: Source, b: number): boolean {
  if (g.winner != null || b < 0 || b >= NUM_BUILD) return false;
  const p = g.players[g.current];
  const card = sourceCard(p, src);
  if (!canPlayOn(g, card, b)) return false;
  takeSource(p, src);
  const pile = g.builds[b];
  pile.push(card!);
  const value = pile.length;

  p.stats.cardsPlayed++;
  if (card === SB) p.stats.skipBoPlayed++;
  if (src.type === "stock") p.stats.stockPlayed++;
  g.movesThisTurn++;

  const from = src.type === "stock" ? " from stockpile" : src.type === "discard" ? " from discard" : "";
  const as = card === SB ? ` as ${value}` : "";
  addLog(g, g.current, `${p.name} played ${cardName(card!)}${as}${from} → pile ${b + 1}`);

  if (pile.length === PILE_MAX) {
    g.completed.push(...pile);
    g.builds[b] = [];
    p.stats.pilesCompleted++;
    addLog(g, g.current, `Pile ${b + 1} completed and cleared.`);
  }

  if (src.type === "stock" && p.stock.length === 0) {
    g.winner = g.current;
    g.finishedAt = Date.now();
    addLog(g, g.current, `${p.name} emptied their stockpile and wins!`);
    return true;
  }

  // Played every hand card: draw five more and keep going.
  if (p.hand.length === 0) refill(g, p);
  return true;
}

/** Discard a hand card onto one of your discard piles — ends the turn. */
export function discard(g: GameState, handIndex: number, pileIndex: number): boolean {
  if (g.winner != null) return false;
  const p = g.players[g.current];
  if (handIndex < 0 || handIndex >= p.hand.length) return false;
  if (pileIndex < 0 || pileIndex >= NUM_DISCARD) return false;
  const [c] = p.hand.splice(handIndex, 1);
  p.discards[pileIndex].push(c);
  addLog(g, g.current, `${p.name} discarded ${cardName(c)} on discard ${pileIndex + 1}`);
  endTurn(g);
  return true;
}

/** Ending without a discard is only allowed with an empty hand (no cards left to draw). */
export function canEndTurn(g: GameState): boolean {
  return g.winner == null && g.players[g.current].hand.length === 0;
}

export function endTurn(g: GameState): boolean {
  // Skip anyone who left. leaveSeat() ends the game before fewer than two players remain.
  do g.current = (g.current + 1) % g.players.length;
  while (g.players[g.current].left);
  g.turn++;
  startTurn(g);
  return true;
}

/** A player leaves (or is removed): their turns are skipped from now on.
 * If only one player remains, that player wins. */
export function leaveSeat(g: GameState, seat: number, reason: string): boolean {
  const p = g.players[seat];
  if (!p || p.left || g.winner != null) return false;
  p.left = true;
  addLog(g, seat, `${p.name} ${reason}.`);
  const active = g.players.map((_, i) => i).filter((i) => !g.players[i].left);
  if (active.length === 1) {
    g.winner = active[0];
    g.finishedAt = Date.now();
    addLog(g, active[0], `${g.players[active[0]].name} wins — everyone else left.`);
  } else if (g.current === seat) {
    endTurn(g);
  }
  return true;
}

export function applyMove(g: GameState, mv: Move): boolean {
  if (mv.type === "play") return play(g, mv.src, mv.build);
  if (mv.type === "discard") return discard(g, mv.hand, mv.pile);
  return canEndTurn(g) ? endTurn(g) : false;
}

export const cloneGame = (g: GameState): GameState => JSON.parse(JSON.stringify(g));
