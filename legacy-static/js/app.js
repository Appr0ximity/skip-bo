/* UI: screens, rendering, input, turn loop. */
(function () {
  'use strict';

  const { Game, SB, top } = window.SkipBo;
  const AI = window.SkipBoAI;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const BOT_NAMES = ['Ada', 'Bruno', 'Cleo', 'Dmitri', 'Esme', 'Felix', 'Greta', 'Hugo'];
  const SPEEDS = { slow: 1100, normal: 650, fast: 260 };
  const DEFAULT_PREFS = { stockSize: 30, opponents: 1, difficulty: 'medium', speed: 'normal' };
  const DIFFS = ['easy', 'medium', 'hard'];

  let userKey = null;
  let game = null;
  let sel = null;       // selected source {type, index?}
  let hint = null;      // {src, target}
  let aiTimer = null;
  let lastPlay = null;  // build index just played (one-shot animation)
  let dropped = false;
  let lastClick = {};

  /* ---------- helpers ---------- */

  function fmtDur(ms) {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${ss}s` : `${ss}s`;
  }
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
  const fmtDate = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  function openModal(html) {
    $('#modal-box').innerHTML = html;
    $('#modal').hidden = false;
  }
  function closeModal() {
    $('#modal').hidden = true;
  }
  function confirmBox(title, body, okLabel, onOk, danger) {
    openModal(`<h2>${esc(title)}</h2><p>${body}</p>
      <div class="row end"><button class="btn ghost" data-m="cancel">Cancel</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" data-m="ok">${esc(okLabel)}</button></div>`);
    $('#modal-box [data-m=cancel]').onclick = closeModal;
    $('#modal-box [data-m=ok]').onclick = () => { closeModal(); onOk(); };
  }

  function cardHTML(c, o = {}) {
    const cls = o.cls || '';
    const attrs = o.attrs || '';
    if (c === undefined) return `<div class="card empty ${cls}" ${attrs}>${o.label != null ? `<span>${o.label}</span>` : ''}</div>`;
    if (c === SB) {
      return `<div class="card wild ${cls}" ${attrs}><span class="sb">SKIP<br>BO</span>${o.as ? `<span class="as">${o.as}</span>` : ''}</div>`;
    }
    const tone = c <= 4 ? 'c-blue' : c <= 8 ? 'c-green' : 'c-red';
    return `<div class="card ${tone} ${cls}" ${attrs}><span class="corner tl">${c}</span><span class="num">${c}</span><span class="corner br">${c}</span></div>`;
  }
  const backHTML = (count, cls = '') => `<div class="card back ${cls}"><span class="count">${count}</span></div>`;

  /* ---------- screens ---------- */

  function show(name) {
    $$('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + name));
    document.body.dataset.screen = name;
    renderNav();
    window.scrollTo(0, 0);
  }

  function renderNav() {
    const u = userKey && Store.getUser(userKey);
    $('#nav').innerHTML = u
      ? `<span class="who"><span class="avatar">${esc(u.username[0].toUpperCase())}</span><span class="who-name">${esc(u.username)}</span></span>
         ${document.body.dataset.screen === 'game' ? '<button class="btn small ghost-light" data-nav="home">Lobby</button>' : ''}
         <button class="btn small ghost-light" data-nav="logout">Sign out</button>`
      : '';
  }

  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]');
    if (!b) return;
    if (b.dataset.nav === 'home') leaveGame();
    if (b.dataset.nav === 'logout') {
      leaveGame(true);
      Store.logout();
      userKey = null;
      show('auth');
    }
  });

  /* ---------- auth ---------- */

  $$('.tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $('#form-login').hidden = b.dataset.tab !== 'login';
      $('#form-register').hidden = b.dataset.tab !== 'register';
      $$('.auth-panel .err').forEach((x) => (x.textContent = ''));
    })
  );

  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      userKey = await Store.login(f.username.value, f.password.value);
      f.reset();
      goHome();
    } catch (err) {
      $('.err', f).textContent = err.message;
    }
  });

  $('#form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.password.value !== f.confirm.value) throw new Error('Passwords do not match.');
      userKey = await Store.register(f.username.value, f.password.value);
      f.reset();
      goHome();
      toast('Account created — welcome!');
    } catch (err) {
      $('.err', f).textContent = err.message;
    }
  });

  /* ---------- lobby ---------- */

  function goHome() {
    renderHome();
    show('home');
  }

  function statTile(label, value, sub) {
    return `<div class="stat"><div class="stat-v">${value}</div><div class="stat-l">${label}</div>${sub ? `<div class="stat-s">${sub}</div>` : ''}</div>`;
  }

  function renderHome() {
    const u = Store.getUser(userKey);
    const s = u.stats;
    const prefs = Object.assign({}, DEFAULT_PREFS, u.prefs);
    const saved = Store.loadGame(userKey);
    const avgMs = s.gamesPlayed ? s.totalTimeMs / s.gamesPlayed : null;
    const lb = Store.leaderboard();
    const recent = (u.history || []).slice(0, 20);
    const form = recent.slice(0, 10).map((h) => `<span class="pip ${h.result === 'win' ? 'w' : 'l'}" title="${esc(cap(h.result))} · ${fmtDate(h.date)}">${h.result === 'win' ? 'W' : 'L'}</span>`).join('');

    const breakdown = (obj, keys, label) =>
      keys.map((k) => {
        const r = obj[k] || { played: 0, won: 0 };
        return `<tr><td>${label(k)}</td><td>${r.played}</td><td>${r.won}</td><td>${pct(r.won, r.played)}</td></tr>`;
      }).join('');

    $('#screen-home').innerHTML = `
      <div class="home">
        <div class="home-head">
          <div>
            <h1>Hi, ${esc(u.username)}</h1>
            <p class="sub">Member since ${new Date(u.createdAt).toLocaleDateString()} · ${s.gamesPlayed} game${s.gamesPlayed === 1 ? '' : 's'} played</p>
          </div>
          ${form ? `<div class="form-strip"><span>Last ${Math.min(10, recent.length)}</span>${form}</div>` : ''}
        </div>

        ${saved && saved.winner == null ? `
        <div class="panel resume">
          <div><b>Game in progress</b><span class="muted"> · turn ${saved.turn} · ${saved.players.length - 1} opponent${saved.players.length > 2 ? 's' : ''} · ${cap(saved.settings?.difficulty)} · your stockpile ${saved.players[0].stock.length}/${saved.stockSize}</span></div>
          <div class="row"><button class="btn ghost" id="btn-abandon">Forfeit</button><button class="btn primary" id="btn-resume">Resume game</button></div>
        </div>` : ''}

        <div class="grid-2">
          <form class="panel" id="form-new">
            <h2>New game</h2>
            <label class="field">
              <span>Stockpile size <b id="stock-out">${prefs.stockSize}</b> cards</span>
              <div class="range-row">
                <input type="range" name="stockSize" min="5" max="50" value="${prefs.stockSize}">
                <input type="number" name="stockNum" min="5" max="50" value="${prefs.stockSize}" aria-label="Stockpile size">
              </div>
              <small>Standard rules: 30 cards with 2–4 players, 20 with 5+. Fewer cards = shorter games.</small>
            </label>
            <div class="row fields">
              <label class="field"><span>Opponents</span>
                <select name="opponents">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === +prefs.opponents ? 'selected' : ''}>${n}</option>`).join('')}</select>
              </label>
              <label class="field"><span>Difficulty</span>
                <select name="difficulty">${DIFFS.map((d) => `<option value="${d}" ${d === prefs.difficulty ? 'selected' : ''}>${cap(d)}</option>`).join('')}</select>
              </label>
            </div>
            <p class="rules-mini">4 building piles · 4 discard piles each · 5-card hand</p>
            <button class="btn primary block big" type="submit">${saved && saved.winner == null ? 'Start new game (forfeits current)' : 'Deal cards'}</button>
            <button class="btn link" type="button" id="btn-rules">How to play</button>
          </form>

          <div class="panel">
            <h2>Your stats</h2>
            <div class="winrate">
              <div class="ring" style="--p:${s.gamesPlayed ? (s.wins / s.gamesPlayed) * 100 : 0}"><span>${pct(s.wins, s.gamesPlayed)}</span></div>
              <div><div class="big-num">${s.wins}<small> W</small> · ${s.losses}<small> L</small></div><div class="muted">Win rate${s.forfeits ? ` · ${s.forfeits} forfeit${s.forfeits > 1 ? 's' : ''}` : ''}</div></div>
            </div>
            <div class="stats">
              ${statTile('Current streak', s.currentStreak)}
              ${statTile('Best streak', s.bestStreak)}
              ${statTile('Fastest win', s.fastestWinTurns == null ? '—' : s.fastestWinTurns + ' turns', s.fastestWinMs == null ? '' : fmtDur(s.fastestWinMs))}
              ${statTile('Avg game', fmtDur(avgMs), s.gamesPlayed ? (s.totalTurns / s.gamesPlayed).toFixed(1) + ' turns' : '')}
              ${statTile('Cards played', s.cardsPlayed, s.totalTurns ? (s.cardsPlayed / s.totalTurns).toFixed(2) + ' / turn' : '')}
              ${statTile('Skip-Bo cards', s.skipBoPlayed)}
              ${statTile('Stockpile cards', s.stockPlayed)}
              ${statTile('Piles completed', s.pilesCompleted)}
              ${statTile('Time played', fmtDur(s.totalTimeMs))}
            </div>
          </div>
        </div>

        <div class="grid-2">
          <div class="panel">
            <h2>Breakdown</h2>
            <table class="tbl"><thead><tr><th>Difficulty</th><th>Played</th><th>Won</th><th>Win rate</th></tr></thead>
              <tbody>${breakdown(s.byDifficulty, DIFFS, cap)}</tbody></table>
            <table class="tbl"><thead><tr><th>Opponents</th><th>Played</th><th>Won</th><th>Win rate</th></tr></thead>
              <tbody>${breakdown(s.byOpponents, ['1', '2', '3', '4'], (k) => k)}</tbody></table>
          </div>
          <div class="panel">
            <h2>Leaderboard <span class="muted small">this device</span></h2>
            ${lb.length ? `<table class="tbl"><thead><tr><th>#</th><th>Player</th><th>Games</th><th>Wins</th><th>Win rate</th><th>Best streak</th></tr></thead><tbody>
              ${lb.slice(0, 10).map((r, i) => `<tr class="${r.username === u.username ? 'is-me' : ''}"><td>${i + 1}</td><td>${esc(r.username)}</td><td>${r.gamesPlayed}</td><td>${r.wins}</td><td>${pct(r.wins, r.gamesPlayed)}</td><td>${r.bestStreak}</td></tr>`).join('')}
            </tbody></table>` : '<p class="muted">No finished games yet. Be the first on the board.</p>'}
          </div>
        </div>

        <div class="panel">
          <h2>Recent games</h2>
          ${recent.length ? `<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Date</th><th>Result</th><th>Opp.</th><th>Difficulty</th><th>Stock</th><th>Turns</th><th>Time</th><th>Cards</th><th>Stock left</th></tr></thead><tbody>
            ${recent.map((h) => `<tr><td>${fmtDate(h.date)}</td><td><span class="badge ${h.result}">${cap(h.result)}</span></td><td>${h.opponents}</td><td>${cap(h.difficulty)}</td><td>${h.stockSize}</td><td>${h.turns}</td><td>${fmtDur(h.durationMs)}</td><td>${h.cardsPlayed}</td><td>${h.stockLeft}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="muted">Your finished games will show up here.</p>'}
        </div>

        <div class="panel account">
          <div>
            <h2>Account data</h2>
            <p class="muted">Saved in this browser only. Export a backup to keep your stats safe or move them to another device.</p>
          </div>
          <div class="row wrap">
            <button class="btn" id="btn-export">Export</button>
            <button class="btn" id="btn-import">Import</button>
            <button class="btn danger-ghost" id="btn-delete">Delete account</button>
          </div>
        </div>
      </div>`;

    const f = $('#form-new');
    const syncStock = (v) => {
      v = Math.max(5, Math.min(50, Math.round(+v || 30)));
      f.stockSize.value = v;
      f.stockNum.value = v;
      $('#stock-out').textContent = v;
    };
    f.stockSize.addEventListener('input', () => syncStock(f.stockSize.value));
    f.stockNum.addEventListener('change', () => syncStock(f.stockNum.value));
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      syncStock(f.stockNum.value);
      const settings = { stockSize: +f.stockSize.value, opponents: +f.opponents.value, difficulty: f.difficulty.value };
      const go = () => startGame(settings);
      if (saved && saved.winner == null) {
        confirmBox('Start a new game?', 'Your game in progress will be recorded as a forfeit (a loss).', 'Forfeit & deal', () => {
          recordForfeit(Game.fromJSON(saved));
          go();
        }, true);
      } else go();
    });

    $('#btn-rules').onclick = showRules;
    if ($('#btn-resume')) $('#btn-resume').onclick = resumeGame;
    if ($('#btn-abandon'))
      $('#btn-abandon').onclick = () =>
        confirmBox('Forfeit this game?', 'It will count as a loss in your stats.', 'Forfeit', () => {
          recordForfeit(Game.fromJSON(saved));
          renderHome();
        }, true);

    $('#btn-export').onclick = exportAccount;
    $('#btn-import').onclick = () => $('#import-file').click();
    $('#btn-delete').onclick = () =>
      confirmBox('Delete your account?', `This permanently removes <b>${esc(u.username)}</b> and all stats from this browser. Export first if you want a backup.`, 'Delete account', () => {
        Store.deleteUser(userKey);
        userKey = null;
        show('auth');
        toast('Account deleted.');
      }, true);
  }

  function showRules() {
    openModal(`<h2>How to play Skip-Bo</h2>
      <ul class="rules">
        <li><b>Goal:</b> be the first to play every card in your <b>stockpile</b>.</li>
        <li>At the start of each turn your hand is filled back up to <b>5 cards</b>.</li>
        <li>The four shared <b>building piles</b> start at 1 and go up in order to 12. A full pile is cleared and recycled into the draw pile.</li>
        <li>You can play onto building piles from your <b>hand</b>, the top of your <b>stockpile</b>, or the top of your <b>discard piles</b>.</li>
        <li><b>Skip-Bo</b> cards are wild and count as whatever number is needed.</li>
        <li>Play all 5 hand cards in one turn and you draw 5 more and keep going.</li>
        <li>End your turn by putting one hand card on any of your <b>4 discard piles</b>. Only the top card of a discard pile can be played.</li>
      </ul>
      <p class="muted"><b>Controls:</b> click a card, then click a highlighted pile — or drag and drop. Double-click a card to play it on the first pile it fits.</p>
      <div class="row end"><button class="btn primary" data-m="ok">Got it</button></div>`);
    $('#modal-box [data-m=ok]').onclick = closeModal;
  }

  function exportAccount() {
    const data = Store.exportUser(userKey);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `skipbo-${data.account.username}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const info = Store.inspectImport(data);
      const doImport = () => {
        Store.importUser(data);
        toast(`Imported ${info.username}. Sign in with that account's password.`);
        if (info.key === userKey) renderHome();
      };
      if (info.exists) confirmBox('Overwrite account?', `An account named <b>${esc(info.username)}</b> already exists here. Replace it with the imported data?`, 'Overwrite', doImport, true);
      else doImport();
    } catch (err) {
      toast(err.message || 'Import failed.');
    }
  });

  /* ---------- game lifecycle ---------- */

  function startGame(settings) {
    Store.setPrefs(userKey, settings);
    const u = Store.getUser(userKey);
    const names = window.SkipBo.shuffle(BOT_NAMES.slice());
    const players = [{ name: u.username, isHuman: true }].concat(
      Array.from({ length: settings.opponents }, (_, i) => ({ name: names[i], isHuman: false, difficulty: settings.difficulty }))
    );
    game = Game.create({ stockSize: settings.stockSize, players });
    game.settings = settings;
    game.elapsedMs = 0;
    game.lastActive = Date.now();
    Store.saveGame(userKey, game);
    enterGame();
  }

  function resumeGame() {
    const saved = Store.loadGame(userKey);
    if (!saved) return goHome();
    game = Game.fromJSON(saved);
    game.lastActive = Date.now();
    enterGame();
  }

  function enterGame() {
    sel = hint = lastPlay = null;
    const prefs = Object.assign({}, DEFAULT_PREFS, Store.getUser(userKey).prefs);
    $('#speed').value = prefs.speed;
    show('game');
    renderGame();
    scheduleAI();
  }

  function leaveGame(silent) {
    clearTimeout(aiTimer);
    if (game && game.winner == null) {
      tick();
      Store.saveGame(userKey, game);
    }
    game = null;
    closeModal();
    if (!silent) goHome();
  }

  function tick() {
    if (!game) return;
    const now = Date.now();
    game.elapsedMs = (game.elapsedMs || 0) + Math.min(now - (game.lastActive || now), 120000);
    game.lastActive = now;
  }

  function buildRecord(g, result) {
    const me = g.players[0];
    return {
      date: Date.now(),
      result,
      opponents: g.players.length - 1,
      difficulty: g.settings?.difficulty || g.players[1]?.difficulty || 'medium',
      stockSize: g.stockSize,
      turns: me.stats.turns,
      durationMs: g.elapsedMs || 0,
      cardsPlayed: me.stats.cardsPlayed,
      skipBoPlayed: me.stats.skipBoPlayed,
      stockPlayed: me.stats.stockPlayed,
      pilesCompleted: me.stats.pilesCompleted,
      stockLeft: me.stock.length,
      winner: g.winner != null ? g.players[g.winner].name : null,
    };
  }

  function recordForfeit(g) {
    Store.recordGame(userKey, buildRecord(g, 'forfeit'));
    Store.clearGame(userKey);
  }

  function afterAction() {
    tick();
    if (game.winner != null) return finishGame();
    Store.saveGame(userKey, game);
    renderGame();
    scheduleAI();
  }

  function finishGame() {
    clearTimeout(aiTimer);
    const g = game;
    const rec = buildRecord(g, g.winner === 0 ? 'win' : 'loss');
    Store.recordGame(userKey, rec);
    Store.clearGame(userKey);
    sel = hint = null;
    renderGame();
    const won = g.winner === 0;
    const standings = g.players.map((p, i) => ({ p, i })).sort((a, b) => a.p.stock.length - b.p.stock.length);
    const st = Store.getUser(userKey).stats;
    setTimeout(() => {
      openModal(`<div class="result ${won ? 'won' : 'lost'}">
        <h2>${won ? 'You win!' : `${esc(g.players[g.winner].name)} wins`}</h2>
        <p class="muted">${won ? `Stockpile cleared in ${rec.turns} turns (${fmtDur(rec.durationMs)}).` : `You had ${rec.stockLeft} card${rec.stockLeft === 1 ? '' : 's'} left in your stockpile.`}</p>
        <table class="tbl"><thead><tr><th>Player</th><th>Stock left</th><th>Cards played</th><th>Skip-Bo used</th></tr></thead><tbody>
          ${standings.map(({ p, i }) => `<tr class="${i === 0 ? 'is-me' : ''}"><td>${esc(p.name)}${i === g.winner ? ' 🏆' : ''}</td><td>${p.stock.length}</td><td>${p.stats.cardsPlayed}</td><td>${p.stats.skipBoPlayed}</td></tr>`).join('')}
        </tbody></table>
        <p class="muted small">Overall: ${st.wins}W – ${st.losses}L · win rate ${pct(st.wins, st.gamesPlayed)} · streak ${st.currentStreak}</p>
        <div class="row end"><button class="btn ghost" data-m="home">Lobby</button><button class="btn primary" data-m="again">Play again</button></div>
      </div>`);
      $('#modal-box [data-m=home]').onclick = () => { closeModal(); game = null; goHome(); };
      $('#modal-box [data-m=again]').onclick = () => { closeModal(); startGame(g.settings || DEFAULT_PREFS); };
    }, 500);
  }

  /* ---------- AI turn loop ---------- */

  function scheduleAI() {
    clearTimeout(aiTimer);
    if (!game || game.winner != null || game.cur.isHuman) return;
    aiTimer = setTimeout(aiStep, SPEEDS[$('#speed').value] || SPEEDS.normal);
  }

  function aiStep() {
    const g = game;
    if (!g || g.winner != null || g.cur.isHuman) return;
    const p = g.cur;
    const mv = AI.nextMove(g, p.difficulty);
    let ok = false;
    if (mv.type === 'play') {
      ok = g.play(mv.src, mv.build);
      if (ok) lastPlay = mv.build;
    } else if (mv.type === 'discard') ok = g.discard(mv.hand, mv.pile);
    else ok = g.endTurn();
    if (!ok) {
      // Should not happen; never let the game stall.
      if (p.hand.length) g.discard(0, 0);
      else g.endTurn();
    }
    afterAction();
  }

  $('#speed').addEventListener('change', () => {
    Store.setPrefs(userKey, { speed: $('#speed').value });
    scheduleAI();
  });

  /* ---------- human input ---------- */

  const isMyTurn = () => !!game && game.winner == null && game.cur.isHuman;

  function parseSrc(s) {
    const [type, i] = s.split(':');
    return i == null ? { type } : { type, index: +i };
  }
  const srcKey = (s) => (s ? (s.index == null ? s.type : `${s.type}:${s.index}`) : '');

  function validTargets(s) {
    const g = game;
    const card = g.sourceCard(g.cur, s);
    const t = [];
    if (card === undefined) return t;
    g.builds.forEach((_, b) => g.canPlayOn(card, b) && t.push(`build:${b}`));
    if (s.type === 'hand') for (let i = 0; i < 4; i++) t.push(`mydiscard:${i}`);
    return t;
  }

  function doTarget(t) {
    const [kind, i] = t.split(':');
    const idx = +i;
    let ok = false;
    if (kind === 'build') {
      ok = game.play(sel, idx);
      if (ok) lastPlay = idx;
    } else if (kind === 'mydiscard' && sel.type === 'hand') {
      ok = game.discard(sel.index, idx);
    }
    sel = hint = null;
    if (ok) afterAction();
    else renderGame();
  }

  const gameEl = $('#screen-game');

  gameEl.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) return gameAction(act.dataset.act);
    if (!isMyTurn()) return;
    const tgt = e.target.closest('[data-target]');
    if (tgt && sel && validTargets(sel).includes(tgt.dataset.target)) return doTarget(tgt.dataset.target);
    const src = e.target.closest('[data-src]');
    if (src) {
      // Clicks re-render the board, so native dblclick never fires — detect it here.
      const now = Date.now();
      if (lastClick.key === src.dataset.src && now - lastClick.t < 400) {
        lastClick = {};
        return autoPlay(src.dataset.src);
      }
      lastClick = { key: src.dataset.src, t: now };
      const s = parseSrc(src.dataset.src);
      sel = srcKey(sel) === srcKey(s) ? null : s;
      hint = null;
      return renderGame();
    }
    if (sel) {
      sel = null;
      renderGame();
    }
  });

  function autoPlay(key) {
    sel = parseSrc(key);
    const b = validTargets(sel).find((t) => t.startsWith('build:'));
    if (b) return doTarget(b);
    sel = null;
    renderGame();
    toast('That card does not fit any building pile.');
  }

  gameEl.addEventListener('dragstart', (e) => {
    const src = e.target.closest('[data-src]');
    if (!src || !isMyTurn()) return e.preventDefault();
    sel = parseSrc(src.dataset.src);
    dropped = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', src.dataset.src);
    const valid = new Set(validTargets(sel));
    // Mark targets without re-rendering (re-rendering would cancel the drag).
    requestAnimationFrame(() => {
      src.classList.add('dragging');
      $$('[data-target]', gameEl).forEach((el) => el.classList.toggle('target', valid.has(el.dataset.target)));
    });
  });
  gameEl.addEventListener('dragover', (e) => {
    const tgt = e.target.closest('[data-target]');
    if (tgt && tgt.classList.contains('target')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });
  gameEl.addEventListener('drop', (e) => {
    const tgt = e.target.closest('[data-target]');
    if (!tgt || !sel || !tgt.classList.contains('target')) return;
    e.preventDefault();
    dropped = true;
    doTarget(tgt.dataset.target);
  });
  gameEl.addEventListener('dragend', () => {
    if (!dropped) {
      sel = null;
      renderGame();
    }
  });

  function gameAction(act) {
    if (act === 'forfeit') {
      if (!game || game.winner != null) return;
      confirmBox('Forfeit this game?', 'It will count as a loss in your stats.', 'Forfeit', () => {
        clearTimeout(aiTimer);
        tick();
        recordForfeit(game);
        game = null;
        goHome();
      }, true);
    }
    if (act === 'end' && isMyTurn() && game.canEndTurn()) {
      game.endTurn();
      afterAction();
    }
    if (act === 'hint' && isMyTurn()) {
      const mv = AI.nextMove(game, 'hard');
      if (mv.type === 'play') hint = { src: mv.src, target: `build:${mv.build}` };
      else if (mv.type === 'discard') hint = { src: { type: 'hand', index: mv.hand }, target: `mydiscard:${mv.pile}` };
      else hint = null;
      sel = hint ? hint.src : null;
      renderGame();
      if (mv.type === 'discard') toast('Nothing useful to play — discard to end your turn.');
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#modal').hidden) return closeModal();
      if (sel) { sel = null; renderGame(); }
    }
  });

  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal' && !(game && game.winner != null)) closeModal();
  });

  window.addEventListener('beforeunload', () => {
    if (game && game.winner == null && userKey) {
      tick();
      Store.saveGame(userKey, game);
    }
  });

  /* ---------- game rendering ---------- */

  function renderGame() {
    const g = game;
    if (!g) return;
    const me = g.players[0];
    const mine = isMyTurn();
    const targets = new Set(sel && mine ? validTargets(sel) : []);
    const selK = mine ? srcKey(sel) : '';
    const hintSrc = hint ? srcKey(hint.src) : '';
    const hintT = hint ? hint.target : '';
    document.body.classList.toggle('my-turn', mine);

    const srcAttrs = (key) => (mine ? `data-src="${key}" draggable="true"` : '');
    const srcCls = (key) => [selK === key ? 'selected' : '', hintSrc === key ? 'hinted' : ''].join(' ');
    const tgtCls = (t) => [targets.has(t) ? 'target' : '', hintT === t ? 'hinted' : ''].join(' ');

    // Opponents
    $('#opponents').innerHTML = g.players
      .map((p, i) => {
        if (i === 0) return '';
        const active = g.current === i && g.winner == null;
        return `<div class="opp ${active ? 'active' : ''} ${g.winner === i ? 'winner' : ''}">
          <div class="opp-head"><span class="avatar">${esc(p.name[0])}</span><b>${esc(p.name)}</b><span class="tag">${cap(p.difficulty)}</span><span class="muted-l">${p.hand.length} in hand</span></div>
          <div class="opp-body">
            <div class="mini-zone"><div class="lbl">Stock · ${p.stock.length}</div>
              <div class="stack ${p.stock.length > 1 ? 'deep' : ''}">${cardHTML(top(p.stock), { cls: 'mini', label: '' })}</div></div>
            <div class="mini-zone"><div class="lbl">Discards</div>
              <div class="mini-discards">${p.discards.map((d) => `<div class="mini-pile" title="${d.length ? d.map(window.SkipBo.cardName).join(' → ') : 'empty'}">${cardHTML(top(d), { cls: 'mini' })}${d.length > 1 ? `<span class="cnt">${d.length}</span>` : ''}</div>`).join('')}</div></div>
          </div>
        </div>`;
      })
      .join('');

    // Center
    $('#draw').innerHTML = g.drawPile.length ? backHTML(g.drawPile.length) : cardHTML(undefined, { label: '0' });
    $('#recycle').innerHTML = g.completed.length ? backHTML(g.completed.length, 'muted') : cardHTML(undefined, { label: '' });
    $('#builds').innerHTML = g.builds
      .map((pile, b) => {
        const n = pile.length;
        const t = `build:${b}`;
        const inner = n ? cardHTML(pile[n - 1], { as: pile[n - 1] === SB ? n : null }) : cardHTML(undefined, { label: '1' });
        return `<div class="build ${tgtCls(t)} ${lastPlay === b ? 'just' : ''}" data-target="${t}">
          <div class="lbl">Next: <b>${n + 1}</b></div>
          <div class="stack ${n > 1 ? 'deep' : ''}">${inner}</div></div>`;
      })
      .join('');
    lastPlay = null;

    // Status
    let status;
    if (g.winner != null) status = g.winner === 0 ? '<b>You win!</b>' : `<b>${esc(g.players[g.winner].name)}</b> wins.`;
    else if (mine) {
      if (!me.hand.length) status = 'No cards left to draw — end your turn.';
      else if (sel) status = 'Pick a highlighted pile (Esc to cancel).';
      else status = `<b>Your turn.</b> Play to the building piles, then discard a hand card to end your turn.`;
    } else status = `<span class="dot"></span><b>${esc(g.cur.name)}</b> is playing…`;
    $('#status').innerHTML = `${status}<span class="turn-no">Turn ${g.turn}</span>`;
    $('[data-act=end]').hidden = !(mine && g.canEndTurn());
    $('[data-act=hint]').disabled = !mine;

    // Me
    const stockTop = top(me.stock);
    const discHTML = me.discards
      .map((d, i) => {
        const t = `mydiscard:${i}`;
        const shown = d.slice(-6);
        const hidden = d.length - shown.length;
        const cards = shown
          .map((c, k) => {
            const isTop = k === shown.length - 1;
            const key = `discard:${i}`;
            return `<div class="fan" style="--k:${k}">${cardHTML(c, isTop ? { attrs: srcAttrs(key), cls: srcCls(key) } : {})}</div>`;
          })
          .join('');
        return `<div class="dpile ${tgtCls(t)}" data-target="${t}" style="--n:${Math.max(1, shown.length)}">
          ${hidden ? `<span class="more">+${hidden}</span>` : ''}${cards || `<div class="fan" style="--k:0">${cardHTML(undefined)}</div>`}</div>`;
      })
      .join('');

    $('#me').innerHTML = `
      <div class="me-head"><span class="avatar">${esc(me.name[0].toUpperCase())}</span><b>${esc(me.name)}</b>
        <span class="muted-l">Turn ${me.stats.turns} · ${me.stats.cardsPlayed} cards played</span></div>
      <div class="me-row ${mine ? 'active' : ''}">
        <div class="zone">
          <div class="lbl">Stock · <b>${me.stock.length}</b></div>
          <div class="stack ${me.stock.length > 1 ? 'deep' : ''}">${stockTop === undefined ? cardHTML(undefined) : cardHTML(stockTop, { attrs: srcAttrs('stock'), cls: 'stock-card ' + srcCls('stock') })}</div>
        </div>
        <div class="zone">
          <div class="lbl">Discards</div>
          <div class="discards">${discHTML}</div>
        </div>
        <div class="zone hand-zone">
          <div class="lbl">Hand</div>
          <div class="hand">${me.hand.map((c, i) => cardHTML(c, { attrs: srcAttrs(`hand:${i}`), cls: srcCls(`hand:${i}`) })).join('') || '<span class="muted-l">Empty</span>'}</div>
        </div>
      </div>`;

    // Log
    $('#log').innerHTML = g.log
      .slice(-18)
      .reverse()
      .map((l) => `<li class="${l.p === 0 ? 'mine' : ''}">${esc(l.t)}</li>`)
      .join('');
  }

  /* ---------- boot ---------- */

  userKey = Store.sessionKey();
  if (userKey) goHome();
  else show('auth');
})();
