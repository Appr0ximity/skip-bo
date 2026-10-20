/* Accounts, stats and saved games — all kept in this browser's localStorage. */
(function (root) {
  'use strict';

  const K_USERS = 'skipbo:users';
  const K_SESSION = 'skipbo:session';
  const K_SAVE = 'skipbo:save:';
  const HISTORY_MAX = 100;

  function read(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : JSON.parse(v);
    } catch (e) {
      return d;
    }
  }
  function write(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
      return true;
    } catch (e) {
      console.warn('Storage write failed', e);
      return false;
    }
  }

  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return hex(a);
  }

  // Fallback for insecure contexts (plain http on a LAN IP) where crypto.subtle is unavailable.
  function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  async function hashPassword(pw, salt, algo) {
    const s = salt + ':' + pw;
    if (algo === 'sha256') {
      if (!(root.crypto && crypto.subtle)) throw new Error('This browser context cannot verify this password (open the site via https or localhost).');
      return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
    }
    let h = s;
    for (let i = 0; i < 1000; i++) h = cyrb53(h, i);
    return h;
  }

  function emptyStats() {
    return {
      gamesPlayed: 0, wins: 0, losses: 0, forfeits: 0,
      currentStreak: 0, bestStreak: 0,
      fastestWinTurns: null, fastestWinMs: null,
      totalTurns: 0, totalTimeMs: 0,
      cardsPlayed: 0, skipBoPlayed: 0, stockPlayed: 0, pilesCompleted: 0,
      byDifficulty: {}, byOpponents: {},
    };
  }

  const users = () => read(K_USERS, {});
  const saveUsers = (u) => write(K_USERS, u);
  const keyOf = (name) => String(name || '').trim().toLowerCase();

  function validate(username, password) {
    const name = String(username || '').trim();
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(name)) throw new Error('Username must be 3–20 letters, numbers, _ or -.');
    if (!password || password.length < 4) throw new Error('Password must be at least 4 characters.');
    return name;
  }

  const Store = {
    async register(username, password) {
      const name = validate(username, password);
      const all = users();
      const key = keyOf(name);
      if (all[key]) throw new Error('That username is taken on this device.');
      const salt = randomSalt();
      const algo = root.crypto && crypto.subtle ? 'sha256' : 'cyrb';
      all[key] = {
        username: name, salt, algo,
        hash: await hashPassword(password, salt, algo),
        createdAt: Date.now(), lastLogin: Date.now(),
        stats: emptyStats(), history: [], prefs: {},
      };
      if (!saveUsers(all)) throw new Error('Could not save — browser storage is full or blocked.');
      write(K_SESSION, key);
      return key;
    },

    async login(username, password) {
      const all = users();
      const key = keyOf(username);
      const u = all[key];
      if (!u) throw new Error('No account with that username on this device.');
      if ((await hashPassword(password || '', u.salt, u.algo)) !== u.hash) throw new Error('Incorrect password.');
      u.lastLogin = Date.now();
      saveUsers(all);
      write(K_SESSION, key);
      return key;
    },

    logout() {
      try { localStorage.removeItem(K_SESSION); } catch (e) { /* ignore */ }
    },

    sessionKey() {
      const k = read(K_SESSION, null);
      return k && users()[k] ? k : null;
    },

    getUser(key) {
      const u = users()[key];
      if (!u) return null;
      u.stats = Object.assign(emptyStats(), u.stats);
      return u;
    },

    setPrefs(key, prefs) {
      const all = users();
      if (!all[key]) return;
      all[key].prefs = Object.assign({}, all[key].prefs, prefs);
      saveUsers(all);
    },

    recordGame(key, rec) {
      const all = users();
      const u = all[key];
      if (!u) return;
      const s = (u.stats = Object.assign(emptyStats(), u.stats));
      const won = rec.result === 'win';
      s.gamesPlayed++;
      if (won) s.wins++; else s.losses++;
      if (rec.result === 'forfeit') s.forfeits++;
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
      const bump = (obj, k) => {
        obj[k] = obj[k] || { played: 0, won: 0 };
        obj[k].played++;
        if (won) obj[k].won++;
      };
      bump(s.byDifficulty, rec.difficulty);
      bump(s.byOpponents, String(rec.opponents));
      u.history = [rec].concat(u.history || []).slice(0, HISTORY_MAX);
      saveUsers(all);
    },

    saveGame(key, game) { write(K_SAVE + key, game); },
    loadGame(key) { return read(K_SAVE + key, null); },
    clearGame(key) { try { localStorage.removeItem(K_SAVE + key); } catch (e) { /* ignore */ } },

    leaderboard() {
      return Object.values(users())
        .map((u) => ({ username: u.username, ...Object.assign(emptyStats(), u.stats) }))
        .filter((u) => u.gamesPlayed > 0)
        .sort((a, b) => b.wins - a.wins || b.wins / b.gamesPlayed - a.wins / a.gamesPlayed || a.gamesPlayed - b.gamesPlayed);
    },

    exportUser(key) {
      const u = users()[key];
      return u ? { format: 'skipbo-account', version: 1, exportedAt: Date.now(), account: u, savedGame: read(K_SAVE + key, null) } : null;
    },

    /** Returns {key, exists} without writing, so the UI can confirm an overwrite. */
    inspectImport(data) {
      if (!data || data.format !== 'skipbo-account' || !data.account || !data.account.username || !data.account.hash) {
        throw new Error('That file is not a Skip-Bo account export.');
      }
      const key = keyOf(data.account.username);
      return { key, exists: !!users()[key], username: data.account.username };
    },

    importUser(data) {
      const { key } = Store.inspectImport(data);
      const all = users();
      all[key] = data.account;
      all[key].stats = Object.assign(emptyStats(), all[key].stats);
      if (!saveUsers(all)) throw new Error('Could not save — browser storage is full or blocked.');
      if (data.savedGame) write(K_SAVE + key, data.savedGame);
      return key;
    },

    deleteUser(key) {
      const all = users();
      delete all[key];
      saveUsers(all);
      Store.clearGame(key);
      if (read(K_SESSION, null) === key) Store.logout();
    },
  };

  root.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
