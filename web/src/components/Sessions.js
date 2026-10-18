'use client';
import { localTime } from '@/lib/time';

/**
 * State of one visit: ok | inside (today's last visit, no departure yet) | noOut | noIn.
 * A missing departure on an earlier visit (or an earlier day) means the person did not scan out.
 */
export function sessionState(record, index, today) {
  const s = record.sessions[index];
  if (s.in && s.out) return 'ok';
  if (!s.in) return 'noIn';
  return record.date === today && index === record.sessions.length - 1 ? 'inside' : 'noOut';
}

/** Visits needing attention (missing arrival or departure), not counting someone who is inside right now. */
export function openCount(record, today) {
  return (record.sessions || []).filter((_, i) => ['noIn', 'noOut'].includes(sessionState(record, i, today))).length;
}

/** "08:00–10:00, 14:00–?" for CSV */
export function sessionsText(record, today) {
  return (record.sessions || []).map((s, i) => {
    const st = sessionState(record, i, today);
    return `${s.in ? localTime(s.in) : '?'}–${s.out ? localTime(s.out) : st === 'inside' ? '…' : '?'}`;
  }).join(', ');
}

/** Compact list of a day's visits; missing scans are highlighted. */
export function SessionList({ record, today }) {
  const sessions = record.sessions || [];
  if (!sessions.length) return null;
  return (
    <span className="sessions">
      {sessions.map((s, i) => {
        const st = sessionState(record, i, today);
        const title = st === 'noOut' ? 'Chiqish qayd etilmagan' : st === 'noIn' ? 'Kirish qayd etilmagan' : st === 'inside' ? 'Hozir ichkarida'
          : [s.inDeviceName, s.outDeviceName].filter(Boolean).join(' → ');
        return (
          <span key={i} className={`session ${st === 'noIn' || st === 'noOut' ? 'open' : ''}`} title={title}>
            {s.in ? localTime(s.in) : '?'}–{s.out ? localTime(s.out) : st === 'inside' ? '…' : '?'}
          </span>
        );
      })}
    </span>
  );
}
