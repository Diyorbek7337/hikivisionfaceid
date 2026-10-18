'use client';
import { useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { formatDuration, localTime, money } from '@/lib/time';
import { ErrorBox } from '@/components/ui';

const pay = (r) => (r.workedMinutes && r.hourlyRate ? (r.workedMinutes / 60) * r.hourlyRate : 0);

export default function Reports() {
  const { status } = useApp();
  const today = status.today;
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState(`from=${today.slice(0, 8)}01&to=${today}`);
  const [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState(null);
  const { data, error, loading, reload } = useApi(`/report?${query}`);
  const { data: employees } = useApi('/employees');

  const records = useMemo(() => (data ? data.records : [])
    .filter((r) => !employeeId || String(r.employeeId) === employeeId), [data, employeeId]);
  const summary = (data ? data.summary : []).filter((s) => !employeeId || String(s.employeeId) === employeeId);
  const showPay = summary.some((s) => s.pay > 0);

  function exportCsv() {
    const cell = (v) => {
      let s = String(v ?? '');
      // Text starting with = + - @ would run as a formula in Excel (CSV injection); numbers are fine.
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const out = [];
    out.push([`Davomat hisoboti ${data.from} — ${data.to}`]);
    out.push([]);
    out.push(['Xodim', 'ID', 'Lavozim', 'Ish kunlari', 'Kelgan', 'Kelmagan', 'Kechikishlar', 'Jami kechikish (daq)', 'Erta ketishlar', 'Ishlagan (soat)', "Summa (so'm)"]);
    for (const s of summary) {
      out.push([s.name, s.employeeNo, s.position, s.flexible ? 'erkin' : s.workDays, s.presentDays, s.flexible ? '' : s.absentDays, s.lateCount, s.lateMinutes, s.earlyCount,
        (s.workedMinutes / 60).toFixed(2).replace('.', ','), Math.round(s.pay)]);
    }
    out.push([]);
    out.push(['Sana', 'Xodim', 'ID', 'Keldi', 'Ketdi', 'Kechikish (daq)', 'Erta ketish (daq)', 'Ishlagan (soat)', "Summa (so'm)", "Qo'lda"]);
    for (const r of [...records].reverse()) {
      out.push([r.date, r.employeeName, r.employeeNo, localTime(r.checkIn), localTime(r.checkOut), r.lateMinutes || 0, r.earlyMinutes || 0,
        r.workedMinutes != null ? (r.workedMinutes / 60).toFixed(2).replace('.', ',') : '', Math.round(pay(r)), r.manual ? 'ha' : '']);
    }
    const blob = new Blob([`﻿${out.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `davomat_${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const activeEmployees = (employees || []).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name));
  const allEmployees = (employees || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>Davomat hisoboti</h1>
      <ErrorBox error={error} />
      <div className="card row">
        <label>Dan<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Gacha<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Xodim<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Hammasi</option>
          {allEmployees.map((e) => <option key={e.id} value={String(e.id)}>{e.name}{e.active ? '' : ' (nofaol)'}</option>)}
        </select></label>
        <button onClick={() => (query === `from=${from}&to=${to}` ? reload() : setQuery(`from=${from}&to=${to}`))} disabled={loading}>
          {loading ? 'Yuklanmoqda…' : 'Ko\'rsatish'}
        </button>
        <button className="secondary" onClick={exportCsv} disabled={!data || data.from !== from || data.to !== to}
          title={data && (data.from !== from || data.to !== to) ? 'Avval "Ko\'rsatish" ni bosing' : ''}>Excel (CSV)</button>
        <button className="secondary" onClick={() => setEditing({ date: today })}>+ Qo&apos;lda qo&apos;shish</button>
      </div>

      <div className="card">
        <h2>Jami {data && <span className="muted">({data.from} — {data.to})</span>}</h2>
        <table>
          <thead><tr><th>Xodim</th><th>Ish kunlari</th><th>Kelgan</th><th>Kelmagan</th><th>Kechikishlar</th><th>Jami kechikish</th><th>Erta ketish</th><th>Ishlagan</th>{showPay && <th>Summa (so&apos;m)</th>}</tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.employeeId}>
                <td>{s.name}</td><td>{s.flexible ? <span className="muted" title="Erkin jadval">erkin</span> : s.workDays}</td><td>{s.presentDays}</td>
                <td className={s.absentDays ? 'bad' : ''}>{s.flexible && !s.absentDays ? <span className="muted">—</span> : s.absentDays}</td>
                <td className={s.lateCount ? 'warn' : ''}>{s.lateCount}</td><td>{formatDuration(s.lateMinutes)}</td>
                <td>{s.earlyCount}</td><td>{formatDuration(s.workedMinutes)}</td>{showPay && <td>{money(s.pay)}</td>}
              </tr>
            ))}
            {data && !summary.length && <tr><td colSpan={9} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Kunlar bo&apos;yicha</h2>
        <table>
          <thead><tr><th>Sana</th><th>Xodim</th><th>Keldi</th><th>Ketdi</th><th>Kechikish</th><th>Erta ketish</th><th>Ishlagan</th><th></th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.employeeName} {r.manual && <span className="pill muted" title="Qo'lda o'zgartirilgan">qo&apos;lda</span>}</td>
                <td>{localTime(r.checkIn) || <span className="muted">—</span>}</td>
                <td>{localTime(r.checkOut) || <span className="muted">—</span>}</td>
                <td>{r.lateMinutes > 0 && <span className="warn">{formatDuration(r.lateMinutes)}</span>}</td>
                <td>{r.earlyMinutes > 0 && <span className="warn">{formatDuration(r.earlyMinutes)}</span>}</td>
                <td>{r.workedMinutes != null ? formatDuration(r.workedMinutes) : ''}</td>
                <td><button className="secondary small" onClick={() => setEditing(r)}>Tahrirlash</button></td>
              </tr>
            ))}
            {data && !records.length && <tr><td colSpan={8} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecordForm record={editing} employees={activeEmployees} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
    </>
  );
}

