'use strict';
const { localDate, localTime, localMinutes, parseHHMM, formatDuration } = require('./time');

/** Notifications for events older than this are skipped (e.g. a terminal re-sending its offline backlog). */
const NOTIFY_MAX_AGE_MS = 15 * 60 * 1000;

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n) {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

/** Recomputes late / early-leave / worked minutes for an attendance record. */
function computeStats(rec, employee, cfg) {
  const tz = cfg.timezone;
  const start = parseHHMM(employee.work_start);
  const end = parseHHMM(employee.work_end);
  const ci = rec.check_in_at ? new Date(rec.check_in_at) : null;
  const co = rec.check_out_at ? new Date(rec.check_out_at) : null;

  let late = 0;
  if (ci && start != null) {
    const d = localMinutes(ci, tz) - start;
    late = d > (cfg.lateGraceMinutes || 0) ? d : 0;
  }
  let early = 0;
  if (co && end != null) {
    const d = end - localMinutes(co, tz);
    early = d > 0 ? d : 0;
  }
  const worked = ci && co && co > ci ? Math.round((co - ci) / 60000) : null;
  return { ...rec, late_minutes: late, early_minutes: early, worked_minutes: worked };
}

function salaryFor(rec, employee) {
  if (!rec.worked_minutes || !employee.hourly_rate) return 0;
  return (rec.worked_minutes / 60) * employee.hourly_rate;
}

/**
 * Applies one successful recognition from a terminal to the attendance table.
 * Returns { action, employee, record }.
 *   action: checkin | checkout | duplicate | repeat_in | unknown_employee | inactive_employee
 */
function processScan(repo, cfg, device, ev) {
  const employee = repo.getEmployeeByNo(ev.employeeNo);
  if (!employee) return { action: 'unknown_employee' };
  if (!employee.active) return { action: 'inactive_employee', employee };

  const t = ev.time || new Date();
  const date = localDate(t, cfg.timezone);
  const existing = repo.getAttendance(employee.id, date);
  const rec = existing ? { ...existing } : { employee_id: employee.id, date };

  // Terminals often report the same face several times in a row.
  const debounceMs = (cfg.debounceSeconds || 0) * 1000;
  for (const prev of [rec.check_in_at, rec.check_out_at]) {
    if (prev && Math.abs(t - new Date(prev)) < debounceMs) {
      return { action: 'duplicate', employee, record: existing };
    }
  }

  let direction = device.direction;
  if (direction === 'auto') direction = rec.check_in_at ? 'out' : 'in';

  let action;
  if (direction === 'in') {
    if (rec.check_in_at && new Date(rec.check_in_at) <= t) {
      // Already came in today (e.g. returning from lunch): keep the first check-in.
      return { action: 'repeat_in', employee, record: existing };
    }
    rec.check_in_at = t.toISOString();
    rec.check_in_device_id = device.id;
    action = 'checkin';
  } else {
    if (rec.check_out_at && new Date(rec.check_out_at) >= t) {
      return { action: 'duplicate', employee, record: existing };
    }
    rec.check_out_at = t.toISOString();
    rec.check_out_device_id = device.id;
    action = 'checkout';
  }

  const record = repo.upsertAttendance(computeStats(rec, employee, cfg));
  return { action, employee, record, time: t };
}

function checkinMessage(employee, record, cfg) {
  const t = new Date(record.check_in_at);
  let text = `✅ <b>Kelganingiz qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(t, cfg.timezone)}\n📷 Yuz orqali tasdiqlangan\n\n`;
  text += record.late_minutes > 0
    ? `⚠️ Kechikish: ${formatDuration(record.late_minutes)}`
    : '✅ O\'z vaqtida!';
  return text;
}

function checkoutMessage(employee, record, cfg) {
  const t = new Date(record.check_out_at);
  let text = `👋 <b>Ketganingiz qayd etildi!</b>\n\n👤 ${esc(employee.name)}\n🕐 Vaqt: ${localTime(t, cfg.timezone)}\n`;
  if (record.worked_minutes != null) text += `⏱ Ishlagan: ${formatDuration(record.worked_minutes)}\n`;
  text += '📷 Yuz orqali tasdiqlangan';
  const pay = salaryFor(record, employee);
  if (pay > 0) text += `\n💰 Bugun: ${money(pay)} so'm`;
  if (record.early_minutes > 0) text += `\n⚠️ Erta ketish: ${formatDuration(record.early_minutes)}`;
  return text;
}

function lateAdminMessage(employee, record, cfg) {
  const t = new Date(record.check_in_at);
  return `⏰ <b>Kechikish</b>\n\n👤 ${esc(employee.name)} (${esc(employee.employee_no)})\n🕐 Keldi: ${localTime(t, cfg.timezone)} (ish boshlanishi ${esc(employee.work_start)})\n⚠️ ${formatDuration(record.late_minutes)} kechikdi`;
}

/** Sends Telegram messages for a processed scan. Never throws. */
async function notifyScan(telegram, cfg, result) {
  if (!telegram || !telegram.enabled) return;
  const { action, employee, record, time } = result;
  if (action !== 'checkin' && action !== 'checkout') return;
  if (Math.abs(Date.now() - time.getTime()) > NOTIFY_MAX_AGE_MS) return;
  try {
    if (action === 'checkin') {
      if (employee.telegram_chat_id) await telegram.send(employee.telegram_chat_id, checkinMessage(employee, record, cfg));
      if (record.late_minutes > 0) await telegram.notifyAdmins(lateAdminMessage(employee, record, cfg));
    } else if (employee.telegram_chat_id) {
      await telegram.send(employee.telegram_chat_id, checkoutMessage(employee, record, cfg));
    }
  } catch (err) {
    console.error('Telegram xatosi:', err.message);
  }
}

module.exports = { processScan, computeStats, salaryFor, notifyScan, checkinMessage, checkoutMessage, money };
