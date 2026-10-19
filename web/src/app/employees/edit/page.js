'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, useApi, faceUrl } from '@/lib/api';
import FacePicker from '@/components/FacePicker';
import { scheduleSummary, PAY_TYPES } from '@/components/ui';
import DaysEditor, { blankDays, FlexibleHint } from '@/components/DaysEditor';
import { classList } from '@/lib/people';

export default function Page() {
  return <Suspense fallback={<p className="muted">Yuklanmoqda…</p>}><EmployeeForm /></Suspense>;
}

const EMPTY = { kind: 'staff', className: '', name: '', position: '', phone: '', telegramChatId: '', scheduleId: '', personalSchedule: null, accessProfileId: '', payType: 'hourly', payRate: 0, active: true };

function EmployeeForm() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get('id');
  const { data: schedules } = useApi('/schedules');
  const { data: accessProfiles } = useApi('/access-profiles');
  const [form, setForm] = useState(() => ({ ...EMPTY, kind: params.get('kind') === 'student' ? 'student' : 'staff' }));
  const { data: people } = useApi('/employees');
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
      setForm({ ...EMPTY, ...e, scheduleId: e.scheduleId || '', accessProfileId: e.accessProfileId || '' });
      setLoading(false);
    }).catch((e) => { if (e.status === 404 || e.status === 400) setNotFound(true); else setError(e.message); setLoading(false); });
  }, [id]);

  const student = form.kind === 'student';
  const listUrl = student ? '/employees/?kind=student' : '/employees/';
  // shared = a schedule from "Jadvallar"; personal = own days and hours; flexible = comes when needed
  const own = form.personalSchedule;
  const mode = !own ? 'shared' : own.type === 'flexible' ? 'flexible' : 'personal';
  function setMode(m) {
    setForm((f) => {
      if (m === 'shared') return { ...f, personalSchedule: null };
      let days = f.personalSchedule && f.personalSchedule.days;
      if (!days || !Object.values(days).some(Boolean)) {
        // start from the shared schedule the employee had, so only the differences need editing
        const base = (schedules || []).find((s) => String(s.id) === String(f.scheduleId)) || (schedules || [])[0];
        days = base && base.type !== 'flexible' ? JSON.parse(JSON.stringify(base.days)) : blankDays();
      }
      return { ...f, personalSchedule: { type: m === 'flexible' ? 'flexible' : 'fixed', days } };
    });
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const body = { ...form, scheduleId: form.scheduleId ? Number(form.scheduleId) : null, accessProfileId: form.accessProfileId ? Number(form.accessProfileId) : null };
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
      router.push(listUrl);
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
      router.push(listUrl);
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
      <h1>{id ? `${student ? 'O\'quvchini' : 'Xodimni'} tahrirlash — ID ${original ? original.employeeNo : ''}` : student ? 'Yangi o\'quvchi' : 'Yangi xodim'}</h1>
      {error && <div className="flash error">{error}</div>}
      <form onSubmit={save}>
        <div className="card">
          <h2>Yuz rasmi</h2>
          <FacePicker src={src} onChange={setFace} />
        </div>
        <div className="card grid">
          <div className="row" style={{ gap: 16, gridColumn: '1 / -1' }}>
            <label className="inline"><input type="radio" checked={!student} onChange={() => setForm((f) => ({ ...f, kind: 'staff' }))} /> Xodim</label>
            <label className="inline"><input type="radio" checked={student} onChange={() => setForm((f) => ({ ...f, kind: 'student' }))} /> O&apos;quvchi</label>
          </div>
          <label>F.I.Sh. *<input value={form.name} onChange={set('name')} maxLength={100} required /></label>
          {student ? (
            <label>Sinf *<input value={form.className} onChange={set('className')} list="classes" maxLength={20} placeholder="Masalan: 9-A" required />
              <datalist id="classes">{classList(people).map((c) => <option key={c} value={c} />)}</datalist></label>
          ) : (
            <label>Lavozim<input value={form.position} onChange={set('position')} maxLength={100} placeholder="O'qituvchi, qorovul…" /></label>
          )}
          <label>Telefon<input value={form.phone} onChange={set('phone')} maxLength={30} /></label>
          {!student && <><label>To&apos;lov<select value={form.payType} onChange={set('payType')}>
            {PAY_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select></label>
          <label>Stavka (so&apos;m {(PAY_TYPES.find(([k]) => k === form.payType) || PAY_TYPES[0])[2]}iga)
            <input type="number" min="0" step="1" value={form.payRate} onChange={set('payRate')} placeholder="0 — hisoblanmaydi" /></label></>}
          <label>Eshikdan kirish<select value={form.accessProfileId} onChange={set('accessProfileId')}>
            <option value="">Istalgan vaqtda</option>
            {(accessProfiles || []).map((p) => <option key={p.id} value={p.id}>{p.name} — {scheduleSummary(p)}</option>)}
          </select></label>
          {!student && <label>Telegram chat ID<input value={form.telegramChatId} onChange={set('telegramChatId')} placeholder="Bot /start da ko'rsatadi" /></label>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.active} onChange={set('active')} /> Faol (terminal taniydi)
          </label>
        </div>
        <div className="card">
          <h2>Ish jadvali</h2>
          <div className="row" style={{ gap: 16, marginBottom: 8 }}>
            <label className="inline"><input type="radio" checked={mode === 'shared'} onChange={() => setMode('shared')} /> Umumiy jadval</label>
            <label className="inline"><input type="radio" checked={mode === 'personal'} onChange={() => setMode('personal')} /> Shaxsiy kunlar va soatlar</label>
            <label className="inline"><input type="radio" checked={mode === 'flexible'} onChange={() => setMode('flexible')} /> Erkin</label>
          </div>
          {mode === 'shared' && (
            <label>Jadval<select value={form.scheduleId} onChange={set('scheduleId')}>
              {(schedules || []).map((s) => <option key={s.id} value={s.id}>{s.name} — {scheduleSummary(s)}</option>)}
            </select></label>
          )}
          {mode === 'personal' && (
            <>
              <p className="hint">Faqat shu xodim uchun: qaysi kunlari va soat nechada kelishi kerak. Belgilanmagan kunlar — dam olish
                (kelmasa &quot;kelmagan&quot; hisoblanmaydi).</p>
              <DaysEditor days={own.days} onChange={(days) => setForm((f) => ({ ...f, personalSchedule: { ...f.personalSchedule, days } }))} />
            </>
          )}
          {mode === 'flexible' && <FlexibleHint />}
        </div>
        <div className="row">
          <button disabled={saving}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          <Link className="btn secondary" href={listUrl}>Bekor qilish</Link>
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
