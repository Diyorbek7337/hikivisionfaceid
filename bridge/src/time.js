'use strict';

const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  return fmtCache.get(tz);
}

function parts(date, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(date)) o[p.type] = p.value;
  return o;
}

/** "YYYY-MM-DD" in the given time zone */
function localDate(date, tz) {
  const p = parts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" in the given time zone */
function localTime(date, tz) {
  const p = parts(date, tz);
  return `${p.hour}:${p.minute}`;
}

/** Minutes since local midnight */
function localMinutes(date, tz) {
  const p = parts(date, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** "09:00" -> 540; returns null when invalid */
function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 545 -> "9 soat 5 daq" */
function formatDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h} soat ${m} daq`;
  if (h) return `${h} soat`;
  return `${m} daq`;
}

/** Offset of the time zone from UTC in minutes at the given moment (Tashkent: +300). */
function tzOffsetMinutes(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** "2026-10-18T09:05:00" local wall-clock time (no offset), as Hikvision expects in /ISAPI/System/time */
function localIsoNoOffset(date, tz) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Hikvision (POSIX-style) time zone string: UTC+5 -> "CST-5:00:00" */
function hikTimeZone(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  return `CST${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}:00`;
}

module.exports = {
  localDate, localTime, localMinutes, parseHHMM, formatDuration, tzOffsetMinutes, localIsoNoOffset, hikTimeZone,
};
