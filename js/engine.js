/* Skip-Bo game engine — pure state, no DOM. */
(function (root) {
  'use strict';

  const SB = 0;            // Skip-Bo wild card
  const HAND_SIZE = 5;
  const PILE_MAX = 12;
  const NUM_BUILD = 4;
  const NUM_DISCARD = 4;
  const DECK_SIZE = 162;   // 144 numbered (12 x 1–12) + 18 Skip-Bo

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildDeck(decks) {
    const d = [];
    for (let k = 0; k < decks; k++) {
      for (let r = 0; r < 12; r++) for (let v = 1; v <= 12; v++) d.push(v);
      for (let i = 0; i < 18; i++) d.push(SB);
    }
    return shuffle(d);
  }

  const top = (a) => a[a.length - 1];
  const cardName = (c) => (c === SB ? 'Skip-Bo' : String(c));

  class Game {
    /**
     * @param {{stockSize:number, players:{name:string,isHuman:boolean,difficulty?:string}[], startPlayer?:number}} opts
     */
    static create({ stockSize, players, startPlayer }) {
      const g = new Game();
      const n = players.length;
      // Add extra decks if a large stockpile would otherwise exhaust the cards.
      g.decks = Math.max(1, Math.ceil((n * (stockSize + HAND_SIZE) + 40) / DECK_SIZE));
      g.drawPile = buildDeck(g.decks);
      g.completed = [];
      g.builds = Array.from({ length: NUM_BUILD }, () => []);
      g.players = players.map((p, i) => ({
        id: i,
        name: p.name,
        isHuman: !!p.isHuman,
        difficulty: p.difficulty || null,
        stock: [],
        hand: [],
        discards: Array.from({ length: NUM_DISCARD }, () => []),
        stats: { cardsPlayed: 0, skipBoPlayed: 0, stockPlayed: 0, pilesCompleted: 0, turns: 0 },
      }));
      for (let k = 0; k < stockSize; k++) for (const p of g.players) p.stock.push(g.drawPile.pop());
      g.stockSize = stockSize;
      g.current = startPlayer == null ? Math.floor(Math.random() * n) : startPlayer;
      g.turn = 1;
      g.winner = null;
      g.startedAt = Date.now();
      g.log = [];
      g.movesThisTurn = 0;
      g.addLog(g.current, `${g.players[g.current].name} goes first.`);
      g.startTurn();
      return g;
    }

    static fromJSON(o) {
      return Object.assign(new Game(), o);
    }

    get cur() {
      return this.players[this.current];
    }

    draw() {
      if (this.drawPile.length === 0 && this.completed.length) {
        this.drawPile = shuffle(this.completed);
        this.completed = [];
      }
      if (this.drawPile.length === 0) {
        // Every card is tied up in stock/discard piles: shuffle in a fresh deck to avoid a stalemate.
        this.drawPile = buildDeck(1);
        this.decks++;
        this.addLog(this.current, 'Draw pile ran out — a fresh deck was shuffled in.');
      }
      return this.drawPile.pop();
    }

    refill(p) {
      while (p.hand.length < HAND_SIZE) {
        const c = this.draw();
        if (c === undefined) break;
        p.hand.push(c);
      }
    }

    startTurn() {
      const p = this.cur;
      this.refill(p);
      p.stats.turns++;
      this.movesThisTurn = 0;
    }

    canPlayOn(card, b) {
      if (card === undefined) return false;
      const n = this.builds[b].length;
      return n < PILE_MAX && (card === SB || card === n + 1);
    }

    sourceCard(p, src) {
      switch (src.type) {
        case 'hand': return p.hand[src.index];
        case 'stock': return top(p.stock);
        case 'discard': return p.discards[src.index] ? top(p.discards[src.index]) : undefined;
      }
      return undefined;
    }

    takeSource(p, src) {
      if (src.type === 'hand') return p.hand.splice(src.index, 1)[0];
      if (src.type === 'stock') return p.stock.pop();
      return p.discards[src.index].pop();
    }

    /** Play a card from hand / stockpile / own discard pile onto a building pile. */
    play(src, b) {
      if (this.winner != null) return false;
      const p = this.cur;
      const card = this.sourceCard(p, src);
      if (!this.canPlayOn(card, b)) return false;
      this.takeSource(p, src);
      const pile = this.builds[b];
      pile.push(card);
      const value = pile.length;

      p.stats.cardsPlayed++;
      if (card === SB) p.stats.skipBoPlayed++;
      if (src.type === 'stock') p.stats.stockPlayed++;
      this.movesThisTurn++;

      const from = src.type === 'stock' ? ' from stockpile' : src.type === 'discard' ? ' from discard' : '';
      const as = card === SB ? ` as ${value}` : '';
      this.addLog(this.current, `${p.name} played ${cardName(card)}${as}${from} → pile ${b + 1}`);

      if (pile.length === PILE_MAX) {
        this.completed.push(...pile);
        this.builds[b] = [];
        p.stats.pilesCompleted++;
        this.addLog(this.current, `Pile ${b + 1} completed and cleared.`);
      }

      if (src.type === 'stock' && p.stock.length === 0) {
        this.winner = this.current;
        this.finishedAt = Date.now();
        this.addLog(this.current, `${p.name} emptied their stockpile and wins!`);
        return true;
      }

      // Played every hand card: draw five more and keep going.
      if (p.hand.length === 0) this.refill(p);
      return true;
    }

    /** Discard a hand card onto one of your discard piles — ends the turn. */
    discard(handIndex, pileIndex) {
      if (this.winner != null) return false;
      const p = this.cur;
      if (handIndex < 0 || handIndex >= p.hand.length) return false;
      if (pileIndex < 0 || pileIndex >= NUM_DISCARD) return false;
      const [c] = p.hand.splice(handIndex, 1);
      p.discards[pileIndex].push(c);
      this.addLog(this.current, `${p.name} discarded ${cardName(c)} on discard ${pileIndex + 1}`);
      this.endTurn();
      return true;
    }

    /** Only allowed with an empty hand (no cards left to draw). */
    canEndTurn() {
      return this.winner == null && this.cur.hand.length === 0;
    }

    endTurn() {
      this.current = (this.current + 1) % this.players.length;
      this.turn++;
      this.startTurn();
      return true;
    }

    addLog(p, t) {
      this.log.push({ p, t });
      if (this.log.length > 60) this.log.shift();
    }
  }

  const api = { Game, SB, HAND_SIZE, PILE_MAX, NUM_BUILD, NUM_DISCARD, shuffle, top, cardName };
  root.SkipBo = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
