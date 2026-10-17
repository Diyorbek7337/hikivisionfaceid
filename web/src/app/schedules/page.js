'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { ErrorBox, WEEKDAYS, scheduleSummary } from '@/components/ui';

export default function Schedules() {
  const { data, error, reload } = useApi('/schedules');
  const [editing, setEditing] = useState(null);
  const blank = () => ({
    name: '', days: Object.fromEntries(WEEKDAYS.map(([k]) => [k, k === '0' ? null : { start: '08:00', end: '17:00' }])),
  });

  return (
    <>
      <div className="row between"><h1>Ish jadvallari</h1><button onClick={() => setEditing(blank())}>+ Jadval qo&apos;shish</button></div>
      <p className="muted">Har bir xodimga jadval biriktiriladi (Xodimlar → Tahrirlash). Masalan: &quot;1-smena&quot;, &quot;2-smena&quot;, &quot;Ma&apos;muriyat&quot;, &quot;Qorovullar&quot;.
        Dam olish kunlari kechikish va kelmaganlik hisoblanmaydi. Birinchi jadval — jadvali tanlanmagan xodimlar uchun standart.</p>
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
    </>
  );
}

function ScheduleForm({ schedule, onClose }) {
  const [name, setName] = useState(schedule.name);
  const [days, setDays] = useState(() => JSON.parse(JSON.stringify(schedule.days)));
  const [error, setError] = useState('');

  const setDay = (k, v) => setDays((d) => ({ ...d, [k]: v }));
  function copyMonday() {
    const mon = days['1'];
    setDays((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v && mon ? { ...mon } : v])));
  }

  async function save(e) {
    e.preventDefault();
    try {
      if (schedule.id) await api(`/schedules/${schedule.id}`, { method: 'PUT', body: { name, days } });
      else await api('/schedules', { method: 'POST', body: { name, days } });
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
        <table>
          <thead><tr><th>Kun</th><th>Ish kuni</th><th>Boshlanishi</th><th>Tugashi</th></tr></thead>
          <tbody>
            {WEEKDAYS.map(([k, label]) => {
              const d = days[k];
              return (
                <tr key={k}>
                  <td>{label}</td>
                  <td><input type="checkbox" checked={!!d} onChange={(e) => setDay(k, e.target.checked ? { start: '08:00', end: '17:00' } : null)} /></td>
                  <td>{d ? <input type="time" value={d.start} onChange={(e) => setDay(k, { ...d, start: e.target.value })} required /> : <span className="muted">dam olish</span>}</td>
                  <td>{d && <input type="time" value={d.end} onChange={(e) => setDay(k, { ...d, end: e.target.value })} required />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p><button type="button" className="secondary small" onClick={copyMonday}>Dushanba vaqtini barcha ish kunlariga nusxalash</button></p>
        <div className="row">
          <button>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {schedule.id && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
