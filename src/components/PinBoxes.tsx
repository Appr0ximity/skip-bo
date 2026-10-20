"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";

const LEN = 4;

/** Four one-digit boxes. Submits its value through a hidden input named `name`. */
export function PinBoxes({ name, label }: { name: string; label: string }) {
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(LEN - 1, i))];
    el?.focus();
    el?.select();
  };

  /** After the last digit, move on to the next field (or the submit button). */
  const focusAfterGroup = () => {
    const form = groupRef.current?.closest("form");
    if (!form) return;
    const fields = [...form.querySelectorAll<HTMLElement>("input:not([type=hidden]), button[type=submit]")];
    const last = refs.current[LEN - 1];
    const next = fields[fields.indexOf(last as HTMLElement) + 1];
    next?.focus();
  };

  /** Write digits starting at box `from`; returns the index after the last one written. */
  const fill = (from: number, text: string) => {
    const incoming = text.replace(/\D/g, "").slice(0, LEN - from).split("");
    if (!incoming.length) return from;
    setDigits((d) => {
      const next = [...d];
      incoming.forEach((c, k) => (next[from + k] = c));
      return next;
    });
    return from + incoming.length;
  };

  const onChange = (i: number, value: string) => {
    if (value === "") {
      setDigits((d) => d.map((c, k) => (k === i ? "" : c)));
      return;
    }
    // A box already holding a digit receives two characters; keep the newly typed one.
    const typed = value.length > 1 && digits[i] ? value.replace(digits[i], "") || value.slice(-1) : value;
    const end = fill(i, typed);
    if (end >= LEN) focusAfterGroup();
    else if (end > i) focusBox(end);
  };

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      e.preventDefault();
      setDigits((d) => d.map((c, k) => (k === i - 1 ? "" : c)));
      focusBox(i - 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(i + 1);
    }
  };

  const onPaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const end = fill(i, e.clipboardData.getData("text"));
    if (end >= LEN) focusAfterGroup();
    else focusBox(end);
  };

  return (
    <div ref={groupRef}>
      <div id={`${name}-label`} className="mb-1 text-sm font-semibold">
        {label}
      </div>
      <div role="group" aria-labelledby={`${name}-label`} className="flex gap-2.5">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`${label}, digit ${i + 1} of ${LEN}`}
            value={d}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.currentTarget.select()}
            className={`size-12 rounded-xl border-2 bg-white text-center font-display text-3xl text-ink caret-transparent transition outline-none focus:border-sb-from focus:ring-4 focus:ring-sb-from/20 sm:size-14 ${d ? "border-ink/40" : "border-line"}`}
          />
        ))}
      </div>
      <input type="hidden" name={name} value={digits.join("")} />
    </div>
  );
}
