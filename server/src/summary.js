'use strict';
/** Day and period summaries shared by the API (dashboard, report) and the Telegram daily report. */
const { localDate, localMinutes, parseHHMM } = require('./time');
const { salaryFor } = require('./attendance');

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function employeeStartDate(emp, tz) {
  return emp.createdAt ? localDate(new Date(emp.createdAt), tz) : '2000-01-01';
}

/**
 * Is `date` a day this employee was expected at work (so a missing scan means "absent")?
 *   - not before they were registered; on the registration day only if registered before work started
 *   - today only once work start + grace has passed (afternoon shifts are not "absent" in the morning)
 * Returns 'yes' | 'no' | 'pending'.
 */
function expectedAtWork(emp, date, hours, ctx) {
  if (!hours) return 'no';
  const start = parseHHMM(hours.start);
  const created = emp.createdAt ? new Date(emp.createdAt) : null;
  if (created) {
    const createdDay = localDate(created, ctx.tz);
    if (date < createdDay) return 'no';
    if (date === createdDay && start != null && localMinutes(created, ctx.tz) > start) return 'no';
  }
  if (date === ctx.today && start != null && localMinutes(ctx.now, ctx.tz) < start + (ctx.grace || 0)) return 'pending';
  if (date > ctx.today) return 'pending';
  return 'yes';
}

/** Status of every active employee on one date: present | late | absent | pending | off | free (flexible schedule, did not come) */
function daySummary(store, date, tz, now = new Date()) {
  const ctx = { tz, now, today: localDate(now, tz), grace: store.settings.lateGraceMinutes };
  const rows = [];
  const attendance = new Map(store.listAttendance(date, date).map((a) => [a.employeeId, a]));
  for (const emp of store.employees.values()) {
    if (!emp.active || emp.deleted) continue;
    const hours = store.getWorkHoursSync(emp, date);
    const flexible = store.isFlexible(emp);
    const att = attendance.get(emp.id) || null;
    let status;
    if (att && att.checkIn) status = att.lateMinutes > 0 ? 'late' : 'present';
    else if (att && att.checkOut) status = 'present';
    else if (flexible) status = 'free';
    else {
      const exp = expectedAtWork(emp, date, hours, ctx);
      status = exp === 'yes' ? 'absent' : exp === 'pending' ? 'pending' : 'off';
    }
    // inside now = the last visit has an arrival and no departure yet
    const last = att && att.sessions && att.sessions[att.sessions.length - 1];
    const inside = !!(last && last.in && !last.out);
    rows.push({ employee: publicEmployee(emp), hours, flexible, attendance: att, status, inside });
  }
  rows.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  return rows;
}

/** Per-employee totals for a period, including days absent (work days without a check-in). */
function periodSummary(store, from, to, tz, now = new Date()) {
  const today = localDate(now, tz);
  const ctx = { tz, now, today, grace: store.settings.lateGraceMinutes };
  const records = store.listAttendance(from, to);
  const byEmp = new Map();
  for (const r of records) {
    if (!byEmp.has(r.employeeId)) byEmp.set(r.employeeId, []);
    byEmp.get(r.employeeId).push(r);
  }
  const out = [];
  for (const emp of store.employees.values()) {
    const recs = byEmp.get(emp.id) || [];
    if (emp.deleted && !recs.length) continue;
    if (!emp.active && !recs.length) continue;
    const s = {
      employeeId: emp.id, employeeNo: emp.employeeNo, name: emp.name, position: emp.position,
      flexible: store.isFlexible(emp),
      workDays: 0, presentDays: 0, absentDays: 0, lateCount: 0, lateMinutes: 0, earlyCount: 0, workedMinutes: 0, pay: 0, openSessions: 0,
    };
    const recByDate = new Map(recs.map((r) => [r.date, r]));
    const start = [from, employeeStartDate(emp, tz)].sort()[1];
    const end = [to, today].sort()[0];
    if (emp.active && !emp.deleted) {
      for (let d = start; d <= end; d = addDays(d, 1)) {
        const r = recByDate.get(d);
        const came = !!(r && (r.checkIn || r.checkOut));
        const exp = expectedAtWork(emp, d, store.getWorkHoursSync(emp, d), ctx);
        if (exp === 'yes' || (came && exp === 'pending')) s.workDays += 1;
        if (exp === 'yes' && !came) s.absentDays += 1;
      }
    }
    for (const r of recs) {
      if (r.checkIn || r.checkOut) s.presentDays += 1;
      if (r.lateMinutes > 0) { s.lateCount += 1; s.lateMinutes += r.lateMinutes; }
      if (r.earlyMinutes > 0) s.earlyCount += 1;
      s.workedMinutes += r.workedMinutes || 0;
      s.openSessions += r.openSessions || 0;
      s.pay += salaryFor(r);
    }
    out.push(s);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { records, summary: out };
}

function publicEmployee(e) {
  const { deviceSync, ...rest } = e;
  return { ...rest, deviceSync };
}

module.exports = { daySummary, periodSummary, addDays, publicEmployee, expectedAtWork };
