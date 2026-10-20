"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/context/AccountProvider";
import { applyMove, cloneGame, isBotSeat, type GameState, type Move } from "@/lib/game/engine";
import { nextMove } from "@/lib/game/ai";
import { dealSolo } from "@/lib/game/solo";
import { recordGame, solo, type Prefs } from "@/lib/data/store";
import { buildRecord } from "@/lib/data/stats";
import { GameBoard } from "@/components/GameBoard";
import { ResultModal } from "@/components/ResultModal";
import { TopBar } from "@/components/TopBar";
import { Spinner, useConfirm, useToast } from "@/components/ui";

const SPEEDS = { slow: 1100, normal: 650, fast: 260 } as const;
type Speed = keyof typeof SPEEDS;
const SPEED_KEY = "skipbo:speed";

export default function PlayPage() {
  const { account, loading } = useAccount();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [game, setGame] = useState<GameState | null>(null);
  const [settings, setSettings] = useState<Prefs | null>(null);
  const [speed, setSpeed] = useState<Speed>("normal");
  const elapsed = useRef(0);
  const lastActive = useRef(0);
  const recorded = useRef<string | null>(null);
  const [finalMs, setFinalMs] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!account) return router.replace("/");
    const saved = solo.load(account.uid);
    if (!saved) return router.replace("/");
    elapsed.current = saved.elapsedMs;
    lastActive.current = Date.now();
    /* eslint-disable react-hooks/set-state-in-effect -- one-time load from localStorage */
    setGame(saved.game);
    setSettings(saved.settings);
    try {
      const s = localStorage.getItem(SPEED_KEY) as Speed | null;
      if (s && s in SPEEDS) setSpeed(s);
    } catch {}
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [account, loading, router]);

  const tick = () => {
    const now = Date.now();
    elapsed.current += Math.min(now - lastActive.current, 120_000); // idle gaps count at most 2 min
    lastActive.current = now;
  };

  const commit = useCallback(
    (g: GameState) => {
      if (!account || !settings) return;
      tick();
      setGame(g);
      if (g.winner == null) {
        solo.save(account.uid, { game: g, settings, elapsedMs: elapsed.current });
      } else if (recorded.current !== g.id) {
        recorded.current = g.id;
        setFinalMs(elapsed.current);
        solo.clear(account.uid);
        recordGame(account, buildRecord(g, 0, { mode: "solo", durationMs: elapsed.current })).catch(() =>
          toast("Couldn't save this result — check your connection."),
        );
      }
    },
    [account, settings, toast],
  );

  // Computer players take their turns one move at a time.
  useEffect(() => {
    if (!game || game.winner != null || !isBotSeat(game.players[game.current])) return;
    const t = setTimeout(() => {
      const g = cloneGame(game);
      const p = g.players[g.current];
      if (!applyMove(g, nextMove(g, p.difficulty ?? "medium"))) {
        if (p.hand.length) applyMove(g, { type: "discard", hand: 0, pile: 0 });
        else applyMove(g, { type: "end" });
      }
      commit(g);
    }, SPEEDS[speed]);
    return () => clearTimeout(t);
  }, [game, speed, commit]);

  const onMove = (mv: Move) => {
    if (!game) return;
    const g = cloneGame(game);
    if (applyMove(g, mv)) commit(g);
  };

  const forfeit = () =>
    confirm({
      title: "Forfeit this game?",
      body: "It will count as a loss in your stats.",
      okLabel: "Forfeit",
      danger: true,
      onOk: async () => {
        if (!account || !game) return;
        tick();
        solo.clear(account.uid);
        recorded.current = game.id;
        await recordGame(account, buildRecord(game, 0, { mode: "solo", result: "forfeit", durationMs: elapsed.current }));
        router.push("/");
      },
    });

  if (loading || !game || !settings || !account) return <Spinner />;

  return (
    <>
      <TopBar>
        <Link href="/" className="btn btn-ghost btn-sm">
          Lobby
        </Link>
      </TopBar>
      <main className="px-4 pb-10">
        <GameBoard
          game={game}
          mySeat={0}
          canAct
          onMove={onMove}
          onToast={toast}
          actions={
            <>
              <label className="flex items-center gap-1.5 text-xs text-white/80">
                AI speed
                <select
                  className="rounded-md bg-white px-1.5 py-1 text-sm text-ink"
                  value={speed}
                  onChange={(e) => {
                    const s = e.target.value as Speed;
                    setSpeed(s);
                    try {
                      localStorage.setItem(SPEED_KEY, s);
                    } catch {}
                  }}
                >
                  <option value="slow">Slow</option>
                  <option value="normal">Normal</option>
                  <option value="fast">Fast</option>
                </select>
              </label>
              {game.winner == null && (
                <button className="btn btn-ghost btn-sm" onClick={forfeit}>
                  Forfeit
                </button>
              )}
            </>
          }
        />
      </main>
      <ResultModal game={game} mySeat={0} durationMs={finalMs}>
        <Link href="/" className="btn bg-transparent">
          Lobby
        </Link>
        <button
          className="btn btn-primary"
          onClick={() => {
            const g = dealSolo(account, settings);
            elapsed.current = 0;
            lastActive.current = Date.now();
            solo.save(account.uid, { game: g, settings, elapsedMs: 0 });
            setGame(g);
          }}
        >
          Play again
        </button>
      </ResultModal>
    </>
  );
}
