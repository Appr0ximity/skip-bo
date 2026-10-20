"use client";

import { useState } from "react";
import { authMessage, useAccount } from "@/context/AccountProvider";
import { Card } from "./Card";
import { PinBoxes } from "./PinBoxes";

export function AuthScreen() {
  const { firebaseEnabled, signIn, signUp } = useAccount();
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setErr("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(authMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[1040px] items-center gap-8 px-4 py-8 md:min-h-[calc(100vh-70px)] md:grid-cols-[1.2fr_1fr] md:gap-12">
      <div>
        <h1 className="font-display text-[clamp(2rem,4.5vw,3.4rem)] leading-[1.05] font-semibold">Empty your stockpile first.</h1>
        <p className="mt-4 max-w-[36ch] text-lg leading-relaxed text-white/85">
          Classic Skip-Bo with friends or against computer opponents. Your wins, streaks and history follow you to every device.
        </p>
        <div className="mt-8 hidden [--cw:clamp(64px,9vw,104px)] md:flex">
          <Card value={1} className="-mr-3.5 translate-y-2.5 -rotate-12" />
          <Card value={7} className="-mr-3.5 -rotate-4" />
          <Card value={0} className="-mr-3.5 rotate-4" />
          <Card value={12} className="translate-y-2.5 rotate-12" />
        </div>
      </div>

      <div className="panel">
        {firebaseEnabled ? (
          <>
            <div className="mb-4 flex rounded-[10px] bg-paper-2 p-1" role="tablist">
              {(["signin", "signup"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`flex-1 cursor-pointer rounded-lg py-2 font-semibold ${tab === t ? "bg-white text-ink shadow-sm" : "text-muted"}`}
                  onClick={() => {
                    setTab(t);
                    setErr("");
                  }}
                >
                  {t === "signin" ? "Sign in" : "Create account"}
                </button>
              ))}
            </div>
            <form
              key={tab}
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const username = String(f.get("username") ?? "");
                const pin = String(f.get("pin") ?? "");
                if (pin.length !== 4) return setErr("Enter all 4 digits of your PIN.");
                if (tab === "signin") return run(() => signIn(username, pin));
                const confirm = String(f.get("confirm") ?? "");
                if (confirm.length !== 4) return setErr("Enter all 4 digits to confirm your PIN.");
                if (pin !== confirm) return setErr("PINs do not match.");
                return run(() => signUp(username, pin));
              }}
            >
              <label className="text-sm font-semibold">
                Username
                <input
                  name="username"
                  className="field"
                  required
                  minLength={3}
                  maxLength={20}
                  pattern="[A-Za-z0-9_\-]{3,20}"
                  title="3–20 letters, numbers, _ or -"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <PinBoxes name="pin" label="4-digit PIN" />
              {tab === "signup" && <PinBoxes name="confirm" label="Confirm PIN" />}
              {tab === "signup" && (
                <p className="text-xs text-muted">
                  Username: 3–20 letters, numbers, _ or -. It&apos;s how friends see you. There&apos;s no PIN reset, so pick one you&apos;ll remember — and don&apos;t reuse your bank PIN.
                </p>
              )}
              <p className="min-h-[1.2em] text-sm text-red-700" role="alert">
                {err}
              </p>
              <button className="btn btn-primary w-full" disabled={busy} type="submit">
                {tab === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>
          </>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Accounts aren&apos;t set up yet — Firebase isn&apos;t configured for this site. See the README to connect a Firebase project.
          </p>
        )}
      </div>
    </div>
  );
}
