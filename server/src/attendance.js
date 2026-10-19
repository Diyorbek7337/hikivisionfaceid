'use strict';
const { localDate, localTime, localMinutes, parseHHMM, formatDuration } = require('./time');
const { MAX_PUNCHES, punchesOf, summarizeDay } = require('./sessions');

/** Notifications for events older than this are skipped (e.g. a terminal re-sending its offline backlog). */
const NOTIFY_MAX_AGE_MS = 15 * 60 * 1000;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const money = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));

/**
 * Recomputes the day from its scans: sessions, first arrival, last departure, worked time (sum of
 * complete sessions), lateness (first arrival vs rec.workStart) and early leave (last departure vs rec.workEnd).
 * Work hours are null on a day off / flexible schedule. Records without `punches` (older versions,
 * tests) are read from checkIn / checkOut.
 */
function computeStats(rec, settings, tz) {
  const punches = punchesOf(rec);
  const day = summarizeDay(punches);
  const start = parseHHMM(rec.workStart);
  const end = parseHHMM(rec.workEnd);
  let late = 0;
  if (day.checkIn && start != null) {
    const d = localMinutes(day.checkIn, tz) - start;
    late = d > (settings.lateGraceMinutes || 0) ? d : 0;
  }
  let early = 0;
  if (day.checkOut && end != null) {
    const d = end - localMinutes(day.checkOut, tz);
    early = d > 0 ? d : 0;
  }
  return { ...rec, ...day, punches, lateMinutes: late, earlyMinutes: early };
}

/**
 * Pay for one day, rounded to whole so'm (totals are sums of rounded days, so they always add up).
 *   hourly  — rate × worked time (complete visits only)
 *   daily   — rate once for a day the person came
 *   session — rate × number of visits that day (e.g. a lesson each time)
 */
function salaryFor(rec) {
  const rate = Number(rec.payRate) || 0;
  if (!rate) return 0;
  const visits = rec.sessions ? rec.sessions.length : (rec.checkIn || rec.checkOut ? 1 : 0);
  if (rec.payType === 'daily') return visits ? Math.round(rate) : 0;
  if (rec.payType === 'session') return Math.round(rate * visits);
  if (!rec.workedMinutes) return 0;
  return Math.round((rec.workedMinutes / 60) * rate);
}

/**
 * Applies one successful recognition to the attendance data.
 *   store: { findEmployeeByNo(no), getWorkHours(employee, date), getAttendance(employeeId, date), saveAttendance(rec) }
 * Returns { action, employee, record, session, firstOfDay, time }.
 *   action: checkin | checkout | duplicate | too_many | unknown_employee | inactive_employee | before_registration
 */
async function processScan(store, settings, tz, device, ev) {
  const employee = await store.findEmployeeByNo(ev.employeeNo);
  if (!employee) return { action: 'unknown_employee' };
  if (!employee.active || employee.deleted) return { action: 'inactive_employee', employee };

  const t = ev.time || new Date();
  // A scan from before this person was registered here belongs to someone else (old terminal data).
  const registered = employee.createdAt ? new Date(String(employee.createdAt).replace(' ', 'T')).getTime() : NaN;
  if (Number.isFinite(registered) && t.getTime() < registered - 5 * 60 * 1000) {
    return { action: 'before_registration', employee };
  }
  const date = localDate(t, tz);
  const existing = await store.getAttendance(employee.id, date);
  const rec = existing ? { ...existing } : { employeeId: employee.id, date };

  const punches = punchesOf(rec);
  // One scan seen twice (or someone scanning again right away) counts once.
  const debounceMs = (settings.debounceSeconds || 0) * 1000;
  if (punches.some((p) => Math.abs(t - p.time) < debounceMs)) return { action: 'duplicate', employee, record: existing };
  if (punches.length >= MAX_PUNCHES) return { action: 'too_many', employee, record: existing };

  const dir = ['in', 'out', 'auto'].includes(device.direction) ? device.direction : 'auto';
  rec.punches = [...punches, { time: t, dir, deviceId: device.id, deviceName: device.name || '' }];

  // Keep a copy of the details used for the calculation (reports stay correct after later edits).
  // The first record of the day fixes them; later scans the same day reuse that snapshot.
  if (existing) {
    Object.assign(rec, { employeeNo: employee.employeeNo, employeeName: employee.name });
  } else {
    const hours = await store.getWorkHours(employee, date);
    Object.assign(rec, {
      employeeNo: employee.employeeNo,
      employeeName: employee.name,
      workStart: hours ? hours.start : null,
      workEnd: hours ? hours.end : null,
      payType: employee.payType || 'hourly',
      payRate: Number(employee.payRate) || 0,
    });
  }
  const record = computeStats(rec, settings, tz);
  await store.saveAttendance(record);
  // Did this scan start a session (arrival) or end one (departure)?
  const session = record.sessions.find((x) => (x.in && x.in.getTime() === t.getTime()) || (x.out && x.out.getTime() === t.getTime()));
  const action = session && session.in && session.in.getTime() === t.getTime() ? 'checkin' : 'checkout';
  const firstOfDay = !!record.checkIn && record.checkIn.getTime() === t.getTime();
  return { action, employee, record, session, firstOfDay, time: t };
}

