/* Checks the engine against Mattel's official Skip-Bo rules (instruction sheet 42050):
 *   - first turn: draw 5; later turns: draw back up to 5
 *   - play all 5 hand cards → draw 5 more and keep playing; no other mid-turn drawing
 *   - a completed 12-pile is removed and a new pile starts in its place
 *   - when the DRAW pile is used up, completed piles are shuffled into a new DRAW pile
 *   - stockpiles are dealt once (30 each for 2–4 players, 20 for 5+) and never refilled
 * Run: npx tsx scripts/rules-check.ts */
import { SB, cloneGame, createGame, discard, endTurn, play, type Card, type GameState } from "../src/lib/game/engine";

let passed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) throw new Error(`FAILED: ${name}${detail ? ` — ${detail}` : ""}`);
  passed++;
  console.log(`  ✓ ${name}`);
}

const two = () => createGame({ stockSize: 30, players: [{ name: "A" }, { name: "B" }], startPlayer: 0 });
const total = (g: GameState) =>
  g.drawPile.length + g.completed.length + g.builds.flat().length + g.players.reduce((n, p) => n + p.stock.length + p.hand.length + p.discards.flat().length, 0);

// --- Dealing ---------------------------------------------------------------
{
  const g = two();
  check("deck is 162 cards (144 numbered + 18 Skip-Bo)", total(g) === 162);
  check("each player is dealt a 30-card stockpile", g.players.every((p) => p.stock.length === 30));
  check("first player draws 5 on their first turn", g.players[0].hand.length === 5);
  check("other players hold no cards until their first turn", g.players[1].hand.length === 0);
}

// --- Later turns: draw back UP TO 5, keeping the cards you still hold -------
{
  const g = two();
  const a = g.players[0];
  a.hand = [5, 6, 7, 8, 9];
  g.builds = [[], [], [], []];
  discard(g, 0, 0); // A ends turn holding 4 cards
  const kept = [...a.hand];
  check("ending a turn does not refill your hand", a.hand.length === 4);
  check("next player draws up to 5 at the start of their turn", g.players[1].hand.length === 5);
  // B ends their turn, A starts again
  discard(g, 0, 0);
  check("on your next turn you draw only enough to get back to 5", a.hand.length === 5);
  check("cards you kept stay in your hand", kept.every((c, i) => a.hand[i] === c));
}

// --- Mid-turn: no drawing unless the hand is emptied -------------------------
{
  const g = two();
  const a = g.players[0];
  g.builds = [[], [], [], []];
  a.hand = [1, 2, 9, 10, 11];
  const drawBefore = g.drawPile.length;
  play(g, { type: "hand", index: 0 }, 0); // 1
  play(g, { type: "hand", index: 0 }, 0); // 2
  check("playing some hand cards does not draw new ones", a.hand.length === 3 && g.drawPile.length === drawBefore);

  a.hand = [3, 4, 5, 6, 7];
  const before = g.drawPile.length;
  for (let k = 0; k < 5; k++) play(g, { type: "hand", index: 0 }, 0); // 3..7
  check("playing all 5 hand cards draws 5 more", a.hand.length === 5, `hand ${a.hand.length}`);
  check("…taken from the draw pile", g.drawPile.length === before - 5);
  check("…and it is still the same player's turn", g.current === 0);
}

// --- Completed building piles ------------------------------------------------
{
  const g = two();
  const a = g.players[0];
  g.builds = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [], [], []];
  a.hand = [12, 9, 9, 9, 9];
  const drawBefore = g.drawPile.length;
  play(g, { type: "hand", index: 0 }, 0);
  check("a completed 12-card pile is removed from the table", g.builds[0].length === 0);
  check("…and a new pile can start in its place with a 1", (() => {
    const t = cloneGame(g);
    t.players[0].hand = [1];
    return play(t, { type: "hand", index: 0 }, 0);
  })());
  check("…but not with any other card", (() => {
    const t = cloneGame(g);
    t.players[0].hand = [2];
    return !play(t, { type: "hand", index: 0 }, 0);
  })());
  check("completed cards are set aside, not added to the draw pile yet", g.completed.length === 12 && g.drawPile.length === drawBefore);
}

// --- Draw pile used up → completed piles become the new draw pile -----------
{
  const g = two();
  const b = g.players[1];
  const completed: Card[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  g.completed = [...completed];
  g.drawPile = [SB, SB]; // only 2 cards left
  b.hand = [];
  const a = g.players[0];
  a.hand = [9];
  const cardsBefore = total(g);
  discard(g, 0, 0); // A ends turn → B must draw 5 with only 2 left
  check("when the draw pile runs out mid-draw, completed piles are shuffled in", b.hand.length === 5);
  check("…the reshuffled draw pile holds the rest of the completed cards", g.drawPile.length === 2 + 12 - 5 && g.completed.length === 0);
  check("…no cards were created or lost", total(g) === cardsBefore);
}

// --- Stockpiles are never refilled -------------------------------------------
{
  const g = createGame({ stockSize: 10, players: [{ name: "A" }, { name: "B" }, { name: "C" }], startPlayer: 0 });
  const sizes = () => g.players.map((p) => p.stock.length);
  const start = sizes();
  // Simulate many turns of random legal play; a stockpile may only ever shrink.
  let prev = start;
  for (let turn = 0; turn < 400 && g.winner == null; turn++) {
    const p = g.players[g.current];
    let moved = true;
    while (moved && g.winner == null) {
      moved = false;
      const sources = [{ type: "stock" as const }, ...p.hand.map((_, i) => ({ type: "hand" as const, index: i })), ...p.discards.map((_, i) => ({ type: "discard" as const, index: i }))];
      for (const src of sources) for (let bIdx = 0; bIdx < 4 && !moved; bIdx++) if (play(g, src, bIdx)) moved = true;
      const now = sizes();
      if (now.some((n, i) => n > prev[i])) throw new Error("FAILED: a stockpile grew");
      prev = now;
    }
    if (g.winner == null) {
      if (p.hand.length) discard(g, 0, turn % 4);
      else endTurn(g);
    }
  }
  check("stockpiles only ever shrink during play (never refilled)", sizes().every((n, i) => n <= start[i]));
}

// --- Stockpile sizes by player count ----------------------------------------
{
  const four = createGame({ stockSize: 30, players: [1, 2, 3, 4].map((i) => ({ name: `P${i}` })) });
  check("4 players × 30 (official) uses one deck", four.decks === 1 && total(four) === 162);
  const five = createGame({ stockSize: 20, players: [1, 2, 3, 4, 5].map((i) => ({ name: `P${i}` })) });
  check("5 players × 20 (standard for 5+) uses one deck", five.decks === 1 && total(five) === 162);
  const six = createGame({ stockSize: 20, players: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `P${i}` })) });
  check("6 players × 20 (standard for 5+) uses one deck", six.decks === 1 && total(six) === 162);
  const big = createGame({ stockSize: 30, players: [1, 2, 3, 4, 5, 6].map((i) => ({ name: `P${i}` })) });
  check("oversized custom setup (6 × 30) gets a second deck", big.decks === 2 && total(big) === 324);
}

console.log(`\nALL ${passed} RULE CHECKS PASSED`);
export {};
