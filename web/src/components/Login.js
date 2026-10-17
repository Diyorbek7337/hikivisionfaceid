'use client';
import { useState } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';

const MESSAGES = {
  'auth/invalid-credential': 'Email yoki parol noto\'g\'ri',
  'auth/wrong-password': 'Email yoki parol noto\'g\'ri',
  'auth/user-not-found': 'Bunday foydalanuvchi yo\'q',
  'auth/too-many-requests': 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring',
  'auth/invalid-email': 'Email noto\'g\'ri',
  'auth/network-request-failed': 'Internet ulanishini tekshiring',
};

export default function Login({ auth }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setInfo('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) { setError('Avval emailni yozing'); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo('Parolni tiklash havolasi emailingizga yuborildi');
      setError('');
    } catch (err) {
      setError(MESSAGES[err.code] || err.message);
    }
  }

  return (
    <main className="center">
      <form className="card" style={{ width: 'min(380px, 100%)' }} onSubmit={submit}>
        <h1>📷 Davomat</h1>
        {error && <div className="flash error">{error}</div>}
        {info && <div className="flash">{info}</div>}
        <p><label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label></p>
        <p><label>Parol<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label></p>
        <button style={{ width: '100%' }} disabled={busy}>{busy ? 'Kirilmoqda…' : 'Kirish'}</button>
        <p style={{ textAlign: 'center', marginBottom: 0 }}><a href="#" onClick={(e) => { e.preventDefault(); reset(); }}>Parolni unutdingizmi?</a></p>
      </form>
    </main>
  );
}
