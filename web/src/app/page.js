'use client';
import Link from 'next/link';
import { collection, query, where } from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { useLiveQuery } from '@/lib/hooks';
import { localDate, localTime, formatDuration } from '@/lib/time';
import { DeviceStatus, ErrorBox } from '@/components/ui';

export default function Dashboard() {
  const { db } = useApp();
  const today = localDate();
  const [employees, , e1] = useLiveQuery(() => query(collection(db, 'employees'), where('active', '==', true)), []);
  const [attendance, , e2] = useLiveQuery(() => query(collection(db, 'attendance'), where('date', '==', today)), [today]);
  const [devices] = useLiveQuery(() => collection(db, 'devices'), []);

  const byEmp = new Map(attendance.map((a) => [a.employeeId, a]));
  const rows = employees.filter((e) => !e.deleted).sort((a, b) => a.name.localeCompare(b.name))
    .map((emp) => ({ emp, att: byEmp.get(emp.id) }));
  const came = rows.filter((r) => r.att && r.att.checkIn).length;
  const late = rows.filter((r) => r.att && r.att.lateMinutes > 0).length;
  const left = rows.filter((r) => r.att && r.att.checkOut).length;
  const inside = rows.filter((r) => r.att && r.att.checkIn && !r.att.checkOut).length;

  return (
    <>
      <h1>Bugun — {today}</h1>
      <ErrorBox error={e1 || e2} />
      <div className="stats">
        <div className="stat"><div className="n">{rows.length}</div><div className="l">Jami xodimlar</div></div>
        <div className="stat"><div className="n ok">{came}</div><div className="l">Kelgan</div></div>
        <div className="stat"><div className="n warn">{late}</div><div className="l">Kechikkan</div></div>
        <div className="stat"><div className="n bad">{rows.length - came}</div><div className="l">Kelmagan</div></div>
        <div className="stat"><div className="n">{inside}</div><div className="l">Hozir ishda</div></div>
        <div className="stat"><div className="n">{left}</div><div className="l">Ketgan</div></div>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Xodim</th><th>ID</th><th>Ish vaqti</th><th>Keldi</th><th>Ketdi</th><th>Holat</th></tr></thead>
          <tbody>
            {rows.map(({ emp, att }) => {
              let status = <span className="pill bad">Kelmagan</span>;
              if (att && att.checkIn) {
                status = att.lateMinutes > 0
                  ? <span className="pill warn">Kechikdi: {formatDuration(att.lateMinutes)}</span>
                  : <span className="pill ok">O&apos;z vaqtida</span>;
              } else if (att && att.checkOut) status = <span className="pill warn">Faqat chiqish</span>;
              return (
                <tr key={emp.id}>
                  <td>{emp.name}</td><td>{emp.employeeNo}</td><td>{emp.workStart}–{emp.workEnd}</td>
                  <td>{att ? localTime(att.checkIn) : ''}</td><td>{att ? localTime(att.checkOut) : ''}</td><td>{status}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="muted">Hali xodim yo&apos;q. <Link href="/employees/edit/">Xodim qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Terminallar</h2>
        <table>
          <thead><tr><th>Nomi</th><th>IP</th><th>Holat</th></tr></thead>
          <tbody>
            {devices.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.ip}</td><td><DeviceStatus device={d} /></td></tr>)}
            {!devices.length && <tr><td colSpan={3} className="muted">Terminal qo&apos;shilmagan. <Link href="/devices/">Terminal qo&apos;shish</Link></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
