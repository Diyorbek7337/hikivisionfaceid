'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  collection, deleteDoc, doc, getDocs, query, setDoc, serverTimestamp, where,
} from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { useLiveQuery } from '@/lib/hooks';
import {
  dateFromLocal, formatDuration, localDate, localTime, money, toDate,
} from '@/lib/time';
import { computeStats, salaryFor } from '@/lib/attendance';
import { ErrorBox } from '@/components/ui';

export default function Reports() {
  const { db, settings } = useApp();
  const today = localDate();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [employees] = useLiveQuery(() => collection(db, 'employees'), []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(query(collection(db, 'attendance'), where('date', '>=', from), where('date', '<=', to)));
      setRecords(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => records
    .filter((r) => !employeeId || r.employeeId === employeeId)
    .sort((a, b) => (a.date === b.date ? (a.employeeName || '').localeCompare(b.employeeName || '') : b.date.localeCompare(a.date))),
  [records, employeeId]);

  const summary = useMemo(() => {
    const m = new Map();
    for (const r of rows) {
      const s = m.get(r.employeeId) || { name: r.employeeName, no: r.employeeNo, days: 0, lateCount: 0, lateMinutes: 0, earlyCount: 0, worked: 0, pay: 0 };
      if (r.checkIn) s.days += 1;
      if (r.lateMinutes > 0) { s.lateCount += 1; s.lateMinutes += r.lateMinutes; }
      if (r.earlyMinutes > 0) s.earlyCount += 1;
      s.worked += r.workedMinutes || 0;
      s.pay += salaryFor(r);
      m.set(r.employeeId, s);
    }
    return [...m.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [rows]);

  function exportCsv() {
    const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [['Sana', 'Xodim', 'ID', 'Keldi', 'Ketdi', 'Kechikish (daq)', 'Erta ketish (daq)', 'Ishlagan (soat)', "Summa (so'm)"]];
    for (const r of [...rows].reverse()) {
      lines.push([r.date, r.employeeName, r.employeeNo, localTime(r.checkIn), localTime(r.checkOut), r.lateMinutes || 0,
        r.earlyMinutes || 0, r.workedMinutes != null ? (r.workedMinutes / 60).toFixed(2) : '', Math.round(salaryFor(r))]);
    }
    const blob = new Blob([`﻿${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `davomat_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const activeEmployees = employees.filter((e) => !e.deleted).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>Davomat hisoboti</h1>
      <ErrorBox error={error} />
      <div className="card row">
        <label>Dan<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Gacha<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label>Xodim<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Hammasi</option>
          {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select></label>
        <button onClick={load} disabled={loading}>{loading ? 'Yuklanmoqda…' : 'Ko\'rsatish'}</button>
        <button className="secondary" onClick={exportCsv} disabled={!rows.length}>Excel (CSV)</button>
        <button className="secondary" onClick={() => setEditing({ date: today })}>+ Qo&apos;lda qo&apos;shish</button>
      </div>

      <div className="card">
        <h2>Jami</h2>
        <table>
          <thead><tr><th>Xodim</th><th>Kelgan kunlar</th><th>Kechikishlar</th><th>Jami kechikish</th><th>Erta ketishlar</th><th>Ishlagan</th><th>Summa (so&apos;m)</th></tr></thead>
          <tbody>
            {summary.map((s) => (
              <tr key={`${s.no}-${s.name}`}><td>{s.name}</td><td>{s.days}</td><td>{s.lateCount}</td><td>{formatDuration(s.lateMinutes)}</td>
                <td>{s.earlyCount}</td><td>{formatDuration(s.worked)}</td><td>{money(s.pay)}</td></tr>
            ))}
            {!summary.length && <tr><td colSpan={7} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Kunlar bo&apos;yicha</h2>
        <table>
          <thead><tr><th>Sana</th><th>Xodim</th><th>Keldi</th><th>Ketdi</th><th>Kechikish</th><th>Erta ketish</th><th>Ishlagan</th><th>Summa</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.employeeName} {r.manual && <span className="pill muted" title="Qo'lda o'zgartirilgan">qo&apos;lda</span>}</td>
                <td>{localTime(r.checkIn) || <span className="muted">—</span>}</td>
                <td>{localTime(r.checkOut) || <span className="muted">—</span>}</td>
                <td>{r.lateMinutes > 0 && <span className="warn">{formatDuration(r.lateMinutes)}</span>}</td>
                <td>{r.earlyMinutes > 0 && <span className="warn">{formatDuration(r.earlyMinutes)}</span>}</td>
                <td>{r.workedMinutes != null ? formatDuration(r.workedMinutes) : ''}</td>
                <td>{money(salaryFor(r))}</td>
                <td><button className="secondary small" onClick={() => setEditing(r)}>Tahrirlash</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <RecordForm db={db} settings={settings} record={editing} employees={activeEmployees}
          onClose={(changed) => { setEditing(null); if (changed) load(); }} />
      )}
    </>
  );
}

function RecordForm({ db, settings, record, employees, onClose }) {
  const isNew = !record.id;
  const [employeeId, setEmployeeId] = useState(record.employeeId || '');
  const [date, setDate] = useState(record.date);
  const [inTime, setInTime] = useState(localTime(record.checkIn));
  const [outTime, setOutTime] = useState(localTime(record.checkOut));
  const [error, setError] = useState('');

  async function save(e) {
    e.preventDefault();
    const emp = employees.find((x) => x.id === employeeId);
    if (isNew && !emp) return setError('Xodimni tanlang');
    if (!inTime && !outTime) return setError('Kamida bitta vaqtni kiriting');
    const base = isNew ? {
      employeeId: emp.id, employeeNo: emp.employeeNo, employeeName: emp.name,
      workStart: emp.workStart, workEnd: emp.workEnd, hourlyRate: Number(emp.hourlyRate) || 0, date,
    } : { ...record, checkIn: toDate(record.checkIn), checkOut: toDate(record.checkOut) };
    delete base.id;
    const rec = computeStats({
      ...base,
      checkIn: inTime ? dateFromLocal(base.date, inTime) : null,
      checkOut: outTime ? dateFromLocal(base.date, outTime) : null,
    }, settings);
    if (rec.checkIn && rec.checkOut && rec.checkOut <= rec.checkIn) return setError('Ketish vaqti kelishdan keyin bo\'lishi kerak');
    try {
      await setDoc(doc(db, 'attendance', `${rec.employeeId}_${rec.date}`), { ...rec, manual: true, updatedAt: serverTimestamp() });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm('Bu yozuv o\'chirilsinmi?')) return;
    await deleteDoc(doc(db, 'attendance', record.id));
    onClose(true);
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
                {employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select></label>
              <label>Sana<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            </>
          )}
          <label>Keldi<input type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} /></label>
          <label>Ketdi<input type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} /></label>
        </div>
        <p className="hint">Masalan, xodim skan qilishni unutgan bo&apos;lsa. Kechikish va ishlagan vaqt qayta hisoblanadi.</p>
        <div className="row">
          <button>Saqlash</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {!isNew && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
