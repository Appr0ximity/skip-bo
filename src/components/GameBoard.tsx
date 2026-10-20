"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { canPlayOn, cardName, sourceCard, top, type GameState, type Move, type Source } from "@/lib/game/engine";
import { nextMove } from "@/lib/game/ai";
import { Card, CardBack, Stack } from "./Card";

const srcKey = (s: Source | null) => (s ? (s.type === "stock" ? "stock" : `${s.type}:${s.index}`) : "");
const parseSrc = (k: string): Source => {
  const [type, i] = k.split(":");
  return type === "stock" ? { type: "stock" } : { type: type as "hand" | "discard", index: Number(i) };
};
const cap = (s?: string | null) => (s ? s[0].toUpperCase() + s.slice(1) : "");

interface Props {
  game: GameState;
  mySeat: number;
  /** True while this client may act for mySeat (its turn, not waiting on the network). */
  canAct: boolean;
  onMove: (mv: Move) => void;
  onToast?: (msg: string) => void;
  /** Right-hand side of the status bar (speed select, forfeit…). */
  actions?: ReactNode;
  /** seat → connected? (online games) */
  online?: Record<number, boolean>;
  /** Extra controls under an opponent (e.g. "Replace with bot"). */
  opponentExtra?: (seat: number) => ReactNode;
  waitingLabel?: string;
}

