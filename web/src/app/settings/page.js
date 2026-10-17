'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';

export default function Settings() {
  const { status, reloadStatus, user } = useApp();
  const [form, setForm] = useState(status.settings);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/settings', { method: 'PUT', body: form });
      setMsg('Saqlandi');
      reloadStatus();
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Sozlamalar</h1>
      {error && <div className="flash error">{error}</div>}
      <form className="card" onSubmit={save}>
        <h2>Umumiy</h2>
        <div className="grid">
          <label>Tashkilot nomi<input value={form.organizationName || ''} onChange={set('organizationName')} /></label>
          <label>Kechikish hisoblanmaydigan vaqt (daqiqa)<input type="number" min="0" value={form.lateGraceMinutes} onChange={set('lateGraceMinutes')} /></label>
          <label>Takroriy skanlarni e&apos;tiborsiz qoldirish (soniya)<input type="number" min="0" value={form.debounceSeconds} onChange={set('debounceSeconds')} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.autoTimeSync} onChange={set('autoTimeSync')} /> Terminallar soatini avtomatik to&apos;g&apos;rilash
          </label>
        </div>
        <h2 style={{ marginTop: 16 }}>Telegram kunlik hisobot</h2>
        {!status.telegram && <p className="warn">Telegram bot sozlanmagan — <code>server\.env</code> faylida <code>BOT_TOKEN</code> va <code>ADMIN_TELEGRAM_IDS</code> ni kiriting (README).</p>}
        <div className="grid">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.dailyReportEnabled} onChange={set('dailyReportEnabled')} /> Har kuni hisobot yuborish
          </label>
          <label>Yuborish vaqti<input type="time" value={form.dailyReportTime} onChange={set('dailyReportTime')} /></label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button>Saqlash</button> <span className="ok">{msg}</span></div>
      </form>

      <Users me={user} />

      <div className="card">
        <h2>Zaxira nusxa</h2>
        <p>Baza har kuni avtomatik nusxalanadi (<code>server\data\backups</code>, oxirgi 30 kun). Qo&apos;shimcha nusxani fleshkaga saqlab qo&apos;yish tavsiya etiladi.</p>
        <a className="btn secondary" href="/api/backup">💾 Hozirgi bazani yuklab olish</a>
      </div>

      <div className="card">
        <h2>Tizim</h2>
        <p>
          Server: <b>{status.hostname}</b> · versiya {status.version}<br />
          Tarmoqdagi manzil: {(status.ips || []).map((ip) => <code key={ip} style={{ marginRight: 6 }}>http://{ip}:{status.port}</code>)}<br />
          <span className="hint">Shu manzil orqali maktab tarmog&apos;idagi boshqa kompyuter yoki telefondan ham kirish mumkin.</span>
        </p>
      </div>
    </>
  );
}

function Users({ me }) {
  const { data: users, reload } = useApi('/users');
  const [form, setForm] = useState({ username: '', name: '', password: '' });
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/users', { method: 'POST', body: form });
      setForm({ username: '', name: '', password: '' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePassword(u) {
    const p = prompt(`${u.username} uchun yangi parol (kamida 6 belgi):`);
    if (!p) return;
    try {
      await api(`/users/${u.id}/password`, { method: 'PUT', body: { password: p } });
      alert('Parol o\'zgartirildi');
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(u) {
    if (!confirm(`${u.username} o'chirilsinmi?`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Foydalanuvchilar</h2>
      {error && <div className="flash error">{error}</div>}
      <table>
        <thead><tr><th>Login</th><th>Ism</th><th></th></tr></thead>
        <tbody>
          {(users || []).map((u) => (
            <tr key={u.id}>
              <td>{u.username} {u.id === me.id && <span className="pill muted">siz</span>}</td><td>{u.name}</td>
              <td className="row">
                <button className="secondary small" onClick={() => changePassword(u)}>Parolni o&apos;zgartirish</button>
                {u.id !== me.id && <button className="secondary small" onClick={() => remove(u)}>O&apos;chirish</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row" style={{ marginTop: 12 }} onSubmit={add}>
        <label>Login<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>Ism<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Parol<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required /></label>
        <button>+ Qo&apos;shish</button>
      </form>
    </div>
  );
}
