"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
} from "firebase/auth";
import { fb, firebaseEnabled } from "@/lib/firebase";
import { deleteCloudData, ensureCloudProfile, renameAccount, type Account } from "@/lib/data/store";
import { loginEmail, pinPassword } from "@/lib/accounts";


interface AccountCtx {
  account: Account | null;
  loading: boolean;
  firebaseEnabled: boolean;
  signIn(username: string, pin: string): Promise<void>;
  signUp(username: string, pin: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const Ctx = createContext<AccountCtx | null>(null);

export function useAccount() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccount must be used inside <AccountProvider>");
  return c;
}

/** Turn Firebase error codes into sentences people can act on. */
export function authMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Username or PIN is incorrect.",
    "auth/wrong-password": "Username or PIN is incorrect.",
    "auth/user-not-found": "Username or PIN is incorrect.",
    "auth/invalid-email": "Usernames are 3–20 letters, numbers, _ or -.",
    "auth/email-already-in-use": "That username is taken — pick another or sign in.",
    "auth/too-many-requests": "Too many wrong attempts. Wait a few minutes and try again.",
    "auth/requires-recent-login": "For safety, sign out and back in, then try again.",
    "auth/network-request-failed": "Network error — check your connection.",
  };
  return map[code] ?? (err instanceof Error ? err.message : "Something went wrong.");
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseEnabled) {
      // Nothing to sign in to until Firebase is configured; the sign-in screen explains.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    const { auth } = fb();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAccount(null);
        setLoading(false);
        return;
      }
      const fallback = user.displayName || user.email?.split("@")[0] || "Player";
      try {
        const { name } = await ensureCloudProfile(user.uid, fallback);
        setAccount({ uid: user.uid, name });
      } catch (e) {
        console.error("Could not load profile", e);
        setAccount({ uid: user.uid, name: fallback });
      }
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (username: string, pin: string) => {
    await signInWithEmailAndPassword(fb().auth, loginEmail(username), pinPassword(pin));
  }, []);

  const signUp = useCallback(async (username: string, pin: string) => {
    const name = username.trim();
    const cred = await createUserWithEmailAndPassword(fb().auth, loginEmail(name), pinPassword(pin));
    await updateProfile(cred.user, { displayName: name });
    // onAuthStateChanged may have created the profile before the display name was set;
    // store the username exactly as typed (login itself is case-insensitive).
    await ensureCloudProfile(cred.user.uid, name);
    await renameAccount({ uid: cred.user.uid, name }, name);
    setAccount((a) => (a && a.uid === cred.user.uid ? { ...a, name } : a));
  }, []);

  const signOut = useCallback(async () => {
    if (firebaseEnabled) await fbSignOut(fb().auth);
    setAccount(null);
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!account) return;
    const user = fb().auth.currentUser;
    if (!user) return;
    await deleteCloudData(user.uid);
    await deleteUser(user);
    setAccount(null);
  }, [account]);

  const value = useMemo(
    () => ({ account, loading, firebaseEnabled, signIn, signUp, signOut, deleteAccount }),
    [account, loading, signIn, signUp, signOut, deleteAccount],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
