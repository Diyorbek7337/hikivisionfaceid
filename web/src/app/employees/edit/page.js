'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, useApi, faceUrl } from '@/lib/api';
import FacePicker from '@/components/FacePicker';
import { scheduleSummary } from '@/components/ui';

export default function Page() {
  return <Suspense fallback={<p className="muted">Yuklanmoqda…</p>}><EmployeeForm /></Suspense>;
}

const EMPTY = { name: '', position: '', phone: '', telegramChatId: '', scheduleId: '', hourlyRate: 0, active: true };

function EmployeeForm() {
  const router = useRouter();
  const id = useSearchParams().get('id');
  const { data: schedules } = useApi('/schedules');
  const [form, setForm] = useState(EMPTY);
  const [original, setOriginal] = useState(null);
  const [face, setFace] = useState(undefined); // undefined = unchanged, null = removed, string = new base64
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    api(`/employees/${id}`).then((e) => {
      setOriginal(e);
      setForm({ ...EMPTY, ...e, scheduleId: e.scheduleId || '' });
      setLoading(false);
    }).catch((e) => { if (e.status === 404 || e.status === 400) setNotFound(true); else setError(e.message); setLoading(false); });
  }, [id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, scheduleId: form.scheduleId ? Number(form.scheduleId) : null };
      if (id) {
        await api(`/employees/${id}`, { method: 'PUT', body });
        if (face !== undefined) await api(`/employees/${id}/face`, { method: 'PUT', body: { image: face } });
      } else {
        try {
          await api('/employees', { method: 'POST', body: { ...body, image: face || undefined } });
        } catch (err) {
          if (err.status !== 409 || !confirm(`${err.message}.\nBaribir yana bitta shunday xodim qo'shilsinmi?`)) throw err;
          await api('/employees', { method: 'POST', body: { ...body, image: face || undefined, allowDuplicate: true } });
        }
      }
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
      await api(`/employees/${id}`, { method: 'DELETE' });
      router.push('/employees/');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (loading) return <p className="muted">Yuklanmoqda…</p>;
  if (notFound) return <div className="card"><h1>Xodim topilmadi</h1><p>U o&apos;chirilgan bo&apos;lishi mumkin.</p><Link href="/employees/">← Xodimlar ro&apos;yxati</Link></div>;
  let src = null;
  if (face) src = `data:image/jpeg;base64,${face}`;
  else if (face === undefined && original && original.hasFace) src = faceUrl(original);

  return (
    <>
      <h1>{id ? `Xodimni tahrirlash — ID ${original ? original.employeeNo : ''}` : 'Yangi xodim'}</h1>
      {error && <div className="flash error">{error}</div>}
      <form onSubmit={save}>
        <div className="card">
          <h2>Yuz rasmi</h2>
          <FacePicker src={src} onChange={setFace} />
        </div>
        <div className="card grid">
          <label>F.I.Sh. *<input value={form.name} onChange={set('name')} maxLength={100} required /></label>
          <label>Lavozim<input value={form.position} onChange={set('position')} maxLength={100} placeholder="O'qituvchi, qorovul…" /></label>
          <label>Telefon<input value={form.phone} onChange={set('phone')} maxLength={30} /></label>
          <label>Ish jadvali<select value={form.scheduleId} onChange={set('scheduleId')}>
            {(schedules || []).map((s) => <option key={s.id} value={s.id}>{s.name} — {scheduleSummary(s)}</option>)}
          </select></label>
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
        Saqlangach, xodim va uning yuzi barcha terminallarga avtomatik yuboriladi. &quot;Faol&quot; belgisi olib tashlansa,
        xodim terminallardan o&apos;chiriladi (tarixi saqlanadi).
      </p>
    </>
  );
}
