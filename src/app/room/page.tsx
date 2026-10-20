"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "@/context/AccountProvider";
import type { GameState, Move } from "@/lib/game/engine";
import { recordGame } from "@/lib/data/store";
import { buildRecord } from "@/lib/data/stats";
import {
  MAX_SEATS,
  backToLobby,
  joinRoom,
  leaveRoom,
  normalizeCode,
  removeFromGame,
  sortedMembers,
  startOnlineGame,
  submitMove,
  subscribeRoom,
  trackPresence,
  updateSettings,
  type Room,
  type RoomSettings,
} from "@/lib/online/rooms";
import { GameBoard } from "@/components/GameBoard";
import { ResultModal } from "@/components/ResultModal";
import { StockField } from "@/components/Dashboard";
import { TopBar } from "@/components/TopBar";
import { Avatar, Spinner, useConfirm, useToast } from "@/components/ui";

export default function RoomPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <RoomInner />
    </Suspense>
  );
}

function RoomInner() {
  const code = normalizeCode(useSearchParams().get("code") ?? "");
  const { account, loading } = useAccount();
  const router = useRouter();
  const toast = useToast();
  const [room, setRoom] = useState<Room | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState("");

  const uid = account?.uid ?? null;

  // Join (idempotent), then listen to the room and report presence.
  useEffect(() => {
    if (!uid || !account || !code) return;
    let unsub = () => {};
    let unPresence = () => {};
    let cancelled = false;
    joinRoom(code, account)
      .then(() => {
        if (cancelled) return;
        unsub = subscribeRoom(code, setRoom, (e) => setError(e.message));
        unPresence = trackPresence(code, uid);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      unsub();
      unPresence();
    };
    // Re-run only when the identity or room changes, not on every account object update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, uid]);

  if (loading) return <Spinner />;

  const shell = (body: React.ReactNode) => (
    <>
      <TopBar>
        <Link href="/" className="btn btn-ghost btn-sm">
          Lobby
        </Link>
      </TopBar>
      <main className="px-4 pb-10">{body}</main>
    </>
  );

  if (!account) {
    return shell(
      <Notice title="Sign in to join this game">
        Sign in with your username and PIN.{" "}
        <Link className="underline" href="/">
          Sign in
        </Link>
        , then open the invite link again.
      </Notice>,
    );
  }
  if (!code) return shell(<Notice title="No lobby code">Ask your friend for the lobby link or code.</Notice>);
  if (error) return shell(<Notice title="Can't open this lobby">{error}</Notice>);
  if (room === undefined) return <Spinner label="Joining lobby…" />;
  if (room === null) return shell(<Notice title="This lobby has closed">Everyone left, so it was removed. Create a new one from the home page.</Notice>);
  if (!room.members?.[account.uid]) return shell(<Notice title="You're not in this lobby">You left or the game started without you.</Notice>);

  return shell(
    room.status === "playing" && room.game ? (
      <OnlineGame code={code} room={room} uid={account.uid} onExit={() => router.push("/")} toast={toast} />
    ) : (
      <WaitingRoom code={code} room={room} uid={account.uid} onExit={() => router.push("/")} toast={toast} />
    ),
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel mx-auto mt-10 max-w-lg">
      <h1 className="mb-2 font-display text-2xl font-semibold">{title}</h1>
      <p className="mb-4 text-muted">{children}</p>
      <Link href="/" className="btn btn-primary">
        Back to home
      </Link>
    </div>
  );
}

/* ---------------- waiting room ---------------- */

function WaitingRoom({ code, room, uid, onExit, toast }: { code: string; room: Room; uid: string; onExit: () => void; toast: (m: string) => void }) {
  const isHost = room.hostUid === uid;
  const members = sortedMembers(room);
  const s = room.settings;
  const [busy, setBusy] = useState(false);
  const total = members.length;

  const set = (patch: Partial<RoomSettings>) => updateSettings(code, patch).catch((e) => toast(e.message));
  const link = typeof window !== "undefined" ? `${window.location.origin}/room/?code=${code}` : "";

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast("Invite link copied.");
    } catch {
      toast(`Couldn't copy automatically — the link is ${link}`);
    }
  };

  return (
    <div className="mx-auto grid max-w-[900px] gap-5 pt-6">
      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-wider text-muted uppercase">Lobby code</div>
          <div className="font-mono text-4xl font-bold tracking-[0.25em]">{code}</div>
          <div className="mt-1 text-sm text-muted">Friends sign in, then enter this code or open your invite link.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={copyLink}>
            Copy invite link
          </button>
          <button
            className="btn"
            onClick={() => navigator.clipboard.writeText(code).then(() => toast("Code copied."))}
          >
            Copy code
          </button>
        </div>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-2">
        <div className="panel">
          <h2 className="mb-3 font-display text-xl font-semibold">
            Players <span className="text-base font-normal text-muted">({total}/{MAX_SEATS})</span>
          </h2>
          <ul className="grid gap-2">
            {members.map(([id, m]) => (
              <li key={id} className="flex items-center gap-2 rounded-lg bg-paper-2 px-3 py-2">
                <Avatar name={m.name} />
                <span className="flex-1 truncate font-semibold">
                  {m.name}
                  {id === uid && <span className="font-normal text-muted"> (you)</span>}
                </span>
                {id === room.hostUid && <span className="rounded-full bg-amber-100 px-2 text-xs text-amber-900">Host</span>}
                <span className={`text-xs ${m.online ? "text-emerald-700" : "text-muted"}`}>{m.online ? "● online" : "○ away"}</span>
              </li>
            ))}
          </ul>
          {members.length < 2 && <p className="mt-3 text-sm text-muted">Waiting for friends to join… copy the invite link and send it to them.</p>}
        </div>

        <div className="panel">
          <h2 className="mb-3 font-display text-xl font-semibold">Game settings</h2>
          {!isHost && <p className="mb-3 text-sm text-muted">Only the host can change these.</p>}
          <StockField value={s.stockSize} onChange={(v) => set({ stockSize: Math.max(5, Math.min(50, Math.round(v) || 30)) })} disabled={!isHost} />
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              className="btn bg-transparent"
              onClick={async () => {
                await leaveRoom(code, uid).catch(() => {});
                onExit();
              }}
            >
              Leave lobby
            </button>
            {isHost ? (
              <button
                className="btn btn-primary flex-1"
                disabled={busy || total < 2}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await startOnlineGame(code, room);
                  } catch (e) {
                    toast(e instanceof Error ? e.message : "Could not start.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {total < 2 ? "Need 2+ players" : `Start game (${total} players)`}
              </button>
            ) : (
              <span className="flex-1 self-center text-sm text-muted">Waiting for the host to start…</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- live game ---------------- */

function OnlineGame({ code, room, uid, onExit, toast }: { code: string; room: Room; uid: string; onExit: () => void; toast: (m: string) => void }) {
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  const raw = room.game!.state;
  const g = useMemo(() => JSON.parse(raw) as GameState, [raw]);
  const mySeat = g.players.findIndex((p) => p.uid === uid);
  const me = g.players[mySeat];
  const isHost = room.hostUid === uid;
  const recorded = useRef<string | null>(null);

  // Record my result once: a forfeit if I was removed, otherwise win/loss when the game ends.
  // (recordGame ignores a second call for the same game.)
  useEffect(() => {
    if (mySeat < 0 || recorded.current === g.id) return;
    if (!me.left && g.winner == null) return;
    recorded.current = g.id;
    recordGame({ uid, name: me.name }, buildRecord(g, mySeat, me.left ? { result: "forfeit" } : {})).catch(() =>
      toast("Couldn't save this result — check your connection."),
    );
  }, [g, mySeat, me, uid, toast]);

  if (mySeat < 0) return <Notice title="Game in progress">This game started before you joined. Wait for the next one.</Notice>;

  const online: Record<number, boolean> = {};
  g.players.forEach((p, i) => {
    if (p.uid) online[i] = !!room.members?.[p.uid]?.online;
  });

  const onMove = (mv: Move) => {
    setPending(true);
    submitMove(code, uid, mv)
      .then((ok) => !ok && toast("That move didn't go through — the game changed. Try again."))
      .catch(() => toast("Network error — move not sent."))
      .finally(() => setPending(false));
  };

  const leave = () =>
    confirm({
      title: "Leave this game?",
      body: "It counts as a forfeit (a loss). The others keep playing without you.",
      okLabel: "Leave game",
      danger: true,
      onOk: async () => {
        if (g.winner == null && !me.left) await recordGame({ uid, name: me.name }, buildRecord(g, mySeat, { result: "forfeit" }));
        await leaveRoom(code, uid);
        onExit();
      },
    });

  return (
    <>
      {me.left && (
        <div className="mx-auto mt-4 max-w-[1280px] rounded-xl bg-amber-100 p-3 text-sm text-amber-900">
          You were removed from this game while you were away, so it counted as a forfeit. You can keep watching.
        </div>
      )}
      <GameBoard
        game={g}
        mySeat={mySeat}
        canAct={!pending && !me.left}
        onMove={onMove}
        onToast={toast}
        online={online}
        waitingLabel="Sending move…"
        opponentExtra={(seat) => {
          const p = g.players[seat];
          if (p.left || online[seat] || g.winner != null) return null;
          return (
            <button
              className="btn btn-ghost btn-sm mt-2 w-full text-xs"
              onClick={() =>
                confirm({
                  title: `Remove ${p.name} from the game?`,
                  body: `${p.name} seems to be disconnected. Their turns will be skipped for the rest of this game, and it counts as a forfeit for them.`,
                  okLabel: "Remove",
                  danger: true,
                  onOk: () => removeFromGame(code, seat, "was removed (disconnected)").then(() => undefined),
                })
              }
            >
              Remove from game
            </button>
          );
        }}
        actions={
          g.winner == null && (
            <button className="btn btn-ghost btn-sm" onClick={leave}>
              Leave game
            </button>
          )
        }
      />
      <ResultModal game={g} mySeat={mySeat} durationMs={(g.finishedAt ?? g.startedAt) - g.startedAt}>
        <button
          className="btn bg-transparent"
          onClick={async () => {
            await leaveRoom(code, uid).catch(() => {});
            onExit();
          }}
        >
          Leave
        </button>
        {isHost ? (
          <button className="btn btn-primary" onClick={() => backToLobby(code).catch((e) => toast(e.message))}>
            Back to lobby
          </button>
        ) : (
          <span className="text-sm text-muted">Waiting for the host to start another round…</span>
        )}
      </ResultModal>
    </>
  );
}
