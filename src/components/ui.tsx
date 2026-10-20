"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/* ---------- Modal ---------- */

export function Modal({ open, onClose, children, dismissable = true }: { open: boolean; onClose?: () => void; children: ReactNode; dismissable?: boolean }) {
  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissable, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      onClick={(e) => dismissable && e.target === e.currentTarget && onClose?.()}
    >
      <div role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-[520px] animate-rise overflow-auto rounded-[18px] bg-paper p-6 text-ink shadow-[0_20px_60px_rgb(0_0_0/0.4)]">
        {children}
      </div>
    </div>
  );
}

interface ConfirmState {
  title: string;
  body: ReactNode;
  okLabel: string;
  danger?: boolean;
  onOk: () => void | Promise<void>;
}

const ConfirmCtx = createContext<(c: ConfirmState) => void>(() => {});
export const useConfirm = () => useContext(ConfirmCtx);

/* ---------- Toast ---------- */

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function UIProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      <ConfirmCtx.Provider value={setConfirm}>
        {children}
        <Modal open={!!confirm} onClose={() => !busy && setConfirm(null)}>
          {confirm && (
            <>
              <h2 className="mb-2 font-display text-xl font-semibold">{confirm.title}</h2>
              <div className="leading-relaxed text-muted">{confirm.body}</div>
              <div className="mt-5 flex justify-end gap-2">
                <button className="btn bg-transparent" onClick={() => setConfirm(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  className={`btn ${confirm.danger ? "btn-danger" : "btn-primary"}`}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await confirm.onOk();
                      setConfirm(null);
                    } catch (e) {
                      show(e instanceof Error ? e.message : "Something went wrong.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {confirm.okLabel}
                </button>
              </div>
            </>
          )}
        </Modal>
        {toast && (
          <div role="status" className="fixed bottom-5 left-1/2 z-[60] max-w-[calc(100%-32px)] -translate-x-1/2 rounded-[10px] bg-black/80 px-4 py-2.5 text-sm text-white">
            {toast}
          </div>
        )}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="grid min-h-[50vh] place-items-center text-white/80">
      <div className="flex items-center gap-3">
        <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        {label}
      </div>
    </div>
  );
}

export function Avatar({ name, photo, size = 26 }: { name: string; photo?: string | null; size?: number }) {
  if (photo)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" className="flex-none rounded-full" />;
  return (
    <span style={{ width: size, height: size }} className="grid flex-none place-items-center rounded-full bg-gold text-xs font-bold text-amber-950">
      {name[0]?.toUpperCase()}
    </span>
  );
}
