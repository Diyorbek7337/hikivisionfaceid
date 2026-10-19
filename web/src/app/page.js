'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { localTime, formatDuration, normText } from '@/lib/time';
import { DeviceStatus, ErrorBox } from '@/components/ui';
import { SessionList } from '@/components/Sessions';
import DoorButtons from '@/components/DoorButtons';
import { KindTabs, compareClasses } from '@/lib/people';

const STATUS = {
  present: <span className="pill ok">Keldi</span>,
  absent: <span className="pill bad">Kelmagan</span>,
  off: <span className="pill muted">Dam olish</span>,
  pending: <span className="pill muted" title="Ish vaqti hali boshlanmagan">Kutilmoqda</span>,
  free: <span className="pill muted" title="Erkin jadval: kelmasa ham kelmagan hisoblanmaydi">Erkin</span>,
};

export default function Dashboard() {
  const { data, error } = useApi('/today', { refreshMs: 10000 });
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('staff');
  const [cls, setCls] = useState('');
  if (!data) return <><ErrorBox error={error} /><p className="muted">Yuklanmoqda…</p></>;

  const hasStudents = data.rows.some((r) => r.employee.kind === 'student');
  const students = hasStudents && kind === 'student';
  const ofKind = data.rows.filter((r) => !hasStudents || (students ? r.employee.kind === 'student' : r.employee.kind !== 'student'));
  const rows = ofKind.filter((r) => !students || !cls || r.employee.className === cls);
  const classes = students ? classSummary(ofKind) : [];
  const working = rows.filter((r) => r.status !== 'off' && r.status !== 'free');
  const count = (s) => rows.filter((r) => r.status === s).length;
  const came = count('present') + count('late');
  const inside = rows.filter((r) => r.inside).length;
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
      {hasStudents && <KindTabs value={kind} onChange={(k) => { setKind(k); setCls(''); setFilter('all'); }} />}
      {students && (
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Sinflar {cls && <span className="muted">— tanlangan: {cls}</span>}</h2>
            {cls && <button className="secondary small" onClick={() => setCls('')}>Barcha sinflar</button>}
          </div>
          <table>
            <thead><tr><th>Sinf</th><th>Jami</th><th>Keldi</th><th>Kechikdi</th><th>Kelmadi</th><th className="hide-sm">Ichkarida</th></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.name} className={`clickable ${cls === c.name ? 'selected-row' : ''}`} onClick={() => setCls(cls === c.name ? '' : c.name)}>
                  <td><b>{c.name}</b></td><td>{c.total}</td><td className="ok">{c.came}</td>
                  <td className={c.late ? 'warn' : 'muted'}>{c.late}</td><td className={c.absent ? 'bad' : 'muted'}>{c.absent}</td>
                  <td className="hide-sm">{c.inside}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="stats">
        <Stat n={working.length} label={students ? 'Kelishi kerak' : 'Ishda bo\'lishi kerak'} f="all" />
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
          <thead><tr><th>{students ? 'O\'quvchi' : 'Xodim'}</th><th className="hide-sm">{students ? 'Sinf' : 'Lavozim'}</th><th className="hide-sm">Ish vaqti</th><th>Keldi</th><th>Ketdi</th><th className="hide-sm">Kelib-ketishlar</th><th>Holat</th></tr></thead>
          <tbody>
            {shown.map(({ employee, hours, flexible, attendance, status, inside: isIn }) => (
              <tr key={employee.id}>
                <td>{employee.name}</td>
                <td className="muted hide-sm">{students ? employee.className : employee.position}</td>
                <td className="hide-sm nw">{hours ? `${hours.start}–${hours.end}` : <span className="muted">{flexible ? 'erkin' : '—'}</span>}</td>
                <td className="nw">{attendance ? localTime(attendance.checkIn) : ''}</td>
                <td className="nw">{isIn ? <span className="pill ok">ichkarida</span> : attendance ? localTime(attendance.checkOut) : ''}</td>
                <td className="hide-sm">{attendance && attendance.sessions.length > 1 && <SessionList record={attendance} today={data.date} />}</td>
                <td className="nw">{status === 'late'
                  ? <span className="pill warn">Kechikdi: {formatDuration(attendance.lateMinutes)}</span>
                  : STATUS[status]}</td>
              </tr>
            ))}
            {rows.length > 0 && !shown.length && <tr><td colSpan={7} className="muted">Hech kim topilmadi</td></tr>}
            {!rows.length && <tr><td colSpan={7} className="muted">Hali xodim yo&apos;q. <Link href="/employees/import/">Excel&apos;dan import</Link> yoki <Link href="/employees/edit/">qo&apos;lda qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Terminallar</h2>
        <table>
          <thead><tr><th>Nomi</th><th className="hide-sm">IP</th><th>Holat</th><th>Eshik</th></tr></thead>
          <tbody>
            {data.devices.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td><td className="hide-sm">{d.ip}</td><td><DeviceStatus device={d} /></td>
                <td>{d.doorMode === 'alwaysOpen' ? <span className="pill warn" title="Terminallar sahifasida &quot;Odatiy holat&quot;">doimiy ochiq</span> : <DoorButtons device={d} compact />}</td>
              </tr>
            ))}
            {!data.devices.length && <tr><td colSpan={4} className="muted">Terminal qo&apos;shilmagan. <Link href="/devices/">Terminal qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Per class: total expected, came, late, absent, inside now. */
function classSummary(rows) {
  const m = new Map();
  for (const r of rows) {
    const name = r.employee.className || '—';
    if (!m.has(name)) m.set(name, { name, total: 0, came: 0, late: 0, absent: 0, inside: 0 });
    const c = m.get(name);
    if (r.status !== 'off' && r.status !== 'free') c.total += 1;
    if (r.status === 'present' || r.status === 'late') c.came += 1;
    if (r.status === 'late') c.late += 1;
    if (r.status === 'absent') c.absent += 1;
    if (r.inside) c.inside += 1;
  }
  return [...m.values()].sort((a, b) => compareClasses(a.name, b.name));
}
