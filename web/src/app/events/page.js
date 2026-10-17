'use client';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { useLiveQuery } from '@/lib/hooks';
import { localDateTime, localTime } from '@/lib/time';
import { ErrorBox } from '@/components/ui';

const LABELS = {
  checkin: <span className="pill ok">Keldi</span>,
  checkout: <span className="pill ok">Ketdi</span>,
  duplicate: <span className="pill muted">Takroriy skan</span>,
  repeat_in: <span className="pill muted">Qayta kirish</span>,
  unknown_employee: <span className="pill bad">Xodim topilmadi</span>,
  inactive_employee: <span className="pill muted">Nofaol xodim</span>,
  not_recognized: <span className="pill muted">Tanilmadi / boshqa</span>,
};

export default function Events() {
  const { db } = useApp();
  const [events, loading, error] = useLiveQuery(() => query(collection(db, 'events'), orderBy('receivedAt', 'desc'), limit(150)), []);
  return (
    <>
      <h1>Oxirgi eventlar</h1>
      <p className="muted">Terminallardan kelgan so&apos;nggi 150 ta event (jonli). Sozlashda tekshirish uchun qulay. 60 kundan eskilari avtomatik o&apos;chiriladi.</p>
      <ErrorBox error={error} />
      <div className="card">
        <table>
          <thead><tr><th>Qabul qilindi</th><th>Terminal</th><th>Skan vaqti</th><th>ID</th><th>Ism</th><th>Natija</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{localDateTime(e.receivedAt)}</td><td>{e.deviceName}</td><td>{localTime(e.time)}</td>
                <td>{e.employeeNo && <code>{e.employeeNo}</code>}</td><td>{e.personName}</td>
                <td>{LABELS[e.action] || e.action}
                  {e.action === 'unknown_employee' && <span className="hint"> — terminalda bor, web app&apos;da yo&apos;q</span>}
                </td>
              </tr>
            ))}
            {!loading && !events.length && <tr><td colSpan={6} className="muted">Hali event kelmagan</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
