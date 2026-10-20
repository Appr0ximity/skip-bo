"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "@/context/AccountProvider";
import { DEFAULT_PREFS, loadLeaderboard, loadProfile, savePrefs, type LeaderRow, type Prefs } from "@/lib/data/store";
import { avgStockCleared, fmtDur, pct, type GameRecord, type UserStats } from "@/lib/data/stats";
import { createRoom, joinRoom, normalizeCode } from "@/lib/online/rooms";
import { Modal, useConfirm, useToast } from "./ui";

const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "");

export function Dashboard() {
  const { account, deleteAccount } = useAccount();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [stats, setStats] = useState<UserStats | null>(null);
  const [history, setHistory] = useState<GameRecord[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [board, setBoard] = useState<LeaderRow[] | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      const p = await loadProfile(account);
      setStats(p.stats);
      setHistory(p.history);
      setPrefs(p.prefs);
      setLoadErr("");
      setBoard(await loadLeaderboard());
    } catch (e) {
      console.error(e);
      setLoadErr("Couldn't load your stats — check your connection.");
      setStats((s) => s ?? null);
    }
  }, [account]);

  useEffect(() => {
    // Initial load from Firestore.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (!account) return null;
  const s = stats;
  const createLobby = async () => {
    setBusy(true);
    try {
      savePrefs(account, { stockSize: prefs.stockSize });
      const code = await createRoom(account, { stockSize: prefs.stockSize });
      router.push(`/room/?code=${code}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create a lobby.");
      setBusy(false);
    }
  };

  const join = async () => {
    const code = normalizeCode(joinCode);
    if (code.length < 4) return toast("Enter the lobby code your friend shared.");
    setBusy(true);
    try {
      await joinRoom(code, account);
      router.push(`/room/?code=${code}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not join that lobby.");
      setBusy(false);
    }
  };

  const recent = history.slice(0, 20);

  return (
    <div className="mx-auto grid max-w-[1100px] gap-5 px-4 pt-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">Hi, {account.name}</h1>
          <p className="mt-1 text-white/75">
            Stats synced to your account
            {s ? ` · ${s.gamesPlayed} game${s.gamesPlayed === 1 ? "" : "s"} played` : ""}
          </p>
        </div>
        {recent.length > 0 && (
          <div className="flex items-center gap-1 text-xs text-white/75">
            <span className="mr-1.5">Last {Math.min(10, recent.length)}</span>
            {recent.slice(0, 10).map((h) => (
              <span
                key={h.id}
                title={`${cap(h.result)} · ${new Date(h.date).toLocaleString()}`}
                className={`grid size-[22px] place-items-center rounded-md text-[0.72rem] font-bold ${h.result === "win" ? "bg-emerald-400 text-emerald-950" : "bg-white/20"}`}
              >
                {h.result === "win" ? "W" : "L"}
              </span>
            ))}
          </div>
        )}
      </div>

      {loadErr && <div className="rounded-xl bg-red-100 p-3 text-sm text-red-800">{loadErr}</div>}

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="panel">
          <h2 className="mb-1 font-display text-xl font-semibold">Play with friends</h2>
          <p className="mb-4 text-sm text-muted">Create a lobby and send your friends the invite link, or join a friend&apos;s lobby with their code. 2–6 players.</p>
          <StockField value={prefs.stockSize} onChange={(v) => setPrefs({ stockSize: Math.max(5, Math.min(50, Math.round(v) || 30)) })} />
          <button className="btn btn-primary mt-4 w-full py-3" onClick={createLobby} disabled={busy}>
            Create lobby
          </button>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              className="field mt-0 font-mono tracking-[0.3em] uppercase"
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(normalizeCode(e.target.value))}
              aria-label="Lobby code"
            />
            <button className="btn flex-none" disabled={busy} type="submit">
              Join
            </button>
          </form>
          <button type="button" className="mt-3 cursor-pointer text-sm text-card-blue" onClick={() => setShowRules(true)}>
            How to play
          </button>
        </div>
        <StatsPanel s={s} />
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="panel">
          <h2 className="mb-3 font-display text-xl font-semibold">Leaderboard</h2>
          {!board ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : board.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wide text-muted uppercase">
                    <th className="p-2">#</th>
                    <th className="p-2">Player</th>
                    <th className="p-2">Games</th>
                    <th className="p-2">Wins</th>
                    <th className="p-2">Win rate</th>
                    <th className="p-2">Best streak</th>
                  </tr>
                </thead>
                <tbody>
                  {board.slice(0, 15).map((r, i) => (
                    <tr key={r.uid} className={`border-t border-line ${r.uid === account.uid ? "bg-amber-50 font-semibold" : ""}`}>
                      <td className="p-2">{i + 1}</td>
                      <td className="max-w-[10rem] truncate p-2">{r.name}</td>
                      <td className="p-2">{r.stats.gamesPlayed}</td>
                      <td className="p-2">{r.stats.wins}</td>
                      <td className="p-2">{pct(r.stats.wins, r.stats.gamesPlayed)}</td>
                      <td className="p-2">{r.stats.bestStreak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No finished games yet. Be the first on the board.</p>
          )}
        </div>

        <div className="panel">
          <h2 className="mb-3 font-display text-xl font-semibold">Account</h2>
          <p className="mb-4 text-sm text-muted">
            Your stats and history are saved to your account and sync to every device you sign in on.
          </p>
          <button
            className="btn btn-sm border-red-200 text-red-700"
            onClick={() =>
              confirm({
                title: "Delete your account?",
                body: "This permanently deletes your account, stats and game history on every device. Your username becomes free for anyone to take.",
                okLabel: "Delete",
                danger: true,
                onOk: async () => {
                  await deleteAccount();
                  toast("Deleted.");
                },
              })
            }
          >
            Delete account
          </button>
        </div>
      </div>

      <RulesModal open={showRules} onClose={() => setShowRules(false)} />
    </div>
  );
}

export function StockField({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block text-sm font-semibold">
      Stockpile size <b>{value}</b> cards
      <div className="mt-1 flex items-center gap-3">
        <input type="range" min={5} max={50} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-sb-from" />
        <input
          type="number"
          min={5}
          max={50}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="field mt-0 w-[5.2em] flex-none"
          aria-label="Stockpile size"
        />
      </div>
      <span className="mt-1 block text-xs font-normal text-muted">Standard: 30 cards with 2–4 players, 20 with 5+. Fewer cards = shorter games.</span>
    </label>
  );
}

function StatsPanel({ s }: { s: UserStats | null }) {
  const tile = (label: string, value: React.ReactNode, sub?: string) => (
    <div className="rounded-[10px] bg-paper-2 px-3 py-2.5">
      <div className="font-display text-xl font-bold">{value}</div>
      <div className="text-xs font-semibold text-muted">{label}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
  if (!s)
    return (
      <div className="panel">
        <h2 className="font-display text-xl font-semibold">Your stats</h2>
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  const rate = s.gamesPlayed ? (s.wins / s.gamesPlayed) * 100 : 0;
  return (
    <div className="panel">
      <h2 className="mb-3 font-display text-xl font-semibold">Your stats</h2>
      <div className="mb-4 flex items-center gap-4">
        <div
          className="grid size-[92px] flex-none place-items-center rounded-full"
          style={{ background: `conic-gradient(var(--color-card-green) ${rate}%, var(--color-paper-2) 0)` }}
        >
          <span className="grid size-[70px] place-items-center rounded-full bg-paper font-display text-lg font-bold">{pct(s.wins, s.gamesPlayed)}</span>
        </div>
        <div>
          <div className="font-display text-2xl font-bold">
            {s.wins}
            <small className="text-sm text-muted"> W</small> · {s.losses}
            <small className="text-sm text-muted"> L</small>
          </div>
          <div className="text-sm text-muted">Win rate{s.forfeits ? ` · ${s.forfeits} forfeit${s.forfeits > 1 ? "s" : ""}` : ""}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {tile("Current streak", s.currentStreak)}
        {tile("Best streak", s.bestStreak)}
        {tile("Fastest win", s.fastestWinTurns == null ? "—" : `${s.fastestWinTurns} turns`, s.fastestWinMs == null ? undefined : fmtDur(s.fastestWinMs))}
        {tile("Avg stockpile cleared", avgStockCleared(s), "per game")}
      </div>
    </div>
  );
}

export function RulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="mb-3 font-display text-xl font-semibold">How to play Skip-Bo</h2>
      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">
        <li>
          <b>Goal:</b> be the first to play every card in your <b>stockpile</b>.
        </li>
        <li>
          At the start of each turn your hand is filled back up to <b>5 cards</b>.
        </li>
        <li>
          The four shared <b>building piles</b> start at 1 and go up in order to 12. A full pile is cleared and recycled.
        </li>
        <li>
          Play onto building piles from your <b>hand</b>, the top of your <b>stockpile</b>, or the top of your <b>discard piles</b>.
        </li>
        <li>
          <b>Skip-Bo</b> cards are wild.
        </li>
        <li>Play all 5 hand cards in one turn and you draw 5 more.</li>
        <li>
          End your turn by putting one hand card on any of your <b>4 discard piles</b>.
        </li>
      </ul>
      <p className="mt-3 text-sm text-muted">
        <b>Controls:</b> click a card, then a highlighted pile — or drag and drop. Double-click a card to play it on the first pile it fits.
      </p>
      <div className="mt-4 flex justify-end">
        <button className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
