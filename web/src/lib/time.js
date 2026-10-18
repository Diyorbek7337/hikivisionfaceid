// The server's time zone (from /api/status); Tashkent until it is known.
let TZ = 'Asia/Tashkent';
export function setTimezone(tz) {
  if (tz && tz !== TZ) {
    TZ = tz;
    cache.clear();
  }
}

const cache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', ...opts }));
  return cache.get(k);
}
function parts(date, opts) {
  const o = {};
  for (const p of fmt(opts).formatToParts(date)) o[p.type] = p.value;
  return o;
}

export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'number') return new Date(v);
  return new Date(v);
}

/** "YYYY-MM-DD" in Tashkent time */
export function localDate(date = new Date()) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" in Tashkent time */
export function localTime(date) {
  const d = toDate(date);
  if (!d) return '';
  const p = parts(d, { hour: '2-digit', minute: '2-digit' });
  return `${p.hour}:${p.minute}`;
}

export function localDateTime(date) {
  const d = toDate(date);
  return d ? `${localDate(d)} ${localTime(d)}` : '';
}

export function localMinutes(date) {
  const p = parts(date, { hour: '2-digit', minute: '2-digit' });
  return Number(p.hour) * 60 + Number(p.minute);
}

export function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Offset of Tashkent from UTC in minutes at a moment */
function offsetMinutes(date) {
  const p = parts(date, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "2026-01-15" + "09:05" (Tashkent wall clock) -> Date */
export function dateFromLocal(dateStr, hhmm) {
  const guess = new Date(`${dateStr}T${hhmm}:00Z`);
  return new Date(guess.getTime() - offsetMinutes(guess) * 60000);
}

export function formatDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} soat ${m} daq`;
  if (h) return `${h} soat`;
  return `${m} daq`;
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const money = (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));
