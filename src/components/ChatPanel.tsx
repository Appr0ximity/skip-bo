"use client";

import { useEffect, useRef, useState } from "react";
import type { Account } from "@/lib/data/store";
import { MAX_CHAT_LENGTH, sendChat, subscribeChat, type ChatMessage } from "@/lib/online/chat";

const EMOJIS = [
  "😀", "😂", "🤣", "😅", "😊", "😍", "😎", "🤩",
  "🤔", "😮", "😬", "😢", "😭", "😡", "🤯", "😴",
  "😜", "🥳", "😈", "🙈", "👍", "👎", "👏", "🙌",
  "🙏", "🤞", "💪", "👀", "🔥", "💯", "🎉", "❤️",
  "💔", "✨", "⭐", "🏆", "🃏", "🎴", "🍀", "☕",
];

const time = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Floating lobby chat: a button with an unread badge that opens a chat panel. */
export function ChatPanel({ code, account }: { code: string; account: Account }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState("");
  const [seenId, setSeenId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let first = true;
    return subscribeChat(
      code,
      (m) => {
        setMsgs(m);
        // History that was already there when the page loaded counts as read.
        if (first) setSeenId(m[m.length - 1]?.id ?? null);
        first = false;
      },
      () => setError("Chat unavailable."),
    );
  }, [code]);

  // While open, everything is read; keep the newest message in view.
  const lastId = msgs[msgs.length - 1]?.id ?? null;
  if (open && seenId !== lastId) setSeenId(lastId);
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, lastId]);

  const seenIndex = seenId ? msgs.findIndex((m) => m.id === seenId) : -1;
  const unread = msgs.slice(seenIndex + 1).filter((m) => m.uid !== account.uid).length;

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    setPicker(false);
    try {
      await sendChat(code, account, t);
      setError("");
    } catch {
      setText(t);
      setError("Message not sent — check your connection.");
    }
    inputRef.current?.focus();
  };

  const addEmoji = (e: string) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = (text.slice(0, start) + e + text.slice(end)).slice(0, MAX_CHAT_LENGTH);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = Math.min(start + e.length, next.length);
      el?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-3" onClick={(e) => e.stopPropagation()}>
      {open && (
        <section
          aria-label="Chat"
          className="flex h-[min(480px,calc(100vh-120px))] w-[min(360px,calc(100vw-32px))] animate-rise flex-col overflow-hidden rounded-2xl bg-paper text-ink shadow-[0_20px_60px_rgb(0_0_0/0.4)]"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <b className="font-display text-lg">Chat</b>
            <button className="cursor-pointer rounded-md px-2 text-xl leading-none text-muted hover:bg-paper-2" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" aria-live="polite">
            {msgs.length === 0 && <p className="mt-8 text-center text-sm text-muted">No messages yet. Say hi 👋</p>}
            {msgs.map((m, i) => {
              const mine = m.uid === account.uid;
              const showName = !mine && msgs[i - 1]?.uid !== m.uid;
              const onlyEmoji = /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(m.text) && [...m.text].length <= 6;
              return (
                <div key={m.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                  {showName && <span className="mb-0.5 ml-1 text-xs font-semibold text-muted">{m.name}</span>}
                  <div
                    title={time(m.ts)}
                    className={`max-w-[85%] rounded-2xl px-3 py-1.5 break-words whitespace-pre-wrap ${onlyEmoji ? "bg-transparent px-1 text-3xl" : mine ? "rounded-br-sm bg-linear-to-br from-sb-from to-sb-to text-white" : "rounded-bl-sm bg-paper-2"}`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>

          {picker && (
            <div className="grid grid-cols-8 gap-1 border-t border-line bg-white p-2" role="listbox" aria-label="Emojis">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className="cursor-pointer rounded-md p-1 text-xl hover:bg-paper-2" onClick={() => addEmoji(e)} aria-label={`Insert ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          )}

          {error && <p className="px-3 pt-1 text-xs text-red-700">{error}</p>}
          <form
            className="flex items-center gap-1.5 border-t border-line p-2"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <button
              type="button"
              className={`grid size-9 flex-none cursor-pointer place-items-center rounded-full text-xl hover:bg-paper-2 ${picker ? "bg-paper-2" : ""}`}
              onClick={() => setPicker((p) => !p)}
              aria-label="Emoji picker"
              aria-expanded={picker}
            >
              😊
            </button>
            <input
              ref={inputRef}
              value={text}
              maxLength={MAX_CHAT_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder="Message"
              aria-label="Message"
              className="field mt-0 min-w-0 flex-1 rounded-full"
            />
            <button type="submit" className="btn btn-primary btn-sm flex-none rounded-full" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </section>
      )}

      <button
        className="relative grid size-14 cursor-pointer place-items-center rounded-full bg-linear-to-br from-sb-from to-sb-to text-2xl shadow-[0_8px_24px_rgb(0_0_0/0.35)] transition hover:brightness-105 active:scale-95"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        aria-label={open ? "Close chat" : unread ? `Open chat, ${unread} unread` : "Open chat"}
      >
        💬
        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 grid h-6 min-w-6 place-items-center rounded-full bg-red-600 px-1.5 text-xs font-bold text-white ring-2 ring-felt-700">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
