'use client';
import { useApi } from '@/lib/api';
import { localDateTime, localTime } from '@/lib/time';
import { ErrorBox } from '@/components/ui';

const LABELS = {
  checkin: <span className="pill ok">Keldi</span>,
  checkout: <span className="pill ok">Ketdi</span>,
  duplicate: <span className="pill muted">Takroriy skan</span>,
  repeat_in: <span className="pill muted">Qayta kirish</span>,
  too_many: <span className="pill warn">Juda ko&apos;p skan</span>,
  before_registration: <span className="pill muted">Eski yozuv</span>,
  unknown_employee: <span className="pill bad">Xodim topilmadi</span>,
  inactive_employee: <span className="pill muted">Nofaol xodim</span>,
  not_recognized: <span className="pill muted">Tanilmadi / boshqa</span>,
};

export default function Events() {
  const { data, error } = useApi('/events?limit=200', { refreshMs: 4000 });
  return (
    <>
      <h1>Oxirgi eventlar</h1>
      <p className="muted">Terminallardan kelgan so&apos;nggi 200 ta event (avtomatik yangilanadi). Sozlashda tekshirish uchun qulay.</p>
      <ErrorBox error={error} />
      <div className="card">
        <table>
          <thead><tr><th>Qabul qilindi</th><th>Terminal</th><th>Skan vaqti</th><th>ID</th><th>Ism</th><th>Natija</th></tr></thead>
          <tbody>
            {(data || []).map((e) => (
              <tr key={e.id}>
                <td>{localDateTime(e.receivedAt)}</td><td>{e.deviceName}</td><td>{e.time && localDateTime(e.time).slice(0, 10) !== localDateTime(e.receivedAt).slice(0, 10) ? localDateTime(e.time) : localTime(e.time)}</td>
                <td>{e.employeeNo && <code>{e.employeeNo}</code>}</td><td>{e.personName}</td>
                <td>{LABELS[e.action] || e.action}
                  {e.action === 'unknown_employee' && <span className="hint"> — terminalda bor, tizimda yo&apos;q</span>}</td>
              </tr>
            ))}
            {data && !data.length && <tr><td colSpan={6} className="muted">Hali event kelmagan</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
