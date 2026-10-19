'use client';
import { useCallback, useMemo, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { formatDuration, localTime, money } from '@/lib/time';
import { ErrorBox, rateText } from '@/components/ui';
import { SessionList, openCount, sessionsText } from '@/components/Sessions';
import { KindTabs, classList } from '@/lib/people';


export default function Reports() {
  const { status } = useApp();
  const today = status.today;
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [query, setQuery] = useState(`from=${today.slice(0, 8)}01&to=${today}`);
  const [employeeId, setEmployeeId] = useState('');
  const [editing, setEditing] = useState(null);
  const [openRow, setOpenRow] = useState(null);
  const [only, setOnly] = useState('');
  const { data, error, loading, reload } = useApi(`/report?${query}`);
  const { data: employees } = useApi('/employees');
  const [kind, setKind] = useState('staff');
  const [cls, setCls] = useState('');
  const hasStudents = (employees || []).some((e) => e.kind === 'student');
  const students = hasStudents && kind === 'student';
  const byId = useMemo(() => new Map((employees || []).map((e) => [e.id, e])), [employees]);
  // a person belongs to the chosen tab (and class); people not in the list (deleted) count as staff
  const inScope = useCallback((id) => {
    if (!hasStudents) return true;
    const e = byId.get(id);
    const isStud = !!e && e.kind === 'student';
    if (students !== isStud) return false;
    return !students || !cls || e.className === cls;
  }, [hasStudents, students, cls, byId]);

  const records = useMemo(() => (data ? data.records : [])
    .filter((r) => inScope(r.employeeId))
    .filter((r) => !employeeId || String(r.employeeId) === employeeId), [data, employeeId, inScope]);
  const summary = (data ? data.summary : []).filter((s) => inScope(s.employeeId)).filter((s) => !employeeId || String(s.employeeId) === employeeId)
    .filter((s) => !only || (only === 'absent' ? s.absentDays > 0 : s.lateCount > 0))
    .sort((a, b) => (only === 'absent' ? b.absentDays - a.absentDays : only === 'late' ? b.lateCount - a.lateCount : 0));
  const showPay = summary.some((s) => s.pay > 0);
  const openTotal = records.reduce((n, r) => n + openCount(r, today), 0);

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
    out.push([students ? "O'quvchi" : 'Xodim', 'ID', students ? 'Sinf' : 'Lavozim', 'Ish kunlari', 'Kelgan', 'Kelmagan', 'Kechikishlar', 'Jami kechikish (daq)', 'Erta ketishlar', 'Ishlagan (soat)', "Summa (so'm)"]);
    for (const s of summary) {
      out.push([s.name, s.employeeNo, students ? s.className : s.position, s.flexible ? 'erkin' : s.workDays, s.presentDays, s.flexible ? '' : s.absentDays, s.lateCount, s.lateMinutes, s.earlyCount,
        (s.workedMinutes / 60).toFixed(2).replace('.', ','), Math.round(s.pay)]);
    }
    out.push([]);
    out.push(['Sana', 'Xodim', 'ID', 'Keldi', 'Ketdi', 'Kelib-ketishlar', 'Kechikish (daq)', 'Erta ketish (daq)', 'Ishlagan (soat)', "Summa (so'm)", "Qo'lda"]);
    for (const r of [...records].reverse()) {
      out.push([r.date, r.employeeName, r.employeeNo, localTime(r.checkIn), localTime(r.checkOut), sessionsText(r, today), r.lateMinutes || 0, r.earlyMinutes || 0,
        r.workedMinutes != null ? (r.workedMinutes / 60).toFixed(2).replace('.', ',') : '', r.pay || 0, r.manual ? 'ha' : '']);
    }
    const blob = new Blob([`﻿${out.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `davomat_${students ? `oquvchilar${cls ? `_${cls}` : ''}_` : ''}${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const activeEmployees = (employees || []).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name));
  const allEmployees = (employees || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <h1>Davomat hisoboti</h1>
      <ErrorBox error={error} />
      {hasStudents && <KindTabs value={kind} onChange={(k) => { setKind(k); setCls(''); setEmployeeId(''); }} />}
      <div className="card row">
        <label>Dan<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>Gacha<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {students && (
          <label>Sinf<select value={cls} onChange={(e) => { setCls(e.target.value); setEmployeeId(''); }}>
            <option value="">Hammasi</option>
            {classList(employees).map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        )}
        <label>{students ? 'O\'quvchi' : 'Xodim'}<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Hammasi</option>
          {allEmployees.filter((e) => inScope(e.id)).map((e) => <option key={e.id} value={String(e.id)}>{e.name}{e.active ? '' : ' (nofaol)'}</option>)}
        </select></label>
        <button onClick={() => (query === `from=${from}&to=${to}` ? reload() : setQuery(`from=${from}&to=${to}`))} disabled={loading}>
          {loading ? 'Yuklanmoqda…' : 'Ko\'rsatish'}
        </button>
        <button className="secondary" onClick={exportCsv} disabled={!data || data.from !== from || data.to !== to}
          title={data && (data.from !== from || data.to !== to) ? 'Avval "Ko\'rsatish" ni bosing' : ''}>Excel (CSV)</button>
        <button className="secondary" onClick={() => setEditing({ date: today })}>+ Qo&apos;lda qo&apos;shish</button>
      </div>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Jami {data && <span className="muted">({data.from} — {data.to})</span>}</h2>
          <div className="row">
            {[['', 'Hammasi'], ['absent', 'Faqat kelmaganlar'], ['late', 'Faqat kechikkanlar']].map(([k, label]) => (
              <button key={k} type="button" className={`small ${only === k ? '' : 'secondary'}`} onClick={() => setOnly(k)}>{label}</button>
            ))}
          </div>
        </div>
        <table>
          <thead><tr><th>Xodim</th><th>Ish kunlari</th><th>Kelgan</th><th>Kelmagan</th><th>Kechikishlar</th><th>Jami kechikish</th><th>Erta ketish</th><th>Ishlagan</th>{showPay && <th>Summa (so&apos;m)</th>}</tr></thead>
          <tbody>
            {summary.map((s) => [
              <tr key={s.employeeId} className="clickable" onClick={() => setOpenRow(openRow === s.employeeId ? null : s.employeeId)}
                title="Bosing: kelmagan kunlar va kechikishlar sanalari">
                <td>{(s.absentDays > 0 || s.lateCount > 0) && <span className="muted">{openRow === s.employeeId ? '▾ ' : '▸ '}</span>}{s.name}</td><td>{s.flexible ? <span className="muted" title="Erkin jadval">erkin</span> : s.workDays}</td><td>{s.presentDays}</td>
                <td className={s.absentDays ? 'bad' : ''}>{s.flexible && !s.absentDays ? <span className="muted">—</span> : s.absentDays}</td>
                <td className={s.lateCount ? 'warn' : ''}>{s.lateCount}</td><td>{formatDuration(s.lateMinutes)}</td>
                <td>{s.earlyCount}</td><td>{formatDuration(s.workedMinutes)}</td>{showPay && <td title={rateText(s.payType, s.payRate, money)}>{money(s.pay)}</td>}
              </tr>,
              openRow === s.employeeId && (
                <tr key={`${s.employeeId}-d`}><td colSpan={9}>
                  <div className="grid">
                    <div><b className="bad">Kelmagan kunlar ({s.absentDays})</b><br />
                      {s.absentDates.length ? s.absentDates.join(', ') : <span className="muted">yo&apos;q</span>}</div>
                    <div><b className="warn">Kechikishlar ({s.lateCount})</b><br />
                      {s.lateDates.length ? s.lateDates.map((l) => `${l.date} ${localTime(l.checkIn)} (${formatDuration(l.minutes)})`).join(', ')
                        : <span className="muted">yo&apos;q</span>}</div>
                  </div>
                </td></tr>
              ),
            ])}
            {data && !summary.length && <tr><td colSpan={9} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Kunlar bo&apos;yicha</h2>
        {openTotal > 0 && (
          <div className="flash warn">⚠️ {openTotal} ta kelib-ketishda kirish yoki chiqish skaneri yo&apos;q (sariq bilan belgilangan) — ularning vaqti
            &quot;ishlagan&quot; ga qo&apos;shilmaydi. Kerak bo&apos;lsa, &quot;Tahrirlash&quot; orqali to&apos;g&apos;rilang.</div>
        )}
        <table>
          <thead><tr><th>Sana</th><th>Xodim</th><th>Keldi</th><th>Ketdi</th><th>Kelib-ketishlar</th><th>Kechikish</th><th>Erta ketish</th><th>Ishlagan</th>{showPay && <th>Summa</th>}<th></th></tr></thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.employeeName} {r.manual && <span className="pill muted" title="Qo'lda o'zgartirilgan">qo&apos;lda</span>}</td>
                <td>{localTime(r.checkIn) || <span className="muted">—</span>}</td>
                <td>{localTime(r.checkOut) || <span className="muted">—</span>}</td>
                <td>{(r.sessions.length > 1 || openCount(r, today) > 0) && <SessionList record={r} today={today} />}</td>
                <td>{r.lateMinutes > 0 && <span className="warn">{formatDuration(r.lateMinutes)}</span>}</td>
                <td>{r.earlyMinutes > 0 && <span className="warn">{formatDuration(r.earlyMinutes)}</span>}</td>
                <td>{r.workedMinutes != null ? formatDuration(r.workedMinutes) : ''}</td>
                {showPay && <td className="nw">{r.pay ? money(r.pay) : ''}</td>}
                <td><button className="secondary small" onClick={() => setEditing(r)}>Tahrirlash</button></td>
              </tr>
            ))}
            {data && !records.length && <tr><td colSpan={10} className="muted">Ma&apos;lumot yo&apos;q</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <RecordForm record={editing} employees={activeEmployees} records={data ? data.records : []} today={today} onClose={(changed) => { setEditing(null); if (changed) reload(); }} />}
    </>
  );
}

