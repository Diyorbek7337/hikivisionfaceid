'use strict';
/** Day and period summaries shared by the API (dashboard, report) and the Telegram daily report. */
const { localDate } = require('./time');
const { salaryFor } = require('./attendance');

function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function employeeStartDate(emp, tz) {
  return emp.createdAt ? localDate(new Date(emp.createdAt), tz) : '2000-01-01';
}

/** Status of every active employee on one date. */
function daySummary(store, date, tz) {
  const rows = [];
  const attendance = new Map(store.listAttendance(date, date).map((a) => [a.employeeId, a]));
  for (const emp of store.employees.values()) {
    if (!emp.active || emp.deleted) continue;
    const hours = store.getWorkHoursSync(emp, date);
    const att = attendance.get(emp.id) || null;
    let status;
    if (att && att.checkIn) status = att.lateMinutes > 0 ? 'late' : 'present';
    else if (att && att.checkOut) status = 'present';
    else if (!hours) status = 'off';
    else if (date < employeeStartDate(emp, tz)) status = 'off';
    else status = 'absent';
    rows.push({ employee: publicEmployee(emp), hours, attendance: att, status });
  }
  rows.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
  return rows;
}

/** Per-employee totals for a period, including days absent (work days without a check-in). */
function periodSummary(store, from, to, tz) {
  const today = localDate(new Date(), tz);
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
      workDays: 0, presentDays: 0, absentDays: 0, lateCount: 0, lateMinutes: 0, earlyCount: 0, workedMinutes: 0, pay: 0,
    };
    const recByDate = new Map(recs.map((r) => [r.date, r]));
    const start = [from, employeeStartDate(emp, tz)].sort()[1];
    const end = [to, today].sort()[0];
    if (emp.active && !emp.deleted) {
      for (let d = start; d <= end; d = addDays(d, 1)) {
        if (!store.getWorkHoursSync(emp, d)) continue;
        s.workDays += 1;
        const r = recByDate.get(d);
        if (!(r && (r.checkIn || r.checkOut))) s.absentDays += 1;
      }
    }
    for (const r of recs) {
      if (r.checkIn || r.checkOut) s.presentDays += 1;
      if (r.lateMinutes > 0) { s.lateCount += 1; s.lateMinutes += r.lateMinutes; }
      if (r.earlyMinutes > 0) s.earlyCount += 1;
      s.workedMinutes += r.workedMinutes || 0;
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

module.exports = { daySummary, periodSummary, addDays, publicEmployee };
