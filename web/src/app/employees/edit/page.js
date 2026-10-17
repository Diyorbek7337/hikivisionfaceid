'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  collection, doc, getDoc, runTransaction, serverTimestamp, increment, deleteDoc,
} from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import FacePicker from '@/components/FacePicker';
import { parseHHMM } from '@/lib/time';

export default function Page() {
  return <Suspense fallback={<p className="muted">Yuklanmoqda…</p>}><EmployeeForm /></Suspense>;
}

const EMPTY = {
  name: '', position: '', phone: '', telegramChatId: '', workStart: '09:00', workEnd: '18:00', hourlyRate: 0, active: true,
};

function EmployeeForm() {
  const { db } = useApp();
  const router = useRouter();
  const id = useSearchParams().get('id');
  const [form, setForm] = useState(EMPTY);
  const [original, setOriginal] = useState(null);
  const [face, setFace] = useState(null);
  const [faceChanged, setFaceChanged] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    (async () => {
      const snap = await getDoc(doc(db, 'employees', id));
      if (!snap.exists()) { setError('Xodim topilmadi'); setLoading(false); return; }
      const data = snap.data();
      setOriginal({ id, ...data });
      setForm({ ...EMPTY, ...data });
      const f = await getDoc(doc(db, 'employeeFaces', id));
      if (f.exists()) setFace(f.data().image);
      setLoading(false);
    })().catch((e) => { setError(e.message); setLoading(false); });
  }, [db, id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError('');
    const data = {
      name: form.name.trim(),
      position: (form.position || '').trim(),
      phone: (form.phone || '').trim(),
      telegramChatId: (form.telegramChatId || '').trim(),
      workStart: form.workStart,
      workEnd: form.workEnd,
      hourlyRate: Math.max(0, Math.round(Number(form.hourlyRate) || 0)),
      active: !!form.active,
    };
    if (!data.name) return setError('Ismni kiriting');
    if (parseHHMM(data.workStart) == null || parseHHMM(data.workEnd) == null) return setError('Ish vaqtini to\'g\'ri kiriting');
    if (data.telegramChatId && !/^-?\d+$/.test(data.telegramChatId)) return setError('Telegram chat ID faqat raqam bo\'ladi');

    setSaving(true);
    try {
      await runTransaction(db, async (tx) => {
        let ref;
        if (id) {
          ref = doc(db, 'employees', id);
          tx.update(ref, {
            ...data, version: increment(1), updatedAt: serverTimestamp(),
            ...(faceChanged ? { hasFace: !!face } : {}),
          });
        } else {
          const counterRef = doc(db, 'counters', 'employees');
          const counter = await tx.get(counterRef);
          const next = (counter.exists() ? counter.data().next : 1) || 1;
          ref = doc(collection(db, 'employees'));
          tx.set(counterRef, { next: next + 1 }, { merge: true });
          tx.set(ref, {
            ...data, employeeNo: String(next), hasFace: !!face, deleted: false, version: 1, deviceSync: {},
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          });
        }
        if (faceChanged || !id) {
          const faceRef = doc(db, 'employeeFaces', ref.id);
          if (face) tx.set(faceRef, { image: face, updatedAt: serverTimestamp() });
          else if (id) tx.delete(faceRef);
        }
      });
      router.push('/employees/');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`${original.name} o'chirilsinmi? U terminallardan ham o'chiriladi. Davomat tarixi saqlanib qoladi.`)) return;
    setSaving(true);
    try {
      await runTransaction(db, async (tx) => {
        tx.update(doc(db, 'employees', id), {
          deleted: true, active: false, hasFace: false, version: increment(1), updatedAt: serverTimestamp(),
        });
      });
      await deleteDoc(doc(db, 'employeeFaces', id)).catch(() => {});
      router.push('/employees/');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Yuklanmoqda…</p>;

  return (
    <>
      <h1>{id ? `Xodimni tahrirlash — ID ${original ? original.employeeNo : ''}` : 'Yangi xodim'}</h1>
      {error && <div className="flash error">{error}</div>}
      <form onSubmit={save}>
        <div className="card">
          <h2>Yuz rasmi</h2>
          <FacePicker value={face} onChange={(v) => { setFace(v); setFaceChanged(true); }} />
        </div>
        <div className="card grid">
          <label>Ism familiya *<input value={form.name} onChange={set('name')} required /></label>
          <label>Lavozim<input value={form.position} onChange={set('position')} /></label>
          <label>Telefon<input value={form.phone} onChange={set('phone')} /></label>
          <label>Ish boshlanishi *<input type="time" value={form.workStart} onChange={set('workStart')} required /></label>
          <label>Ish tugashi *<input type="time" value={form.workEnd} onChange={set('workEnd')} required /></label>
          <label>Soatbay stavka (so&apos;m)<input type="number" min="0" step="1" value={form.hourlyRate} onChange={set('hourlyRate')} /></label>
          <label>Telegram chat ID<input value={form.telegramChatId} onChange={set('telegramChatId')} placeholder="Bot /start da ko'rsatadi" /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.active} onChange={set('active')} /> Faol (terminal taniydi)
          </label>
        </div>
        <div className="row">
          <button disabled={saving}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          <Link className="btn secondary" href="/employees/">Bekor qilish</Link>
          {id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove} disabled={saving}>O&apos;chirish</button>}
        </div>
      </form>
      <p className="hint" style={{ marginTop: 16 }}>
        Saqlangach, ko&apos;prik xodimni va uning yuzini barcha terminallarga avtomatik yuboradi.
        &quot;Faol&quot; belgisi olib tashlansa, xodim terminallardan o&apos;chiriladi (tarixi saqlanadi).
      </p>
    </>
  );
}
