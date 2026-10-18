'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { setTimezone } from '@/lib/time';
import Login from './Login';
import Setup from './Setup';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const LINKS = [
  ['/', 'Bugun'],
  ['/employees/', 'Xodimlar'],
  ['/faces/', 'Yuzlar'],
  ['/reports/', 'Hisobot'],
  ['/schedules/', 'Jadvallar'],
  ['/devices/', 'Terminallar'],
  ['/events/', 'Eventlar'],
  ['/settings/', 'Sozlamalar'],
];

export default function AppShell({ children }) {
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const pathname = usePathname();
  // The Telegram mini app (/tg) has its own login and layout.
  const miniApp = (pathname || '').startsWith('/tg');

  const refresh = useCallback(async () => {
    try {
      const s = await api('/session');
      setSession(s);
      setError('');
      if (s.user) {
        const st = await api('/status');
        setTimezone(st.timezone);
        setStatus(st);
      }
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (miniApp) return undefined;
    refresh();
    // Session ended while working: show the login on top of the page so typed data is not lost.
    const onUnauthorized = () => setExpired(true);
    window.addEventListener('davomat:unauthorized', onUnauthorized);
    return () => window.removeEventListener('davomat:unauthorized', onUnauthorized);
  }, [refresh, miniApp]);

  if (miniApp) return children;
  if (error) {
    return <main className="center"><div className="card"><h1>Xato</h1><p className="bad">{error}</p>
      <button onClick={refresh}>Qayta urinish</button></div></main>;
  }
  if (!session) return <main className="center"><p className="muted">Yuklanmoqda…</p></main>;
  if (session.needsSetup) return <Setup allowed={session.setupAllowed} onDone={refresh} />;
  if (!session.user) return <Login onDone={refresh} />;

  async function logout() {
    await api('/logout', { method: 'POST' }).catch(() => {});
    refresh();
  }

  const org = status && status.settings && status.settings.organizationName;
  return (
    <Ctx.Provider value={{ user: session.user, status, reloadStatus: refresh }}>
      <header className="top"><nav className="nav">
        <span className="brand">📷 {org || 'Davomat'}</span>
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'active' : ''}>{label}</Link>
        ))}
        <button className="secondary small" onClick={logout} title={session.user.username}>Chiqish</button>
      </nav></header>
      <main>{status ? children : <p className="muted">Yuklanmoqda…</p>}</main>
      {expired && (
        <div className="modal-back">
          <div className="modal" style={{ padding: 0 }}>
            <Login embedded message="Sessiya tugadi — qayta kiring. Kiritgan ma'lumotlaringiz saqlanib qoldi, kirgach yana &quot;Saqlash&quot; ni bosing."
              onDone={() => { setExpired(false); refresh(); }} />
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
