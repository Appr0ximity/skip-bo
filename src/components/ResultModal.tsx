"use client";

import type { ReactNode } from "react";
import type { GameState } from "@/lib/game/engine";
import { fmtDur } from "@/lib/data/stats";
import { Modal } from "./ui";

export function ResultModal({ game: g, mySeat, durationMs, children }: { game: GameState; mySeat: number; durationMs: number; children: ReactNode }) {
  if (g.winner == null) return null;
  const won = g.winner === mySeat;
  const me = g.players[mySeat];
  const standings = g.players.map((p, i) => ({ p, i })).sort((a, b) => a.p.stock.length - b.p.stock.length);
  return (
    <Modal open dismissable={false}>
      <h2 className={`font-display text-3xl font-semibold ${won ? "bg-linear-to-br from-sb-from to-sb-to bg-clip-text text-transparent" : ""}`}>
        {won ? "You win!" : `${g.players[g.winner].name} wins`}
      </h2>
      <p className="mt-1 mb-4 text-muted">
        {won
          ? `Stockpile cleared in ${me.stats.turns} turns (${fmtDur(durationMs)}).`
          : `You had ${me.stock.length} card${me.stock.length === 1 ? "" : "s"} left in your stockpile.`}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-muted uppercase">
            <th className="p-2">Player</th>
            <th className="p-2">Stock left</th>
            <th className="p-2">Cards played</th>
            <th className="p-2">Skip-Bo used</th>
          </tr>
        </thead>
        <tbody>
          {standings.map(({ p, i }) => (
            <tr key={i} className={`border-t border-line ${i === mySeat ? "bg-amber-50 font-semibold" : ""}`}>
              <td className="p-2">
                {p.name}
                {i === g.winner ? " 🏆" : ""}
              </td>
              <td className="p-2">{p.stock.length}</td>
              <td className="p-2">{p.stats.cardsPlayed}</td>
              <td className="p-2">{p.stats.skipBoPlayed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">{children}</div>
    </Modal>
  );
}
