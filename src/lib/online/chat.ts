"use client";

/* Lobby chat in the Realtime Database, kept apart from rooms/{code} so chatting
 * doesn't add to the data sent on every move:
 *   chats/{code}/{pushId}: { uid, name, text, ts }
 * Only lobby members can read or post; messages can't be edited or faked. */

import { limitToLast, onValue, push, query, ref, remove, type Unsubscribe } from "firebase/database";
import { fb } from "../firebase";
import type { Account } from "../data/store";

export const MAX_CHAT_LENGTH = 300;
const HISTORY = 100;

export interface ChatMessage {
  id: string;
  uid: string;
  name: string;
  text: string;
  ts: number;
}

export async function sendChat(code: string, a: Account, text: string): Promise<void> {
  const clean = text.trim().slice(0, MAX_CHAT_LENGTH);
  if (!clean) return;
  await push(ref(fb().rtdb, `chats/${code}`), { uid: a.uid, name: a.name, text: clean, ts: Date.now() });
}

export function subscribeChat(code: string, cb: (msgs: ChatMessage[]) => void, onError?: (e: Error) => void): Unsubscribe {
  return onValue(
    query(ref(fb().rtdb, `chats/${code}`), limitToLast(HISTORY)),
    (snap) => {
      const msgs: ChatMessage[] = [];
      snap.forEach((child) => {
        msgs.push({ id: child.key!, ...(child.val() as Omit<ChatMessage, "id">) });
      });
      cb(msgs);
    },
    onError,
  );
}

/** Called after the lobby itself is deleted. */
export async function deleteChat(code: string): Promise<void> {
  await remove(ref(fb().rtdb, `chats/${code}`));
}
