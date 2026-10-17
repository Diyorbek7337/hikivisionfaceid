'use client';
import { useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { useLiveQuery } from '@/lib/hooks';
import { localDateTime, toDate } from '@/lib/time';
import { DeviceStatus, ErrorBox } from '@/components/ui';

const DIRECTIONS = {
  in: '➡️ Kirish — har skan "keldi"',
  out: '⬅️ Chiqish — har skan "ketdi"',
  auto: '🔁 Avtomatik — kunning 1-skani "keldi", keyingilari "ketdi"',
};

export default function Devices() {
  const { db, bridge, bridgeOnline } = useApp();
  const [devices, loading, error] = useLiveQuery(() => collection(db, 'devices'), []);
  const [editing, setEditing] = useState(null);

  const bridgeIp = bridge && bridge.ips && bridge.ips[0];
  const bridgePort = (bridge && bridge.port) || 3000;

  return (
    <>
      <div className="row between"><h1>Terminallar</h1>
        <button onClick={() => setEditing({ name: '', ip: '', port: 80, username: 'admin', password: '', direction: 'in' })}>+ Terminal qo&apos;shish</button>
      </div>
      <ErrorBox error={error} />
      {!bridgeOnline && <div className="flash warn">⚠️ Ko&apos;prik dasturi ishlamayapti. Ofis kompyuterida <code>start-windows.bat</code> ni ishga tushiring — busiz terminallar bilan aloqa bo&apos;lmaydi.</div>}

      {devices.map((d) => (
        <div className="card" key={d.id}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{d.name} <DeviceStatus device={d} /></h2>
            <div className="row">
              <button className="secondary small" onClick={() => setEditing(d)}>Tahrirlash</button>
              <button className="secondary small" title="Barcha xodim va yuzlarni terminalga qaytadan yuborish"
                onClick={() => updateDoc(doc(db, 'devices', d.id), { resyncRequestedAt: serverTimestamp() })}>🔄 Qayta yuborish</button>
            </div>
          </div>
          <p>
            {DIRECTIONS[d.direction] || d.direction}<br />
            IP: <code>{d.ip || '—'}</code>
            {d.model && <> · Model: {d.model}</>}
            {d.firmware && <span className="muted"> · {d.firmware}</span>}
            {d.lastCheckAt && <span className="muted"> · tekshirildi: {localDateTime(d.lastCheckAt)}</span>}
          </p>
          {d.online === false && <p className="bad">✗ {d.lastError}</p>}
          {d.clockFixedAt && <p className="muted">🕐 Terminal soati avtomatik to&apos;g&apos;rilangan: {localDateTime(d.clockFixedAt)}</p>}
          {d.resyncRequestedAt && toDate(d.resyncRequestedAt) && d.resyncDoneFor !== toDate(d.resyncRequestedAt).getTime() && (
            <p className="warn">⏳ Qayta yuborish navbatda…</p>
          )}
          <details>
            <summary>Terminalda sozlash (HTTP Listening)</summary>
            <p>Terminal web sahifasi (<code>http://{d.ip || 'TERMINAL_IP'}</code>) → <b>Configuration → Network → Advanced → HTTP Listening</b>, bo&apos;sh qatorga:</p>
            <table><tbody>
              <tr><th>Destination IP or Host Name</th><td><code>{bridgeIp || 'KO‘PRIK KOMPYUTERI IP SI'}</code></td></tr>
              <tr><th>URL</th><td><code>/hik/{d.id}/event</code></td></tr>
              <tr><th>Port</th><td><code>{bridgePort}</code></td></tr>
              <tr><th>Protocol</th><td><code>HTTP</code></td></tr>
            </tbody></table>
            <p className="hint">Keyin <b>Save</b>. Ko&apos;prik kompyuterining IP manzili o&apos;zgarmasligi kerak (routerda doimiy IP bering).</p>
          </details>
        </div>
      ))}
      {!loading && !devices.length && <div className="card muted">Hali terminal qo&apos;shilmagan.</div>}

      {editing && <DeviceForm db={db} device={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function DeviceForm({ db, device, onClose }) {
  const [form, setForm] = useState({ ...device });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const data = {
      name: form.name.trim() || 'Terminal',
      ip: form.ip.trim(),
      port: Number(form.port) || 80,
      username: form.username.trim() || 'admin',
      password: form.password,
      direction: form.direction,
    };
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(data.ip) && !/^[\w.-]+$/.test(data.ip)) return setError('IP manzil noto\'g\'ri (masalan 192.168.31.68)');
    setBusy(true);
    try {
      if (device.id) {
        await updateDoc(doc(db, 'devices', device.id), { ...data, online: null, lastError: '' });
      } else {
        await addDoc(collection(db, 'devices'), { ...data, createdAt: serverTimestamp() });
      }
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`"${device.name}" o'chirilsinmi? (Terminaldagi xodimlar o'chirilmaydi)`)) return;
    await deleteDoc(doc(db, 'devices', device.id));
    onClose();
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{device.id ? 'Terminalni tahrirlash' : 'Yangi terminal'}</h2>
        {error && <div className="flash error">{error}</div>}
        <div className="grid">
          <label>Nomi<input value={form.name} onChange={set('name')} placeholder="Kirish eshigi" required /></label>
          <label>IP manzil<input value={form.ip} onChange={set('ip')} placeholder="192.168.31.68" required /></label>
          <label>Port<input type="number" value={form.port} onChange={set('port')} /></label>
          <label>Login<input value={form.username} onChange={set('username')} autoComplete="off" /></label>
          <label>Parol<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="Terminal admin paroli" /></label>
          <label>Yo&apos;nalish<select value={form.direction} onChange={set('direction')}>
            {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        </div>
        <p className="hint">Login va parol — terminalning web sahifasiga kiradigan (SADP da aktivlashtirilgan) admin login/paroli. Ko&apos;prik ular orqali xodim va yuzlarni terminalga yozadi.</p>
        <div className="row">
          <button disabled={busy}>Saqlash</button>
          <button type="button" className="secondary" onClick={onClose}>Bekor qilish</button>
          {device.id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
