'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { localTime, formatDuration, normText } from '@/lib/time';
import { DeviceStatus, ErrorBox } from '@/components/ui';

const STATUS = {
  present: <span className="pill ok">Keldi</span>,
  absent: <span className="pill bad">Kelmagan</span>,
  off: <span className="pill muted">Dam olish</span>,
  pending: <span className="pill muted" title="Ish vaqti hali boshlanmagan">Kutilmoqda</span>,
};

export default function Dashboard() {
  const { data, error } = useApi('/today', { refreshMs: 10000 });
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  if (!data) return <><ErrorBox error={error} /><p className="muted">Yuklanmoqda…</p></>;

  const rows = data.rows;
  const working = rows.filter((r) => r.status !== 'off');
  const count = (s) => rows.filter((r) => r.status === s).length;
  const came = count('present') + count('late');
  const inside = rows.filter((r) => r.attendance && r.attendance.checkIn && !r.attendance.checkOut).length;
  const shown = rows
    .filter((r) => filter === 'all' || r.status === filter || (filter === 'present' && r.status === 'late'))
    .filter((r) => !q || normText(r.employee.name).includes(normText(q)));

  const Stat = ({ n, label, cls, f }) => (
    <button type="button" className={`stat ${filter === f ? 'selected' : ''}`} onClick={() => setFilter(filter === f ? 'all' : f)}>
      <div className={`n ${cls || ''}`}>{n}</div><div className="l">{label}</div>
    </button>
  );

  return (
    <>
      <h1>Bugun — {data.date}</h1>
      <ErrorBox error={error} />
      <div className="stats">
        <Stat n={working.length} label="Ishda bo'lishi kerak" f="all" />
        <Stat n={came} label="Kelgan" cls="ok" f="present" />
        <Stat n={count('late')} label="Kechikkan" cls="warn" f="late" />
        <Stat n={count('absent')} label="Kelmagan" cls="bad" f="absent" />
        <div className="stat"><div className="n">{inside}</div><div className="l">Hozir ichkarida</div></div>
      </div>
      <div className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <label style={{ flex: 1, minWidth: 200 }}>Qidirish<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism" /></label>
        </div>
        <table>
          <thead><tr><th>Xodim</th><th className="hide-sm">Lavozim</th><th className="hide-sm">Ish vaqti</th><th>Keldi</th><th>Ketdi</th><th>Holat</th></tr></thead>
          <tbody>
            {shown.map(({ employee, hours, attendance, status }) => (
              <tr key={employee.id}>
                <td>{employee.name}</td>
                <td className="muted hide-sm">{employee.position}</td>
                <td className="hide-sm nw">{hours ? `${hours.start}–${hours.end}` : <span className="muted">—</span>}</td>
                <td className="nw">{attendance ? localTime(attendance.checkIn) : ''}</td>
                <td className="nw">{attendance ? localTime(attendance.checkOut) : ''}</td>
                <td className="nw">{status === 'late'
                  ? <span className="pill warn">Kechikdi: {formatDuration(attendance.lateMinutes)}</span>
                  : STATUS[status]}</td>
              </tr>
            ))}
            {rows.length > 0 && !shown.length && <tr><td colSpan={6} className="muted">Hech kim topilmadi</td></tr>}
            {!rows.length && <tr><td colSpan={6} className="muted">Hali xodim yo&apos;q. <Link href="/employees/import/">Excel&apos;dan import</Link> yoki <Link href="/employees/edit/">qo&apos;lda qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Terminallar</h2>
        <table>
          <thead><tr><th>Nomi</th><th>IP</th><th>Holat</th></tr></thead>
          <tbody>
            {data.devices.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.ip}</td><td><DeviceStatus device={d} /></td></tr>)}
            {!data.devices.length && <tr><td colSpan={3} className="muted">Terminal qo&apos;shilmagan. <Link href="/devices/">Terminal qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
