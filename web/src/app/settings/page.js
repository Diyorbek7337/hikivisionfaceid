'use client';
import { useEffect, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { localDateTime } from '@/lib/time';

export default function Settings() {
  const { db, settings, bridge, bridgeOnline, user } = useApp();
  const [form, setForm] = useState(settings);
  const [msg, setMsg] = useState('');
  useEffect(() => { setForm(settings); }, [settings]);

  async function save(e) {
    e.preventDefault();
    await setDoc(doc(db, 'settings', 'general'), {
      lateGraceMinutes: Math.max(0, Number(form.lateGraceMinutes) || 0),
      debounceSeconds: Math.max(0, Number(form.debounceSeconds) || 0),
      autoTimeSync: !!form.autoTimeSync,
    }, { merge: true });
    setMsg('Saqlandi');
    setTimeout(() => setMsg(''), 2000);
  }

  return (
    <>
      <h1>Sozlamalar</h1>
      <form className="card" onSubmit={save}>
        <h2>Davomat qoidalari</h2>
        <div className="grid">
          <label>Kechikish hisoblanmaydigan vaqt (daqiqa)
            <input type="number" min="0" value={form.lateGraceMinutes} onChange={(e) => setForm({ ...form, lateGraceMinutes: e.target.value })} />
          </label>
          <label>Takroriy skanlarni e&apos;tiborsiz qoldirish (soniya)
            <input type="number" min="0" value={form.debounceSeconds} onChange={(e) => setForm({ ...form, debounceSeconds: e.target.value })} />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.autoTimeSync} onChange={(e) => setForm({ ...form, autoTimeSync: e.target.checked })} />
            Terminallar soatini avtomatik to&apos;g&apos;rilash (Toshkent vaqti)
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button>Saqlash</button> <span className="ok">{msg}</span></div>
      </form>
      <div className="card">
        <h2>Ko&apos;prik (ofis kompyuteri)</h2>
        {bridge ? (
          <p>
            Holat: {bridgeOnline ? <span className="pill ok">ishlayapti</span> : <span className="pill bad">o&apos;chiq</span>}<br />
            Oxirgi aloqa: {localDateTime(bridge.heartbeatAt)}<br />
            Manzil: {(bridge.ips || []).map((ip) => <code key={ip} style={{ marginRight: 6 }}>{ip}:{bridge.port}</code>)}<br />
            Versiya: {bridge.version}
          </p>
        ) : <p className="muted">Ko&apos;prik hali bir marta ham ulanmagan.</p>}
      </div>
      <div className="card">
        <h2>Hisob</h2>
        <p>{user.email}</p>
        <p className="hint">Yangi administrator qo&apos;shish: Firebase Console → Authentication → Add user, keyin emailni <code>bridge/.env</code> dagi <code>ADMIN_EMAILS</code> ga qo&apos;shib, ko&apos;prikni qayta ishga tushiring.</p>
      </div>
    </>
  );
}
