'use strict';
/**
 * A day of attendance is a list of scans ("punches"); the in/out sessions are derived from them.
 * Deriving (instead of updating sessions one scan at a time) keeps late-delivered terminal backlog
 * correct: the result depends only on the scans, not on the order they arrived in.
 *
 *   punch: { time: Date, dir: 'in' | 'out' | 'auto', deviceId, deviceName, manual? }
 *   session: { in: Date|null, out: Date|null, inDevice*, outDevice*, minutes: number|null }
 *
 * Rules, walking the scans in time order:
 *   in   — starts a session (an earlier session that was never closed stays open: "chiqish qayd etilmagan")
 *   out  — closes the open session; without one it is a session with no arrival ("kirish qayd etilmagan")
 *   auto — one terminal for both ways: closes the open session, otherwise starts one
 */

/** Hard limit of scans kept per person per day (protects against a stuck terminal). */
const MAX_PUNCHES = 60;

const DIRS = new Set(['in', 'out', 'auto']);

function toPunch(p) {
  return {
    time: p.time instanceof Date ? p.time : new Date(p.time),
    dir: DIRS.has(p.dir) ? p.dir : 'auto',
    deviceId: p.deviceId ?? null,
    deviceName: p.deviceName ?? null,
    ...(p.manual ? { manual: true } : {}),
  };
}

/** Records saved before sessions existed only have a check-in and a check-out. */
function legacyPunches(rec) {
  const out = [];
  if (rec.checkIn) out.push({ time: rec.checkIn, dir: 'in', deviceId: rec.checkInDeviceId ?? null, deviceName: rec.checkInDeviceName ?? null });
  if (rec.checkOut) out.push({ time: rec.checkOut, dir: 'out', deviceId: rec.checkOutDeviceId ?? null, deviceName: rec.checkOutDeviceName ?? null });
  return out.map(toPunch);
}

function punchesOf(rec) {
  return Array.isArray(rec.punches) ? rec.punches.map(toPunch) : legacyPunches(rec);
}

function sortPunches(punches) {
  return [...punches].sort((a, b) => a.time - b.time);
}

function buildSessions(punches) {
  const sessions = [];
  let open = null;
  const start = (p) => ({ in: p.time, inDeviceId: p.deviceId, inDeviceName: p.deviceName, out: null, outDeviceId: null, outDeviceName: null });
  for (const p of sortPunches(punches)) {
    if (p.dir === 'in' || (p.dir === 'auto' && !open)) {
      if (open) sessions.push(open);
      open = start(p);
    } else if (open) {
      Object.assign(open, { out: p.time, outDeviceId: p.deviceId, outDeviceName: p.deviceName });
      sessions.push(open);
      open = null;
    } else {
      sessions.push({ in: null, inDeviceId: null, inDeviceName: null, out: p.time, outDeviceId: p.deviceId, outDeviceName: p.deviceName });
    }
  }
  if (open) sessions.push(open);
  return sessions.map((s) => ({ ...s, minutes: s.in && s.out ? Math.round((s.out - s.in) / 60000) : null }));
}

/**
 * Day totals from the scans:
 *   checkIn  — first arrival (lateness is measured from it)
 *   checkOut — departure of the last session; null while the person is inside (or never scanned out)
 *   workedMinutes — sum of complete sessions; null when there is none
 *   openSessions — sessions missing their arrival or departure
 */
function summarizeDay(punches) {
  const sessions = buildSessions(punches);
  const firstIn = sessions.find((s) => s.in);
  const last = sessions[sessions.length - 1];
  const closed = sessions.filter((s) => s.minutes != null);
  return {
    sessions,
    checkIn: firstIn ? firstIn.in : null,
    checkInDeviceId: firstIn ? firstIn.inDeviceId : null,
    checkInDeviceName: firstIn ? firstIn.inDeviceName : null,
    checkOut: last && last.out ? last.out : null,
    checkOutDeviceId: last && last.out ? last.outDeviceId : null,
    checkOutDeviceName: last && last.out ? last.outDeviceName : null,
    workedMinutes: closed.length ? closed.reduce((n, s) => n + s.minutes, 0) : null,
    openSessions: sessions.filter((s) => !s.in || !s.out).length,
  };
}

/** JSON form stored in the database. */
function serializePunches(punches) {
  return JSON.stringify(sortPunches(punches.map(toPunch)).map((p) => ({
    time: p.time.toISOString(), dir: p.dir, deviceId: p.deviceId, deviceName: p.deviceName, ...(p.manual ? { manual: true } : {}),
  })));
}

module.exports = { MAX_PUNCHES, toPunch, punchesOf, legacyPunches, buildSessions, summarizeDay, serializePunches, sortPunches };
