'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc } from 'firebase/firestore';
import { initFirebase } from '@/lib/firebase';
import { useLiveDoc } from '@/lib/hooks';
import { toDate } from '@/lib/time';
import Login from './Login';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const DEFAULT_SETTINGS = { lateGraceMinutes: 5, debounceSeconds: 60, autoTimeSync: true };

const LINKS = [
  ['/', 'Bugun'],
  ['/employees/', 'Xodimlar'],
  ['/reports/', 'Hisobot'],
  ['/devices/', 'Terminallar'],
  ['/events/', 'Eventlar'],
  ['/settings/', 'Sozlamalar'],
];

export default function AppShell({ children }) {
  const [fb, setFb] = useState(null);
  const [initError, setInitError] = useState(null);
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    initFirebase().then(setFb).catch((e) => setInitError(e.message));
  }, []);

  useEffect(() => {
    if (!fb) return undefined;
    return onAuthStateChanged(fb.auth, (u) => setUser(u || null));
  }, [fb]);

  if (initError) {
    return (
      <main className="center"><div className="card" style={{ maxWidth: 560 }}>
        <h1>Firebase sozlanmagan</h1>
        <p className="bad">{initError}</p>
        <p>Firebase Console → Project settings → General → Your apps → Web app konfiguratsiyasini
          <code>bridge/firebase-web-config.json</code> fayliga JSON ko&apos;rinishida yozing va ko&apos;prikni qayta ishga tushiring.
          Batafsil: README.</p>
      </div></main>
    );
  }
  if (!fb || user === undefined) return <main className="center"><p className="muted">Yuklanmoqda…</p></main>;
  if (!user) return <Login auth={fb.auth} />;
  return <AdminGate fb={fb} user={user}>{children}</AdminGate>;
}

function AdminGate({ fb, user, children }) {
  const [adminDoc, loading] = useLiveDoc(() => doc(fb.db, 'admins', user.uid), [user.uid]);
  const [settingsDoc] = useLiveDoc(() => (adminDoc ? doc(fb.db, 'settings', 'general') : null), [!!adminDoc]);
  const [bridge] = useLiveDoc(() => (adminDoc ? doc(fb.db, 'system', 'bridge') : null), [!!adminDoc]);
  const pathname = usePathname();

  if (loading) return <main className="center"><p className="muted">Yuklanmoqda…</p></main>;
  if (!adminDoc) {
    return (
      <main className="center"><div className="card" style={{ maxWidth: 560 }}>
        <h1>Ruxsat yo&apos;q</h1>
        <p>Siz <b>{user.email}</b> sifatida kirdingiz, lekin bu hisob administratorlar ro&apos;yxatida yo&apos;q.</p>
        <p>Ko&apos;prikning <code>bridge/.env</code> faylidagi <code>ADMIN_EMAILS=</code> qatoriga shu emailni yozing
          va ko&apos;prikni qayta ishga tushiring. Bu sahifa o&apos;zi yangilanadi.</p>
        <button className="secondary" onClick={() => signOut(fb.auth)}>Chiqish</button>
      </div></main>
    );
  }

  const settings = { ...DEFAULT_SETTINGS, ...(settingsDoc || {}) };
  const beat = bridge && toDate(bridge.heartbeatAt);
  const bridgeOnline = beat && Date.now() - beat.getTime() < 7 * 60 * 1000;

  return (
    <Ctx.Provider value={{ ...fb, user, settings, bridge, bridgeOnline }}>
      <header className="top"><nav className="nav">
        <span className="brand">📷 Davomat
          <span className={`pill ${bridgeOnline ? 'ok' : 'bad'}`} title="Ofis kompyuteridagi ko'prik dasturi">
            {bridgeOnline ? 'Ko\'prik ishlayapti' : 'Ko\'prik o\'chiq'}
          </span>
        </span>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'active' : ''}>{label}</Link>
        ))}
        <button className="secondary small" onClick={() => signOut(fb.auth)}>Chiqish</button>
      </nav></header>
      <main>{children}</main>
    </Ctx.Provider>
  );
}
