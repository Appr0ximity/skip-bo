"use client";

import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator, type Firestore } from "firebase/firestore";
import { getDatabase, connectDatabaseEmulator, type Database } from "firebase/database";

// NEXT_PUBLIC_* values are inlined at build time. They identify your Firebase
// project and are safe to ship to browsers — the security rules protect the data.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const useEmulators = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

/** False until the Firebase env vars are set — the sign-in screen then explains setup. */
export const firebaseEnabled = Boolean(config.apiKey && config.projectId && config.databaseURL);

let services: { app: FirebaseApp; auth: Auth; db: Firestore; rtdb: Database } | null = null;

export function fb() {
  if (!firebaseEnabled) throw new Error("Firebase is not configured.");
  if (services) return services;
  const app = getApps()[0] ?? initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const rtdb = getDatabase(app);
  if (useEmulators) {
    const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectDatabaseEmulator(rtdb, host, 9000);
  }
  services = { app, auth, db, rtdb };
  return services;
}
