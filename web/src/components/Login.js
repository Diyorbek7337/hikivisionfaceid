'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

export default function Login({ onDone, embedded = false, message = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', body: { username, password } });
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const form = (
      <form className="card" style={{ width: embedded ? '100%' : 'min(380px, 100%)', margin: 0 }} onSubmit={submit}>
        <h1>📷 Davomat</h1>
        {message && <div className="flash warn">{message.replace(/&quot;/g, '"')}</div>}
        {error && <div className="flash error">{error}</div>}
        <p><label>Login<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label></p>
        <p><label>Parol<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label></p>
        <button style={{ width: '100%' }} disabled={busy}>{busy ? 'Kirilmoqda…' : 'Kirish'}</button>
        <p className="hint" style={{ textAlign: 'center', marginBottom: 0 }}>Parolni unutsangiz — boshqa administrator Sozlamalar sahifasida yangilaydi.</p>
      </form>
  );
  return embedded ? form : <main className="center">{form}</main>;
}
