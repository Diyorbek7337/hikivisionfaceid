'use client';
import { WEEKDAYS } from '@/components/ui';

export const blankDays = () => Object.fromEntries(WEEKDAYS.map(([k]) => [k, k === '0' ? null : { start: '08:00', end: '17:00' }]));

/** Weekly work hours table: a checkbox per day plus start / end times. */
export default function DaysEditor({ days, onChange }) {
  const setDay = (k, v) => onChange({ ...days, [k]: v });
  function copyFirst() {
    const first = WEEKDAYS.map(([k]) => days[k]).find(Boolean);
    if (first) onChange(Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v ? { ...first } : v])));
  }
  return (
    <>
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
      <p><button type="button" className="secondary small" onClick={copyFirst}>Birinchi ish kuni vaqtini barcha ish kunlariga nusxalash</button></p>
    </>
  );
}
