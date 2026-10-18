'use strict';
const { localDate, localTime, localMinutes, parseHHMM, formatDuration } = require('./time');

/** Notifications for events older than this are skipped (e.g. a terminal re-sending its offline backlog). */
const NOTIFY_MAX_AGE_MS = 15 * 60 * 1000;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const money = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));

/**
 * Recomputes late / early-leave / worked minutes from rec.workStart / rec.workEnd (null on a day off).
 * `rec.checkIn` / `rec.checkOut` are Dates.
 */
function computeStats(rec, settings, tz) {
  const start = parseHHMM(rec.workStart);
  const end = parseHHMM(rec.workEnd);
  const ci = rec.checkIn || null;
  const co = rec.checkOut || null;
  let late = 0;
  if (ci && start != null) {
    const d = localMinutes(ci, tz) - start;
    late = d > (settings.lateGraceMinutes || 0) ? d : 0;
  }
  let early = 0;
  if (co && end != null) {
    const d = end - localMinutes(co, tz);
    early = d > 0 ? d : 0;
  }
  const worked = ci && co && co > ci ? Math.round((co - ci) / 60000) : null;
  return { ...rec, lateMinutes: late, earlyMinutes: early, workedMinutes: worked };
}

/** Pay for one day, rounded to whole so'm (totals are sums of rounded days, so they always add up). */
function salaryFor(rec) {
  if (!rec.workedMinutes || !rec.hourlyRate) return 0;
  return Math.round((rec.workedMinutes / 60) * rec.hourlyRate);
}

/**
 * Applies one successful recognition to the attendance data.
 *   store: { findEmployeeByNo(no), getWorkHours(employee, date), getAttendance(employeeId, date), saveAttendance(rec) }
 * Returns { action, employee, record, time }.
 *   action: checkin | checkout | duplicate | repeat_in | unknown_employee | inactive_employee
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

  const debounceMs = (settings.debounceSeconds || 0) * 1000;
  for (const prev of [rec.checkIn, rec.checkOut]) {
    if (prev && Math.abs(t - prev) < debounceMs) return { action: 'duplicate', employee, record: existing };
  }

  let action;
  const direction = device.direction || 'auto';
  if (direction === 'auto') {
    // One terminal for both ways: the earliest scan of the day is the arrival, the latest the departure.
    // Deciding by time (not by arrival order) keeps late-delivered backlog scans correct.
    const slots = [
      rec.checkIn && { time: rec.checkIn, id: rec.checkInDeviceId, name: rec.checkInDeviceName },
      rec.checkOut && { time: rec.checkOut, id: rec.checkOutDeviceId, name: rec.checkOutDeviceName },
      { time: t, id: device.id, name: device.name || '', isNew: true },
    ].filter(Boolean).sort((a, b) => a.time - b.time);
    const first = slots[0];
    const last = slots.length > 1 ? slots[slots.length - 1] : null;
    if (!first.isNew && !(last && last.isNew)) return { action: 'repeat_in', employee, record: existing };
    Object.assign(rec, {
      checkIn: first.time, checkInDeviceId: first.id, checkInDeviceName: first.name,
      checkOut: last ? last.time : null, checkOutDeviceId: last ? last.id : null, checkOutDeviceName: last ? last.name : null,
    });
    action = first.isNew ? 'checkin' : 'checkout';
  } else if (direction === 'in') {
    if (rec.checkIn && rec.checkIn <= t) return { action: 'repeat_in', employee, record: existing };
    rec.checkIn = t;
    rec.checkInDeviceId = device.id;
    rec.checkInDeviceName = device.name || '';
    action = 'checkin';
  } else {
    if (rec.checkOut && rec.checkOut >= t) return { action: 'duplicate', employee, record: existing };
    rec.checkOut = t;
    rec.checkOutDeviceId = device.id;
    rec.checkOutDeviceName = device.name || '';
    action = 'checkout';
  }

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
      hourlyRate: Number(employee.hourlyRate) || 0,
    });
  }
  const record = computeStats(rec, settings, tz);
  await store.saveAttendance(record);
  return { action, employee, record, time: t };
}

function checkinMessage(employee, record, tz) {
  let text = `✅ <b>Kelganingiz qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(record.checkIn, tz)}\n📷 Yuz orqali tasdiqlangan\n\n`;
  if (record.lateMinutes > 0) text += `⚠️ Kechikish: ${formatDuration(record.lateMinutes)}`;
  else if (record.workStart) text += '✅ O\'z vaqtida!';
  return text;
}

function checkoutMessage(employee, record, tz) {
  let text = `👋 <b>Ketganingiz qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(record.checkOut, tz)}\n`;
  if (record.workedMinutes != null) text += `⏱ Ishlagan: ${formatDuration(record.workedMinutes)}\n`;
  text += '📷 Yuz orqali tasdiqlangan';
  const pay = salaryFor(record);
  if (pay > 0) text += `\n💰 Bugun: ${money(pay)} so'm`;
  if (record.earlyMinutes > 0) text += `\n⚠️ Erta ketish: ${formatDuration(record.earlyMinutes)}`;
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
      if (employee.telegramChatId) await telegram.send(employee.telegramChatId, checkinMessage(employee, record, tz));
      if (record.lateMinutes > 0) await telegram.notifyAdmins(lateAdminMessage(employee, record, tz));
    } else if (employee.telegramChatId) {
      await telegram.send(employee.telegramChatId, checkoutMessage(employee, record, tz));
    }
  } catch (err) {
    console.error('Telegram xatosi:', err.message);
  }
}

module.exports = { processScan, computeStats, salaryFor, notifyScan, checkinMessage, checkoutMessage };
