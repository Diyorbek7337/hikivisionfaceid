'use client';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';

let promise = null;

/**
 * Firebase config is loaded at runtime from /firebase-config.json
 * (served by the bridge from bridge/firebase-web-config.json, or web/public/firebase-config.json
 * when running `npm run dev` / hosting elsewhere). So the same build works with any project.
 */
export function initFirebase() {
  if (!promise) {
    promise = (async () => {
      const res = await fetch('/firebase-config.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('firebase-config.json topilmadi');
      const config = await res.json();
      if (!config.apiKey || !config.projectId) throw new Error('firebase-config.json noto\'g\'ri: apiKey va projectId kerak');
      const { useEmulators, ...firebaseConfig } = config;
      const app = getApps()[0] || initializeApp(firebaseConfig);
      const auth = getAuth(app);
      const db = getFirestore(app);
      if (useEmulators) {
        // Only for local testing with `firebase emulators:start`.
        connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        connectFirestoreEmulator(db, '127.0.0.1', 8080);
      }
      return { app, auth, db };
    })();
    promise.catch(() => { promise = null; });
  }
  return promise;
}