const emptyRow = () => ({ in: '', out: '' });

function RecordForm({ record, employees, records, today, onClose }) {
  const isNew = !record.id;
  const [employeeId, setEmployeeId] = useState(record.employeeId ? String(record.employeeId) : '');
  const [date, setDate] = useState(record.date);
  const [rows, setRows] = useState(() => (isNew || !record.sessions.length
    ? [emptyRow()]
    : record.sessions.map((s) => ({ in: localTime(s.in), out: localTime(s.out) }))));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // "Qo'lda qo'shish" for a day that already has scans adds to them
  const existing = isNew && employeeId && records.find((r) => String(r.employeeId) === employeeId && r.date === date);

  const setRow = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  async function save(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      // editing a shown record replaces the whole day; "Qo'lda qo'shish" adds to what the terminals recorded
      await api('/attendance', { method: 'PUT', body: { employeeId: Number(employeeId), date, sessions: rows, replace: !isNew } });
      onClose(true);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Bu kunning butun yozuvi o\'chirilsinmi?')) return;
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
        {isNew && (
          <div className="grid">
            <label>Xodim<select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} required>
              <option value="">Tanlang…</option>
              {employees.map((x) => <option key={x.id} value={String(x.id)}>{x.name}</option>)}
            </select></label>
            <label>Sana<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          </div>
        )}
        {existing && (
          <p className="hint">Bu kunda terminal yozgan vaqtlar bor: <SessionList record={existing} today={today} />. Kiritilgan vaqtlar ularga qo&apos;shiladi.</p>
        )}
        <table>
          <thead><tr><th>#</th><th>Keldi</th><th>Ketdi</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td><input type="time" value={r.in} onChange={(e) => setRow(i, 'in', e.target.value)} /></td>
                <td><input type="time" value={r.out} onChange={(e) => setRow(i, 'out', e.target.value)} /></td>
                <td>{rows.length > 1 && (
                  <button type="button" className="secondary small" title="Qatorni olib tashlash" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p><button type="button" className="secondary small" onClick={() => setRows((rs) => [...rs, emptyRow()])}>+ Yana kelib-ketish</button></p>
        <p className="hint">{isNew
          ? 'Masalan, xodim skan qilishni unutgan bo\'lsa: faqat yetishmagan vaqtni kiriting. Terminal yozgan vaqtlar saqlanadi.'
          : 'Har bir qator — bitta kelib-ketish (masalan, 08:00–10:00 va 14:00–16:00). Ishlagan vaqt — qatorlar yig\'indisi. Bo\'sh qator hisobga olinmaydi.'}</p>
        <div className="row">
          <button disabled={saving}>{saving ? 'Saqlanmoqda…' : 'Saqlash'}</button>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button>
          {!isNew && <button type="button" className="danger" style={{ marginLeft: 'auto' }} onClick={remove}>O&apos;chirish</button>}
        </div>
      </form>
    </div>
  );
}
