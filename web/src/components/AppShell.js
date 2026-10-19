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

/** Class teachers: only the pages about their own students. */
const TEACHER_LINKS = [['/', 'Bugun'], ['/faces/', 'Yuzlar'], ['/reports/', 'Hisobot'], ['/parents/', 'Ota-onalar']];
const TEACHER_PATHS = ['/', '/faces/', '/reports/', '/parents/'];

const LINKS = [
  ['/', 'Bugun'],
  ['/employees/', 'Xodimlar'],
  ['/faces/', 'Yuzlar'],
  ['/reports/', 'Hisobot'],
  ['/parents/', 'Ota-onalar'],
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
  const [pwOpen, setPwOpen] = useState(false);
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
  const teacher = session.user.role === 'teacher';
  const links = teacher ? TEACHER_LINKS : LINKS;
  const allowed = !teacher || TEACHER_PATHS.includes(pathname.endsWith('/') ? pathname : `${pathname}/`);
  return (
    <Ctx.Provider value={{ user: session.user, status, reloadStatus: refresh }}>
      <header className="top"><nav className="nav">
        <span className="brand">📷 {org || 'Davomat'}</span>
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={(href === '/' ? pathname === '/' : pathname.startsWith(href)) ? 'active' : ''}>{label}</Link>
        ))}
        {teacher && <span className="pill muted" title="Sinf rahbari">{(session.user.classes || []).join(', ')}</span>}
        <button className="secondary small" onClick={() => setPwOpen(true)} title="Parolni o'zgartirish">🔑</button>
        <button className="secondary small" onClick={logout} title={session.user.username}>Chiqish</button>
      </nav></header>
      <main>{!status ? <p className="muted">Yuklanmoqda…</p>
        : allowed ? children : <div className="card"><h1>Bu bo&apos;lim faqat administrator uchun</h1><Link href="/">← Bugun</Link></div>}</main>
      {pwOpen && <PasswordForm onClose={() => setPwOpen(false)} />}
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

/** Change own password (old one required). */
function PasswordForm({ onClose }) {
  const [f, setF] = useState({ oldPassword: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  async function save(e) {
    e.preventDefault();
    if (f.password !== f.again) { setError('Yangi parollar bir xil emas'); return; }
    try {
      await api('/users/me/password', { method: 'PUT', body: { oldPassword: f.oldPassword, password: f.password } });
      setDone(true);
    } catch (err) {
      setError(err.message);
    }
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save} style={{ maxWidth: 380 }}>
        <h2>Parolni o&apos;zgartirish</h2>
        {done ? <p className="ok">✅ Parol o&apos;zgartirildi</p> : (
          <>
            {error && <div className="flash error">{error}</div>}
            <p><label>Hozirgi parol<input type="password" value={f.oldPassword} onChange={set('oldPassword')} autoComplete="current-password" required /></label></p>
            <p><label>Yangi parol (kamida 6 belgi)<input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required /></label></p>
            <p><label>Yangi parol yana bir marta<input type="password" value={f.again} onChange={set('again')} autoComplete="new-password" required /></label></p>
          </>
        )}
        <div className="row">
          {!done && <button>Saqlash</button>}
          <button type="button" className="secondary" onClick={onClose}>Yopish</button>
        </div>
      </form>
    </div>
  );
}
