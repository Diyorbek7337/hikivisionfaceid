'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { ErrorBox, scheduleSummary } from '@/components/ui';
import DaysEditor, { blankDays, TypeChoice, FlexibleHint } from '@/components/DaysEditor';

export default function Schedules() {
  const { data, error, reload } = useApi('/schedules');
  const [editing, setEditing] = useState(null);
  const blank = () => ({ name: '', type: 'fixed', days: blankDays() });

  return (
    <>
      <div className="row between"><h1>Ish jadvallari</h1><button onClick={() => setEditing(blank())}>+ Jadval qo&apos;shish</button></div>
      <p className="muted">Har bir xodimga jadval biriktiriladi (Xodimlar → Tahrirlash). Faqat o&apos;ziga xos kunlari keladigan xodimga
        (masalan, o&apos;qituvchi) xodim kartasining o&apos;zida &quot;shaxsiy jadval&quot; berish mumkin. Masalan: &quot;1-smena&quot;, &quot;2-smena&quot;, &quot;Ma&apos;muriyat&quot;, &quot;Qorovullar&quot;.
        Dam olish kunlari kechikish va kelmaganlik hisoblanmaydi. &quot;Erkin&quot; jadvalda esa umuman hisoblanmaydi. Birinchi jadval — jadvali tanlanmagan xodimlar uchun standart.</p>
      <ErrorBox error={error} />
      <div className="card">
        <table>
          <thead><tr><th>Nomi</th><th>Ish kunlari va vaqti</th><th>Xodimlar</th><th></th></tr></thead>
          <tbody>
            {(data || []).map((s, i) => (
              <tr key={s.id}>
                <td>{s.name} {i === 0 && <span className="pill muted">standart</span>}</td>
                <td>{scheduleSummary(s)}</td>
                <td>{s.employees}</td>
                <td><button className="secondary small" onClick={() => setEditing(s)}>Tahrirlash</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <ScheduleForm schedule={editing} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
      <AccessProfiles />
    </>
  );
}

/** Door entry schedules: when the entrance terminal opens the door for a person. */
function AccessProfiles() {
  const { data, error, reload } = useApi('/access-profiles');
  const [editing, setEditing] = useState(null);
  const blank = () => ({ name: '', days: Object.fromEntries(Object.entries(blankDays()).map(([k, v]) => [k, v && { start: '07:00', end: '19:00' }])) });
  return (
    <>
      <div className="row between" style={{ marginTop: 32 }}>
        <h2 style={{ margin: 0 }}>🚪 Eshikdan kirish ruxsati</h2>
        <button className="secondary" onClick={() => setEditing(blank())}>+ Ruxsat jadvali</button>
      </div>
      <p className="muted">Terminal eshikni qaysi kunlari va soatlarda ochishi. Xodimga biriktiriladi (Xodimlar → Tahrirlash → &quot;Eshikdan kirish&quot;).
        Biriktirilmagan xodim istalgan vaqtda kira oladi. Cheklov faqat <b>Kirish</b> (va Avtomatik) terminallarga qo&apos;yiladi — Chiqish
        terminali hammani istalgan vaqtda chiqaradi. Davomat hisobiga bu ta&apos;sir qilmaydi.</p>
      <ErrorBox error={error} />
      {data && data.length > 0 && (
        <div className="card">
          <table>
            <thead><tr><th>Nomi</th><th>Ruxsat vaqti</th><th>Xodimlar</th><th></th></tr></thead>
            <tbody>
              {data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{scheduleSummary(p)}</td><td>{p.employees}</td>
                  <td><button className="secondary small" onClick={() => setEditing(p)}>Tahrirlash</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <AccessForm profile={editing} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
    </>
  );
}

function AccessForm({ profile, onClose }) {
  const [name, setName] = useState(profile.name);
  const [days, setDays] = useState(() => JSON.parse(JSON.stringify(profile.days)));
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    try {
      if (profile.id) await api(`/access-profiles/${profile.id}`, { method: 'PUT', body: { name, days } });
      else await api('/access-profiles', { method: 'POST', body: { name, days } });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }
  async function remove() {
    if (!confirm(`"${profile.name}" o'chirilsinmi?`)) return;
    try {
      await api(`/access-profiles/${profile.id}`, { method: 'DELETE' });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{profile.id ? 'Ruxsat jadvalini tahrirlash' : 'Yangi ruxsat jadvali'}</h2>
        {error && <div className="flash error">{error}</div>}
        <p><label>Nomi<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Ish vaqtida" required /></label></p>
        <DaysEditor days={days} onChange={setDays} />
        <p className="hint">Belgilanmagan kunlari eshik bu xodimlarga ochilmaydi. O&apos;zgarish terminallarga avtomatik yoziladi.</p>
        <div className="row">
          <button>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {profile.id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}

function ScheduleForm({ schedule, onClose }) {
  const [name, setName] = useState(schedule.name);
  const [days, setDays] = useState(() => JSON.parse(JSON.stringify(schedule.days)));
  const [type, setType] = useState(schedule.type || 'fixed');
  const [error, setError] = useState('');


  async function save(e) {
    e.preventDefault();
    try {
      if (schedule.id) await api(`/schedules/${schedule.id}`, { method: 'PUT', body: { name, type, days } });
      else await api('/schedules', { method: 'POST', body: { name, type, days } });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm(`"${schedule.name}" o'chirilsinmi?`)) return;
    try {
      await api(`/schedules/${schedule.id}`, { method: 'DELETE' });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{schedule.id ? 'Jadvalni tahrirlash' : 'Yangi jadval'}</h2>
        {error && <div className="flash error">{error}</div>}
        <p><label>Nomi<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: 1-smena" required /></label></p>
        <TypeChoice type={type} onChange={setType} />
        {type === 'fixed' ? <DaysEditor days={days} onChange={setDays} /> : <FlexibleHint />}
        <div className="row">
          <button>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {schedule.id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