export function GameBoard({ game: g, mySeat, canAct, onMove, onToast, actions, online, opponentExtra, waitingLabel }: Props) {
  const [sel, setSel] = useState<Source | null>(null);
  const [hint, setHint] = useState<{ src: Source; target: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const me = g.players[mySeat];
  const mine = canAct && g.winner == null && g.current === mySeat;

  // Any state change (a move here or elsewhere) clears the selection.
  const stateKey = `${g.turn}:${g.log.length}:${g.log[g.log.length - 1]?.t}`;
  const [prevKey, setPrevKey] = useState(stateKey);
  if (prevKey !== stateKey) {
    setPrevKey(stateKey);
    setSel(null);
    setHint(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSel(null);
        setHint(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const targetsFor = (s: Source | null): string[] => {
    if (!s || !mine) return [];
    const card = sourceCard(me, s);
    if (card === undefined) return [];
    const t: string[] = [];
    g.builds.forEach((_, b) => canPlayOn(g, card, b) && t.push(`build:${b}`));
    if (s.type === "hand") for (let i = 0; i < 4; i++) t.push(`mydiscard:${i}`);
    return t;
  };
  const targets = new Set(targetsFor(sel));

  const doTarget = (s: Source, t: string) => {
    const [kind, i] = t.split(":");
    setSel(null);
    setHint(null);
    if (kind === "build") onMove({ type: "play", src: s, build: Number(i) });
    else if (kind === "mydiscard" && s.type === "hand") onMove({ type: "discard", hand: s.index, pile: Number(i) });
  };

  const clickSource = (k: string) => {
    if (!mine) return;
    setHint(null);
    setSel((cur) => (srcKey(cur) === k ? null : parseSrc(k)));
  };
  const clickTarget = (t: string) => {
    if (sel && targets.has(t)) doTarget(sel, t);
  };
  const autoPlay = (k: string) => {
    if (!mine) return;
    const s = parseSrc(k);
    const b = targetsFor(s).find((t) => t.startsWith("build:"));
    if (b) doTarget(s, b);
    else onToast?.("That card doesn't fit any building pile.");
  };
  const showHint = () => {
    if (!mine) return;
    const mv = nextMove(g, "hard");
    if (mv.type === "play") setHint({ src: mv.src, target: `build:${mv.build}` });
    else if (mv.type === "discard") {
      setHint({ src: { type: "hand", index: mv.hand }, target: `mydiscard:${mv.pile}` });
      onToast?.("Nothing useful to play — discard to end your turn.");
    }
    if (mv.type !== "end") setSel(mv.type === "play" ? mv.src : { type: "hand", index: mv.hand });
  };

  const selK = mine ? srcKey(sel) : "";
  const hintSrc = hint ? srcKey(hint.src) : "";
  const srcProps = (k: string) =>
    mine
      ? {
          draggable: true,
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            clickSource(k);
          },
          onDoubleClick: () => autoPlay(k),
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", k);
            setSel(parseSrc(k));
            setDragging(true);
          },
          onDragEnd: () => setDragging(false),
          selected: selK === k,
          hinted: hintSrc === k,
          className: `cursor-grab hover:-translate-y-1 ${dragging && selK === k ? "opacity-45" : ""}`,
        }
      : {};
  const tgtProps = (t: string) => ({
    "data-target": t,
    "data-hinted": hint?.target === t || undefined,
    onClick: (e: React.MouseEvent) => {
      if (sel && targets.has(t)) {
        e.stopPropagation();
        clickTarget(t);
      }
    },
    onDragOver: (e: React.DragEvent) => {
      if (targets.has(t)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (sel && targets.has(t)) doTarget(sel, t);
    },
  });
  const tgtGlow = (t: string) => (targets.has(t) ? "animate-glow cursor-pointer" : hint?.target === t ? "shadow-[0_0_0_3px_var(--color-hint),0_0_22px_rgb(125_249_255/0.6)]" : "");

  // Opponents in turn order after me.
  const order = useMemo(() => g.players.map((_, i) => (mySeat + 1 + i) % g.players.length).filter((i) => i !== mySeat), [g.players, mySeat]);

  let status: ReactNode;
  if (g.winner != null) status = g.winner === mySeat ? <b>You win!</b> : <><b>{g.players[g.winner].name}</b> wins.</>;
  else if (mine) {
    if (!me.hand.length) status = "No cards left to draw — end your turn.";
    else if (sel) status = "Pick a highlighted pile (Esc to cancel).";
    else status = <><b>Your turn.</b> Play to the building piles, then discard a hand card to end your turn.</>;
  } else if (g.current === mySeat) status = waitingLabel ?? "Sending…";
  else status = <><span className="inline-block size-2 animate-blink rounded-full bg-gold" /><b>{g.players[g.current].name}</b> is playing…</>;

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 items-start gap-4 pt-4 lg:grid-cols-[minmax(0,1fr)_250px]" onClick={() => setSel(null)}>
      <div className="grid min-w-0 gap-4">
        {/* Opponents */}
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3">
          {order.map((i) => {
            const p = g.players[i];
            const active = g.current === i && g.winner == null;
            const isOnlineHuman = online && p.isHuman && !p.left;
            return (
              <div
                key={i}
                className={`flex items-center justify-between gap-3 rounded-2xl border bg-black/20 px-3 py-2 transition sm:block ${active ? "border-gold shadow-[0_0_0_1px_var(--color-gold),0_0_24px_rgb(255_197_51/0.25)]" : g.winner === i ? "border-emerald-400" : "border-white/10"}`}
              >
                <div className="flex min-w-0 flex-col items-start gap-0.5 sm:mb-2 sm:flex-row sm:items-center sm:gap-2">
                  <span className="hidden size-6 flex-none place-items-center rounded-full bg-gold text-xs font-bold text-amber-950 sm:grid">{p.name[0]?.toUpperCase()}</span>
                  <b className="truncate">{p.name}</b>
                  <span className="rounded-full bg-white/15 px-2 text-[0.7rem]">
                    {p.left ? "Bot (left)" : p.isHuman ? "Player" : cap(p.difficulty)}
                  </span>
                  {isOnlineHuman && (
                    <span className={`text-[0.7rem] ${online[i] ? "text-emerald-300" : "text-red-300"}`}>{online[i] ? "● online" : "● offline"}</span>
                  )}
                  <span className="text-xs text-white/70">{p.hand.length} in hand</span>
                </div>
                <div className="flex gap-3">
                  <div>
                    <div className="lbl text-[0.62rem] sm:text-xs">Stock · {p.stock.length}</div>
                    <Stack deep={p.stock.length > 1} mini>
                      <Card value={top(p.stock)} mini />
                    </Stack>
                  </div>
                  <div>
                    <div className="lbl text-[0.62rem] sm:text-xs">Discards</div>
                    <div className="flex gap-1.5">
                      {p.discards.map((d, j) => (
                        <div key={j} className="relative" title={d.length ? d.map(cardName).join(" → ") : "empty"}>
                          <Card value={top(d)} mini />
                          {d.length > 1 && (
                            <span className="absolute -top-1.5 -right-1.5 z-10 rounded-full bg-black/70 px-1.5 text-[0.65rem] leading-normal">{d.length}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {opponentExtra?.(i)}
              </div>
            );
          })}
        </div>

        {/* Center: draw pile, building piles, completed */}
        <div className="flex flex-wrap items-end justify-center gap-[clamp(0.8rem,3vw,2.4rem)] rounded-[20px] border border-white/5 bg-black/15 p-3 sm:flex-nowrap sm:p-4">
          <div className="hidden flex-col items-center sm:flex">
            <div className="lbl">Draw</div>
            {g.drawPile.length ? <CardBack count={g.drawPile.length} /> : <Card label="0" />}
          </div>
          <div className="flex gap-[clamp(0.4rem,1.6vw,1.1rem)]">
            {g.builds.map((pile, b) => {
              const t = `build:${b}`;
              const n = pile.length;
              return (
                <div key={b} className="flex flex-col items-center" {...tgtProps(t)}>
                  <div className="lbl">
                    Next: <b className="text-white">{n + 1}</b>
                  </div>
                  <Stack deep={n > 1}>
                    {n ? (
                      <Card key={`${n}-${g.completed.length}-${g.turn}`} value={pile[n - 1]} as={pile[n - 1] === 0 ? n : null} className={`animate-drop ${tgtGlow(t)}`} />
                    ) : (
                      <Card label="1" className={tgtGlow(t)} />
                    )}
                  </Stack>
                </div>
              );
            })}
          </div>
          <div className="hidden flex-col items-center sm:flex">
            <div className="lbl">Completed</div>
            {g.completed.length ? <CardBack count={g.completed.length} muted /> : <Card />}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex flex-wrap items-center justify-between gap-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex min-h-[1.6em] flex-wrap items-center gap-2 text-[0.95rem]" aria-live="polite">
            {status}
            <span className="rounded-full bg-black/25 px-2.5 text-xs text-white/80">Turn {g.turn}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-sm" onClick={showHint} disabled={!mine}>
              Hint
            </button>
            {mine && !me.hand.length && (
              <button className="btn btn-sm" onClick={() => onMove({ type: "end" })}>
                End turn
              </button>
            )}
            {actions}
          </div>
        </div>

        {/* My area */}
        <div className="rounded-[20px] border border-white/10 bg-black/20 p-3 sm:px-4 sm:pt-3 sm:pb-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-gold text-xs font-bold text-amber-950">{me.name[0]?.toUpperCase()}</span>
            <b>{me.name}</b>
            <span className="text-xs text-white/70">
              Turn {me.stats.turns} · {me.stats.cardsPlayed} cards played
            </span>
          </div>
          <div className="flex flex-wrap items-start gap-[clamp(0.8rem,3vw,2.2rem)]">
            <div>
              <div className="lbl mb-3.5">
                Stock · <b className="text-white">{me.stock.length}</b>
              </div>
              <Stack deep={me.stock.length > 1}>
                <Card value={top(me.stock)} {...srcProps("stock")} />
              </Stack>
            </div>
            <div>
              <div className="lbl mb-3.5">Discards</div>
              <div className="flex gap-[clamp(0.3rem,1.2vw,0.8rem)]">
                {me.discards.map((d, i) => {
                  const t = `mydiscard:${i}`;
                  const shown = d.slice(-6);
                  const hidden = d.length - shown.length;
                  const n = Math.max(1, shown.length);
                  return (
                    <div key={i} className="relative w-(--cw)" style={{ height: `calc(var(--cw) * 1.4 + ${n - 1} * var(--fan))` }} {...tgtProps(t)}>
                      {hidden > 0 && <span className="absolute -top-5 right-0 text-[0.7rem] text-white/70">+{hidden}</span>}
                      {shown.length ? (
                        shown.map((c, k) => {
                          const isTop = k === shown.length - 1;
                          return (
                            <div key={k} className="absolute left-0" style={{ top: `calc(${k} * var(--fan))` }}>
                              <Card value={c} {...(isTop ? srcProps(`discard:${i}`) : {})} className={`${isTop ? (srcProps(`discard:${i}`).className ?? "") : ""} ${isTop ? tgtGlow(t) : ""}`} />
                            </div>
                          );
                        })
                      ) : (
                        <Card className={tgtGlow(t)} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <div className="lbl mb-3.5">Hand</div>
              <div className="flex min-h-[calc(var(--cw)*1.4)] items-center gap-[clamp(0.3rem,1vw,0.6rem)]">
                {me.hand.length ? me.hand.map((c, i) => <Card key={i} value={c} {...srcProps(`hand:${i}`)} />) : <span className="text-sm text-white/70">Empty</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Log */}
      <aside className="max-h-[220px] overflow-auto rounded-2xl border border-white/10 bg-black/20 px-4 py-3 lg:sticky lg:top-[70px] lg:max-h-[calc(100vh-110px)]">
        <h3 className="mb-2 font-display font-semibold">Game log</h3>
        <ol className="grid gap-1.5 text-[0.82rem]">
          {g.log
            .slice(-18)
            .reverse()
            .map((l, i) => (
              <li key={g.log.length - i} className={`${l.p === mySeat ? "text-gold" : "text-white/80"} ${i === 0 ? "font-semibold" : ""}`}>
                {l.t}
              </li>
            ))}
        </ol>
      </aside>
    </div>
  );
}
