'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

/** First run: create the first administrator (only allowed on the server computer itself). */
export default function Setup({ allowed, onDone }) {
  const [form, setForm] = useState({ organizationName: '', name: '', username: 'admin', password: '', password2: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (form.password !== form.password2) return setError('Parollar bir xil emas');
    try {
      await api('/setup', { method: 'POST', body: form });
      onDone();
    } catch (err) {
      setError(err.message);
    }
    return undefined;
  }

  if (!allowed) {
    return (
      <main className="center"><div className="card" style={{ maxWidth: 520 }}>
        <h1>Tizim hali sozlanmagan</h1>
        <p>Birinchi sozlashni server kompyuterining o&apos;zida, brauzerda <code>http://localhost:3000</code> ni ochib bajaring.</p>
      </div></main>
    );
  }
  return (
    <main className="center">
      <form className="card" style={{ width: 'min(460px, 100%)' }} onSubmit={submit}>
        <h1>👋 Birinchi sozlash</h1>
        <p className="muted">Tizim administratorini yarating. Keyin shu login bilan kirasiz.</p>
        {error && <div className="flash error">{error}</div>}
        <p><label>Tashkilot nomi<input value={form.organizationName} onChange={set('organizationName')} placeholder="Masalan: 21-maktab" /></label></p>
        <p><label>Ismingiz<input value={form.name} onChange={set('name')} /></label></p>
        <p><label>Login *<input value={form.username} onChange={set('username')} required /></label></p>
        <p><label>Parol * (kamida 6 belgi)<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required /></label></p>
        <p><label>Parolni takrorlang *<input type="password" value={form.password2} onChange={set('password2')} autoComplete="new-password" required /></label></p>
        <button style={{ width: '100%' }}>Yaratish va kirish</button>
      </form>
    </main>
  );
}
