import type { HTMLAttributes } from "react";
import { SB, type Card as CardValue } from "@/lib/game/engine";

type Props = HTMLAttributes<HTMLDivElement> & {
  value?: CardValue;
  /** Value a Skip-Bo card stands for on a building pile. */
  as?: number | null;
  mini?: boolean;
  label?: string | number;
  selected?: boolean;
  hinted?: boolean;
};

const base =
  "relative grid flex-none select-none place-items-center rounded-[calc(var(--cw)*0.12)] border-2 font-display font-bold transition-[transform,box-shadow] duration-100 w-(--cw) h-[calc(var(--cw)*1.4)]";
const raised = "border-white bg-white shadow-[0_1px_0_rgb(0_0_0/0.15),0_4px_10px_rgb(0_0_0/0.28)]";
const ring = "before:pointer-events-none before:absolute before:inset-[7%] before:rounded-[calc(var(--cw)*0.08)] before:border-2 before:border-current before:opacity-20";

export function Card({ value, as, mini, label, selected, hinted, className = "", ...rest }: Props) {
  const size = mini ? "[--cw:var(--mw)] border" : "";
  const state = selected
    ? "-translate-y-2.5 shadow-[0_0_0_3px_var(--color-gold),0_12px_20px_rgb(0_0_0/0.35)]"
    : hinted
      ? "shadow-[0_0_0_3px_var(--color-hint),0_12px_20px_rgb(0_0_0/0.35)]"
      : "";

  if (value === undefined) {
    return (
      <div
        className={`${base} ${size} border-dashed border-white/30 bg-white/5 text-[calc(var(--cw)*0.32)] text-white/45 ${className}`}
        {...rest}
      >
        {label != null && <span>{label}</span>}
      </div>
    );
  }

  if (value === SB) {
    return (
      <div className={`${base} ${size} ${raised} ${ring} bg-linear-to-br from-sb-from to-sb-to text-white before:opacity-45 ${state} ${className}`} {...rest}>
        <span className="text-center text-[calc(var(--cw)*0.2)] leading-[1.05] tracking-wide">
          SKIP
          <br />
          BO
        </span>
        {as != null && (
          <span className="absolute right-[7%] bottom-[5%] rounded-full bg-white px-[0.35em] text-[calc(var(--cw)*0.2)] leading-[1.35] text-sb-to">{as}</span>
        )}
      </div>
    );
  }

  const tone = value <= 4 ? "text-card-blue" : value <= 8 ? "text-card-green" : "text-card-red";
  return (
    <div className={`${base} ${size} ${raised} ${ring} ${tone} ${state} ${className}`} {...rest}>
      {!mini && <span className="absolute top-[5%] left-[10%] text-[calc(var(--cw)*0.19)] leading-none">{value}</span>}
      <span className={`leading-none ${mini ? "text-[calc(var(--cw)*0.58)]" : "text-[calc(var(--cw)*0.52)]"}`}>{value}</span>
      {!mini && <span className="absolute right-[10%] bottom-[5%] rotate-180 text-[calc(var(--cw)*0.19)] leading-none">{value}</span>}
    </div>
  );
}

export function CardBack({ count, muted }: { count?: number; muted?: boolean }) {
  return (
    <div
      className={`${base} ${ring} border-white bg-[repeating-linear-gradient(45deg,#d23a2a_0_6px,#b52a1d_6px_12px)] text-white shadow-[0_4px_10px_rgb(0_0_0/0.28)] before:opacity-50 ${muted ? "brightness-90 saturate-25" : ""}`}
    >
      {count != null && <span className="relative rounded-full bg-black/55 px-2 text-[calc(var(--cw)*0.2)]">{count}</span>}
    </div>
  );
}

/** Gives a pile a "stack of cards" look underneath its top card. */
export function Stack({ deep, mini, children }: { deep: boolean; mini?: boolean; children: React.ReactNode }) {
  const layer = `absolute inset-0 rounded-[calc(var(--cw)*0.12)] bg-[#f2efe6] shadow-[0_2px_6px_rgb(0_0_0/0.25)] ${mini ? "[--cw:var(--mw)]" : ""}`;
  return (
    <div className="relative w-max">
      {deep && (
        <>
          <div className={`${layer} translate-x-1 translate-y-1`} />
          <div className={`${layer} translate-x-0.5 translate-y-0.5`} />
        </>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}

/** A player's stockpile: face-down cards stacked underneath with the top card face up.
 * The pile gets visibly thinner as it shrinks, and a badge shows how many cards are left. */
export function StockPile({ count, mini, children }: { count: number; mini?: boolean; children: React.ReactNode }) {
  const layers = count > 1 ? Math.min(mini ? 6 : 10, Math.ceil((count - 1) / 3)) : 0;
  const step = mini ? 1.5 : 2.5; // px offset per face-down layer
  const pad = layers * step;
  return (
    <div className={`relative w-max ${mini ? "[--cw:var(--mw)]" : ""}`} style={{ paddingRight: pad, paddingBottom: pad }}>
      {Array.from({ length: layers }, (_, k) => {
        const off = (layers - k) * step; // deepest card first
        return (
          <div key={k} aria-hidden className="absolute top-0 left-0" style={{ transform: `translate(${off}px, ${off}px)` }}>
            <CardBack />
          </div>
        );
      })}
      <div className="relative">{children}</div>
      {count > 0 && (
        <span
          title={`${count} card${count === 1 ? "" : "s"} left in stockpile`}
          className="pointer-events-none absolute -top-2 -left-2 z-20 grid h-5 min-w-5 place-items-center rounded-full bg-gold px-1.5 text-[0.7rem] font-bold text-amber-950 shadow"
        >
          {count}
        </span>
      )}
    </div>
  );
}