function RecordForm({ record, employees, onClose }) {
  const isNew = !record.id;
  const [employeeId, setEmployeeId] = useState(record.employeeId ? String(record.employeeId) : '');
  const [date, setDate] = useState(record.date);
  const [checkIn, setCheckIn] = useState(localTime(record.checkIn));
  const [checkOut, setCheckOut] = useState(localTime(record.checkOut));
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    try {
      // editing a shown record replaces both times; "Qo'lda qo'shish" keeps the terminal's times for empty fields
      await api('/attendance', { method: 'PUT', body: { employeeId: Number(employeeId), date, checkIn, checkOut, replace: !isNew } });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm('Bu yozuv o\'chirilsinmi?')) return;
    try {
      await api(`/attendance/${record.id}`, { method: 'DELETE' });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{isNew ? 'Davomatni qo\'lda qo\'shish' : `${record.employeeName} — ${record.date}`}</h2>
        {error && <div className="flash error">{error}</div>}
        <div className="grid">
          {isNew && (
            <>
              <label>Xodim<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
                <option value="">Tanlang…</option>
                {employees.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
              </select></label>
              <label>Sana<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            </>
          )}
          <label>Keldi<input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></label>
          <label>Ketdi<input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></label>
        </div>
        <p className="hint">{isNew
          ? 'Masalan, xodim skan qilishni unutgan bo\'lsa. Bo\'sh qoldirilgan vaqt o\'zgarmaydi (terminal yozgani saqlanadi).'
          : 'Vaqtni o\'chirsangiz, u yozuvdan olib tashlanadi. Kechikish va ishlagan vaqt qayta hisoblanadi.'}</p>
        <div className="row">
          <button>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {!isNew && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
