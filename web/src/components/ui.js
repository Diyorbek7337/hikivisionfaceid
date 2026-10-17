'use client';
import { formatDuration, localDateTime } from '@/lib/time';

export function SyncBadge({ employee, device }) {
  const s = employee.deviceSync && employee.deviceSync[device.id];
  const wanted = employee.active && !employee.deleted;
  if (!s && !wanted) return <span className="muted">—</span>;
  if (!s || s.version !== employee.version) return <span className="pill warn" title={device.name}>⏳ yuborilmoqda</span>;
  if (s.status === 'error') return <span className="pill bad" title={s.message}>✗ {s.message}</span>;
  return <span className="pill ok" title={`${device.name}: ${localDateTime(s.at)}`}>✓</span>;
}

export function DeviceStatus({ device }) {
  if (!device.ip) return <span className="muted">IP kiritilmagan</span>;
  if (device.online == null) return <span className="pill muted">tekshirilmoqda…</span>;
  if (!device.online) return <span className="pill bad" title={device.lastError}>✗ ulanmagan</span>;
  return <span className="pill ok">✓ ulangan</span>;
}

export function LateText({ minutes }) {
  return minutes > 0 ? <span className="warn">{formatDuration(minutes)}</span> : null;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  const msg = error.code === 'permission-denied' ? 'Ruxsat yo\'q (Firestore qoidalarini tekshiring)' : (error.message || String(error));
  return <div className="flash error">{msg}</div>;
}
