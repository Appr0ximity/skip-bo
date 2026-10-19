/* Computer opponents. nextMove() never mutates the game. */
(function (root) {
  'use strict';

  const SB = 0;
  const top = (a) => a[a.length - 1];
  const MAX_WILDS = { easy: 1, medium: 1, hard: 2 };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function opponentsStockTops(g) {
    return g.players.filter((_, i) => i !== g.current).map((p) => top(p.stock));
  }

  /** Would raising pile b to value v hand an opponent their stockpile card? */
  function helpsOpponent(g, v) {
    return opponentsStockTops(g).some((o) => o !== undefined && o !== SB && o === v + 1);
  }

  function chooseBuildForStock(g, p, options, card, diff) {
    if (card !== SB || options.length === 1) return options[0];
    if (diff === 'easy') return pick(options);
    // Wild from the stockpile: pick the pile where we can keep going afterwards.
    const have = new Set(p.hand.filter((c) => c !== SB).concat(p.discards.map(top).filter((c) => c !== undefined && c !== SB)));
    let best = options[0], bestScore = -Infinity;
    for (const b of options) {
      const v = g.builds[b].length + 1;
      let s = v * 0.1;
      if (have.has(v + 1)) s += 5;
      if (diff === 'hard' && helpsOpponent(g, v)) s -= 3;
      if (s > bestScore) { bestScore = s; best = b; }
    }
    return best;
  }

  /**
   * Find the cheapest sequence (hand + discard tops, wilds as needed) that lets the
   * stockpile card be played, and return its first move.
   */
  function planToStock(g, p, s, maxW) {
    if (s === undefined || s === SB) return null;
    let best = null;
    for (let b = 0; b < g.builds.length; b++) {
      const t = g.builds[b].length;
      if (t >= s - 1) continue;
      const hand = p.hand.map((c, i) => ({ c, i }));
      const disc = p.discards.map((d) => d.slice());
      let wilds = 0, first = null, steps = 0, ok = true;
      for (let v = t + 1; v <= s - 1; v++) {
        let src = null;
        const di = disc.findIndex((d) => top(d) === v);
        if (di >= 0) { disc[di].pop(); src = { type: 'discard', index: di }; }
        if (!src) {
          const hi = hand.findIndex((h) => h.c === v);
          if (hi >= 0) { src = { type: 'hand', index: hand[hi].i }; hand.splice(hi, 1); }
        }
        if (!src) {
          const hi = hand.findIndex((h) => h.c === SB);
          if (hi >= 0) { src = { type: 'hand', index: hand[hi].i }; hand.splice(hi, 1); wilds++; }
        }
        if (!src) {
          const dw = disc.findIndex((d) => top(d) === SB);
          if (dw >= 0) { disc[dw].pop(); src = { type: 'discard', index: dw }; wilds++; }
        }
        if (!src) { ok = false; break; }
        if (!first) first = src;
        steps++;
      }
      if (!ok || wilds > maxW) continue;
      const cost = wilds * 10 + steps;
      if (!best || cost < best.cost) best = { cost, src: first, build: b };
    }
    return best ? { type: 'play', src: best.src, build: best.build } : null;
  }

  /** Play non-wild cards that fit, to cycle the hand and unblock discard piles. */
  function dumpMove(g, p, diff) {
    const cands = [];
    p.hand.forEach((c, i) => {
      if (c === SB) return;
      for (let b = 0; b < g.builds.length; b++) if (g.canPlayOn(c, b)) cands.push({ src: { type: 'hand', index: i }, build: b, c });
    });
    p.discards.forEach((d, i) => {
      const c = top(d);
      if (c === undefined || c === SB) return;
      for (let b = 0; b < g.builds.length; b++) if (g.canPlayOn(c, b)) cands.push({ src: { type: 'discard', index: i }, build: b, c });
    });
    if (!cands.length) return null;

    if (diff === 'easy') {
      if (Math.random() < 0.5) return null;
      const m = pick(cands);
      return { type: 'play', src: m.src, build: m.build };
    }
    let pool = cands;
    if (diff === 'hard') {
      // Avoid setting up an opponent's stockpile card when there is any alternative.
      const safe = cands.filter((m) => !helpsOpponent(g, g.builds[m.build].length + 1));
      if (safe.length) pool = safe;
      pool.sort((a, b) => (a.src.type === 'hand' ? -1 : 0) - (b.src.type === 'hand' ? -1 : 0));
    } else {
      pool.sort((a, b) => (a.src.type === 'hand' ? -1 : 0) - (b.src.type === 'hand' ? -1 : 0));
    }
    const m = pool[0];
    return { type: 'play', src: m.src, build: m.build };
  }

  function discardMove(g, p, diff) {
    const nonWild = p.hand.map((c, i) => ({ c, i })).filter((h) => h.c !== SB);
    if (diff === 'easy' || (diff === 'medium' && Math.random() < 0.25)) {
      const h = nonWild.length ? pick(nonWild) : { i: 0 };
      return { type: 'discard', hand: h.i, pile: Math.floor(Math.random() * 4) };
    }
    const empties = p.discards.filter((d) => !d.length).length;
    const stockTop = top(p.stock);
    let best = null;
    p.hand.forEach((c, i) => {
      p.discards.forEach((d, j) => {
        const t = top(d);
        let sc = 0;
        if (c === SB) sc -= 200;
        else sc += c;                               // shed high cards first
        if (diff === 'hard' && c !== SB && stockTop !== SB && c < stockTop && c >= stockTop - 3) sc -= 6; // keep cards leading to stock
        if (t === undefined) sc += empties > 1 ? 8 : 1;
        else if (t === c) sc += 20;                // stack equal values
        else if (t === c + 1) sc += 18;            // descending run
        else if (t === SB) sc -= 15;               // never bury a wild
        else if (t < c) sc -= 4 + (c - t);         // burying a lower card is bad
        else sc -= (t - c);
        if (!best || sc > best.sc) best = { sc, i, j };
      });
    });
    return { type: 'discard', hand: best.i, pile: best.j };
  }

  function nextMove(g, diff = 'medium') {
    const p = g.players[g.current];
    const s = top(p.stock);

    const direct = [0, 1, 2, 3].filter((b) => g.canPlayOn(s, b));
    if (direct.length) return { type: 'play', src: { type: 'stock' }, build: chooseBuildForStock(g, p, direct, s, diff) };

    if (diff !== 'easy' || Math.random() < 0.6) {
      const plan = planToStock(g, p, s, MAX_WILDS[diff] ?? 1);
      if (plan) return plan;
    }

    if (g.movesThisTurn < 60) {
      const d = dumpMove(g, p, diff);
      if (d) return d;
    }

    if (p.hand.length === 0) return { type: 'end' };
    return discardMove(g, p, diff);
  }

  const api = { nextMove };
  root.SkipBoAI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
