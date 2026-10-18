'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { localDateTime } from '@/lib/time';
import { DeviceStatus, ErrorBox } from '@/components/ui';
import DoorButtons from '@/components/DoorButtons';

const DIRECTIONS = {
  in: '➡️ Kirish — har skan "keldi"',
  out: '⬅️ Chiqish — har skan "ketdi"',
  auto: '🔁 Avtomatik (bitta eshik) — skanlar navbat bilan: "keldi", "ketdi", "keldi"…',
};

export default function Devices() {
  const { status } = useApp();
  const { data: devices, error, reload } = useApi('/devices', { refreshMs: 5000 });
  const [editing, setEditing] = useState(null);
  const serverIp = (status.ips && status.ips[0]) || 'SERVER_KOMPYUTER_IP';

  async function resync(d) {
    if (!confirm(`"${d.name}" ga barcha xodim va yuzlar qayta yuboriladi.\nTerminalda bo'lib, tizimda yo'q odamlar terminaldan o'chiriladi. Davom etasizmi?`)) return;
    try {
      await api(`/devices/${d.id}/resync`, { method: 'POST' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <>
      <div className="row between"><h1>Terminallar</h1>
        <button onClick={() => setEditing({ name: '', ip: '', port: 80, username: 'admin', password: '', direction: 'in' })}>+ Terminal qo&apos;shish</button>
      </div>
      <ErrorBox error={error} />
      {(devices || []).map((d) => (
        <div className="card" key={d.id}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{d.name} <DeviceStatus device={d} /></h2>
            <div className="row">
              <button className="secondary small" onClick={() => setEditing(d)}>Tahrirlash</button>
              <button className="secondary small" title="Barcha xodim va yuzlarni terminalga qaytadan yuborish; tizimda yo'q odamlarni terminaldan o'chirish" onClick={() => resync(d)}>🔄 Qayta yuborish</button>
            </div>
          </div>
          <p>
            {DIRECTIONS[d.direction] || d.direction}<br />
            IP: <code>{d.ip}</code>
            {d.model && <> · Model: {d.model}</>}
            {d.firmware && <span className="muted"> · {d.firmware}</span>}
            {d.lastCheckAt && <span className="muted"> · tekshirildi: {localDateTime(d.lastCheckAt)}</span>}
          </p>
          {d.online === false && <p className="bad">✗ {d.lastError}</p>}
          <p><DoorButtons device={d} onDone={reload} /></p>
          {d.doorMode === 'alwaysOpen' && <p className="flash warn">🚪 Eshik <b>doimiy ochiq</b> rejimida — &quot;Odatiy holat&quot; ni bosing.</p>}
          {d.accessPlanError && (
            <p className="warn">⚠️ Terminal kirish ruxsati jadvallarini qabul qilmadi ({d.accessPlanError}) — bu terminalda hamma istalgan vaqtda kira oladi.
              Proshivkani yangilab, &quot;Qayta yuborish&quot; ni bosing.</p>
          )}
          {d.online && (
            <p className="muted">
              {d.lastPollAt ? <>📥 Eventlar terminal xotirasidan o&apos;qilmoqda (oxirgi: {localDateTime(d.lastPollAt)})</> : <>📥 Eventlarni o&apos;qish boshlanmoqda…</>}
              {d.lastPushAt && <> · 📡 HTTP Listening: {localDateTime(d.lastPushAt)}</>}
            </p>
          )}
          {d.clockFixedAt && <p className="muted">🕐 Terminal soati avtomatik to&apos;g&apos;rilangan: {localDateTime(d.clockFixedAt)}</p>}
          {d.resyncRequestedAt && d.resyncDoneFor !== d.resyncRequestedAt && <p className="warn">⏳ Qayta yuborish navbatda…</p>}
          <details>
            <summary>Terminalda sozlash (HTTP Listening)</summary>
            <p>Terminal web sahifasi (<code>http://{d.ip}</code>) → <b>Configuration → Network → Advanced → HTTP Listening</b>, bo&apos;sh qatorga:</p>
            <table><tbody>
              <tr><th>Destination IP or Host Name</th><td><code>{serverIp}</code></td></tr>
              <tr><th>URL</th><td><code>/hik/{d.id}/event</code></td></tr>
              <tr><th>Port</th><td><code>{status.port}</code></td></tr>
              <tr><th>Protocol</th><td><code>HTTP</code></td></tr>
            </tbody></table>
            <p className="hint">Keyin <b>Save</b>. Server kompyuterining IP manzili o&apos;zgarmasligi kerak (routerda doimiy IP bering).</p>
          </details>
        </div>
      ))}
      {devices && !devices.length && <div className="card muted">Hali terminal qo&apos;shilmagan.</div>}
      {editing && <DeviceForm device={editing} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
    </>
  );
}

function DeviceForm({ device, onClose }) {
  const [form, setForm] = useState({ ...device, password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (device.id) await api(`/devices/${device.id}`, { method: 'PUT', body: form });
      else await api('/devices', { method: 'POST', body: form });
      onClose(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`"${device.name}" o'chirilsinmi? (Terminaldagi xodimlar o'chirilmaydi)`)) return;
    try {
      await api(`/devices/${device.id}`, { method: 'DELETE' });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{device.id ? 'Terminalni tahrirlash' : 'Yangi terminal'}</h2>
        {error && <div className="flash error">{error}</div>}
        <div className="grid">
          <label>Nomi<input value={form.name} onChange={set('name')} placeholder="Kirish eshigi" required /></label>
          <label>IP manzil<input value={form.ip} onChange={set('ip')} placeholder="192.168.31.68" required /></label>
          <label>Port<input type="number" value={form.port} onChange={set('port')} /></label>
          <label>Login<input value={form.username} onChange={set('username')} autoComplete="off" /></label>
          <label>Parol<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password"
            placeholder={device.hasPassword ? 'o\'zgartirmaslik uchun bo\'sh qoldiring' : 'Terminal admin paroli'} /></label>
          <label>Yo&apos;nalish<select value={form.direction} onChange={set('direction')}>
            {Object.entries(DIRECTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        </div>
        <p className="hint">Login va parol — terminalning web sahifasiga kiradigan admin login/paroli. Ular orqali xodim va yuzlar terminalga yoziladi.</p>
        <div className="row">
          <button disabled={busy}>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {device.id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
