'use client';
import { localDateTime } from '@/lib/time';

export function SyncBadge({ employee, device }) {
  const s = employee.deviceSync && employee.deviceSync[device.id];
  const wanted = employee.active && !employee.deleted;
  if (!s && !wanted) return <span className="muted">—</span>;
  const pending = !s || s.version !== employee.version;
  if (pending && device.online === false) return <span className="pill muted" title={device.lastError}>terminal ulanmagan</span>;
  if (!s || s.version !== employee.version) return <span className="pill warn" title={device.name}>⏳</span>;
  if (s.status === 'error') return <span className="pill bad" title={s.message}>✗ {s.message}</span>;
  return <span className="pill ok" title={`${device.name}: ${localDateTime(s.at)}`}>✓</span>;
}

export function DeviceStatus({ device }) {
  if (!device.ip) return <span className="muted">IP kiritilmagan</span>;
  if (device.online == null) return <span className="pill muted">tekshirilmoqda…</span>;
  if (!device.online) return <span className="pill bad" title={device.lastError}>✗ ulanmagan</span>;
  return <span className="pill ok">✓ ulangan</span>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="flash error">{error.message || String(error)}</div>;
}

export const WEEKDAYS = [
  ['1', 'Dushanba'], ['2', 'Seshanba'], ['3', 'Chorshanba'], ['4', 'Payshanba'], ['5', 'Juma'], ['6', 'Shanba'], ['0', 'Yakshanba'],
];
export const WEEKDAY_SHORT = { 1: 'Du', 2: 'Se', 3: 'Ch', 4: 'Pa', 5: 'Ju', 6: 'Sh', 0: 'Ya' };

/** "Du–Sh 08:00–17:00" style summary of a schedule */
export function scheduleSummary(s) {
  if (!s) return '';
  const groups = new Map();
  for (const [k] of WEEKDAYS) {
    const d = s.days[k];
    const key = d ? `${d.start}–${d.end}` : null;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(WEEKDAY_SHORT[k]);
  }
  if (!groups.size) return 'ish kuni yo\'q';
  return [...groups.entries()].map(([time, days]) => `${days.join(',')} ${time}`).join('; ');
}
