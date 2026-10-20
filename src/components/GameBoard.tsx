"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { canPlayOn, sourceCard, top, type GameState, type Move, type PlayerState, type Source } from "@/lib/game/engine";
import { Card, CardBack, Stack, StockPile } from "./Card";

const srcKey = (s: Source | null) => (s ? (s.type === "stock" ? "stock" : `${s.type}:${s.index}`) : "");
const parseSrc = (k: string): Source => {
  const [type, i] = k.split(":");
  return type === "stock" ? { type: "stock" } : { type: type as "hand" | "discard", index: Number(i) };
};

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
  /** Extra controls in an opponent's header (e.g. "Remove from game"). */
  opponentExtra?: (seat: number) => ReactNode;
  waitingLabel?: string;
}

export function GameBoard({ game: g, mySeat, canAct, onMove, onToast, actions, online, opponentExtra, waitingLabel }: Props) {
  const [sel, setSel] = useState<Source | null>(null);
  const [dragging, setDragging] = useState(false);
  // Discard piles show only their top card; these ("seat:pile") are fanned open.
  const [openPiles, setOpenPiles] = useState<Set<string>>(new Set());
  const togglePile = (key: string) =>
    setOpenPiles((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const me = g.players[mySeat];
  const mine = canAct && g.winner == null && g.current === mySeat;

  // Any state change (a move here or elsewhere) clears the selection.
  const stateKey = `${g.turn}:${g.log.length}:${g.log[g.log.length - 1]?.t}`;
  const [prevKey, setPrevKey] = useState(stateKey);
  if (prevKey !== stateKey) {
    setPrevKey(stateKey);
    setSel(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSel(null);
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
    if (kind === "build") onMove({ type: "play", src: s, build: Number(i) });
    else if (kind === "mydiscard" && s.type === "hand") onMove({ type: "discard", hand: s.index, pile: Number(i) });
  };

  const clickSource = (k: string) => {
    if (!mine) return;
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
  const selK = mine ? srcKey(sel) : "";
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
          className: `cursor-grab hover:-translate-y-1 ${dragging && selK === k ? "opacity-45" : ""}`,
        }
      : {};
  const tgtProps = (t: string) => ({
    "data-target": t,
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
  const tgtGlow = (t: string) => (targets.has(t) ? "animate-glow cursor-pointer" : "");

  // Opponents in turn order after me.
  const order = useMemo(() => g.players.map((_, i) => (mySeat + 1 + i) % g.players.length).filter((i) => i !== mySeat), [g.players, mySeat]);

  /** One player's area: stockpile, hand, discards (left to right).
   * The same layout for everyone; only your own cards are face up and playable. */
  const area = (seat: number) => {
    const p: PlayerState = g.players[seat];
    const isMe = seat === mySeat;
    const active = g.current === seat && g.winner == null;
    const showPresence = !isMe && online && !p.left;
    return (
      <section
        key={seat}
        aria-label={isMe ? "Your cards" : `${p.name}'s cards`}
        className={`rounded-[20px] border bg-black/20 p-3 transition sm:px-4 sm:pt-3 sm:pb-4 ${p.left ? "opacity-50" : ""} ${active ? "border-gold shadow-[0_0_0_1px_var(--color-gold),0_0_24px_rgb(255_197_51/0.25)]" : g.winner === seat ? "border-emerald-400" : "border-white/10"}`}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="grid size-6 flex-none place-items-center rounded-full bg-gold text-xs font-bold text-amber-950">{p.name[0]?.toUpperCase()}</span>
          <b className="truncate">
            {p.name}
            {isMe && <span className="font-normal text-white/70"> (you)</span>}
          </b>
          {p.left && <span className="rounded-full bg-white/15 px-2 text-[0.7rem]">Left</span>}
          {showPresence && <span className={`text-[0.7rem] ${online[seat] ? "text-emerald-300" : "text-red-300"}`}>{online[seat] ? "● online" : "● offline"}</span>}
          <span className="text-xs text-white/70">
            Turn {p.stats.turns} · {p.stats.cardsPlayed} cards played
          </span>
          {!isMe && opponentExtra && <span className="ml-auto">{opponentExtra(seat)}</span>}
        </div>
        <div className="flex flex-wrap items-start gap-[clamp(0.8rem,3vw,2.2rem)]">
          <div>
            <div className="lbl mb-3.5">Stockpile</div>
            <StockPile count={p.stock.length}>
              <Card value={top(p.stock)} {...(isMe ? srcProps("stock") : {})} />
            </StockPile>
          </div>
          {/* Stockpile always left, discards always right; the hand follows the stockpile
              (on phones it wraps onto its own row below them). */}
          <div className="order-last min-w-0 basis-full sm:order-none sm:ml-[clamp(0.5rem,2vw,2rem)] sm:flex-1 sm:basis-auto">
            <div className="lbl mb-3.5">Hand</div>
            <div className="flex min-h-[calc(var(--cw)*1.4)] items-center gap-[clamp(0.3rem,1vw,0.6rem)]">
              {p.hand.length ? (
                p.hand.map((c, i) => (isMe ? <Card key={i} value={c} {...srcProps(`hand:${i}`)} /> : <CardBack key={i} />))
              ) : (
                <span className="text-sm text-white/70">Empty</span>
              )}
            </div>
          </div>
          <div className="ml-auto">
            <div className="lbl mb-3.5">Discards</div>
            <div className="flex gap-[clamp(0.3rem,1.2vw,0.8rem)]">
              {p.discards.map((d, i) => {
                const t = `mydiscard:${i}`;
                const key = `${seat}:${i}`;
                const expanded = d.length > 1 && openPiles.has(key);
                const shown = expanded ? d : d.slice(-1);
                const n = Math.max(1, shown.length);
                const drop = isMe ? tgtProps(t) : {};
                return (
                  <div
                    key={i}
                    className={`relative w-(--cw) ${d.length > 1 ? "cursor-pointer" : ""}`}
                    style={{ height: `calc(var(--cw) * 1.4 + ${n - 1} * var(--fan))` }}
                    {...drop}
                    onClick={(e) => {
                      // Discarding onto this pile takes priority; otherwise a click opens/closes the pile.
                      if (isMe && sel && targets.has(t)) {
                        e.stopPropagation();
                        clickTarget(t);
                      } else if (d.length > 1) {
                        e.stopPropagation();
                        togglePile(key);
                      }
                    }}
                  >
                    {shown.length ? (
                      shown.map((c, k) => {
                        const isTop = k === shown.length - 1;
                        const src = isMe && isTop ? srcProps(`discard:${i}`) : {};
                        return (
                          <div key={k} className="absolute left-0" style={{ top: `calc(${k} * var(--fan))` }}>
                            <Card value={c} {...src} className={`${"className" in src ? src.className : ""} ${isMe && isTop ? tgtGlow(t) : ""}`} />
                          </div>
                        );
                      })
                    ) : (
                      <Card className={isMe ? tgtGlow(t) : ""} />
                    )}
                    {d.length > 1 && (
                      <button
                        type="button"
                        aria-label={expanded ? "Hide cards underneath" : `Show all ${d.length} cards`}
                        aria-expanded={expanded}
                        title={expanded ? "Hide cards underneath" : `Show all ${d.length} cards`}
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePile(key);
                        }}
                        className={`absolute -top-2 -right-2 z-20 grid h-5 min-w-5 cursor-pointer place-items-center rounded-full px-1.5 text-[0.7rem] font-bold shadow ${expanded ? "bg-gold text-amber-950" : "bg-black/75 text-white hover:bg-black"}`}
                      >
                        {expanded ? "▲" : d.length}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
  };

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
        <div className="grid gap-3">{order.map(area)}</div>

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
            {mine && !me.hand.length && (
              <button className="btn btn-sm" onClick={() => onMove({ type: "end" })}>
                End turn
              </button>
            )}
            {actions}
          </div>
        </div>

        {/* My area */}
        {area(mySeat)}
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