function checkinMessage(employee, record, tz, result = {}) {
  const time = result.time || record.checkIn;
  const again = result.firstOfDay === false;
  let text = `✅ <b>${again ? 'Qaytib kelganingiz' : 'Kelganingiz'} qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(time, tz)}\n📷 Yuz orqali tasdiqlangan`;
  if (again) return text;
  if (record.lateMinutes > 0) text += `\n\n⚠️ Kechikish: ${formatDuration(record.lateMinutes)}`;
  else if (record.workStart) text += '\n\n✅ O\'z vaqtida!';
  return text;
}

function checkoutMessage(employee, record, tz, result = {}) {
  const time = result.time || record.checkOut;
  const session = result.session;
  let text = `👋 <b>Ketganingiz qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(time, tz)}\n`;
  const several = record.sessions && record.sessions.length > 1;
  if (several && session && session.minutes != null) text += `⏱ Bu safar: ${formatDuration(session.minutes)}\n`;
  if (record.workedMinutes != null) text += `⏱ ${several ? 'Bugun jami' : 'Ishlagan'}: ${formatDuration(record.workedMinutes)}\n`;
  text += '📷 Yuz orqali tasdiqlangan';
  const pay = salaryFor(record);
  if (pay > 0) text += `\n💰 Bugun: ${money(pay)} so'm`;
  const isLast = record.checkOut && time && record.checkOut.getTime() === time.getTime();
  if (isLast && record.earlyMinutes > 0) text += `\n⚠️ Erta ketish: ${formatDuration(record.earlyMinutes)}`;
  return text;
}

function lateAdminMessage(employee, record, tz) {
  return `⏰ <b>Kechikish</b>\n\n👤 ${esc(employee.name)} (${esc(employee.employeeNo)})\n🕐 Keldi: ${localTime(record.checkIn, tz)} (ish boshlanishi ${esc(record.workStart)})\n⚠️ ${formatDuration(record.lateMinutes)} kechikdi`;
}

/** Sends Telegram messages for a processed scan. Never throws. */
async function notifyScan(telegram, tz, result) {
  if (!telegram || !telegram.enabled) return;
  const { action, employee, record, time } = result;
  if (action !== 'checkin' && action !== 'checkout') return;
  if (Math.abs(Date.now() - time.getTime()) > NOTIFY_MAX_AGE_MS) return;
  try {
    if (action === 'checkin') {
      if (employee.telegramChatId) await telegram.send(employee.telegramChatId, checkinMessage(employee, record, tz, result));
      // late students are seen in the class reports; a message for each would flood the director
      if (result.firstOfDay && record.lateMinutes > 0 && employee.kind !== 'student') {
        await telegram.notifyAdmins(lateAdminMessage(employee, record, tz));
      }
    } else if (employee.telegramChatId) {
      await telegram.send(employee.telegramChatId, checkoutMessage(employee, record, tz, result));
    }
  } catch (err) {
    console.error('Telegram xatosi:', err.message);
  }
}

module.exports = { processScan, computeStats, salaryFor, notifyScan, checkinMessage, checkoutMessage };
