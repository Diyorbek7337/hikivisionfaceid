'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { processScan } = require('../src/attendance');
const { daySummary, periodSummary } = require('../src/summary');

const tz = 'Asia/Tashkent';
const at = (d, hm) => new Date(`${d}T${hm}:00+05:00`);

function setup() {
  const store = new LocalStore(openDatabase(':memory:'));
  const id = store.createEmployee({ name: 'Ali' });
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);
  const emp = store.getEmployee(id);
  return { store, emp };
}
const scan = (store, emp, device, time) => processScan(store, store.settings, tz, device, { employeeNo: emp.employeeNo, time });

test('auto terminal: backlog scans arriving out of order give the same sessions', async () => {
  const { store, emp } = setup();
  const dev = { id: 'a', name: 'A', direction: 'auto' };
  await scan(store, emp, dev, at('2026-10-15', '17:00'));
  await scan(store, emp, dev, at('2026-10-15', '08:00'));
  const r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.checkIn.toISOString(), at('2026-10-15', '08:00').toISOString());
  assert.equal(r.checkOut.toISOString(), at('2026-10-15', '17:00').toISOString());
  assert.equal(r.workedMinutes, 540);
  assert.equal(r.lateMinutes, 0);
  // one terminal for both ways: scans alternate arrival / departure in time order
  assert.equal((await scan(store, emp, dev, at('2026-10-15', '12:00'))).action, 'checkout');
  assert.equal((await scan(store, emp, dev, at('2026-10-15', '13:00'))).action, 'checkin');
  const r2 = await store.getAttendance(emp.id, '2026-10-15');
  assert.deepEqual(r2.sessions.map((x) => x.minutes), [240, 240]);
  assert.equal(r2.workedMinutes, 480);
  assert.equal(r2.checkOut.toISOString(), at('2026-10-15', '17:00').toISOString());
});

test('sessions: in/out terminals, lunch break is not work time, open sessions are flagged', async () => {
  const { store, emp } = setup();
  const kir = { id: 'k', name: 'Kirish', direction: 'in' };
  const chiq = { id: 'c', name: 'Chiqish', direction: 'out' };
  const s1 = await scan(store, emp, kir, at('2026-10-15', '08:10'));
  assert.equal(s1.action, 'checkin');
  assert.equal(s1.firstOfDay, true);
  assert.equal(s1.record.lateMinutes, 10);
  assert.equal((await scan(store, emp, chiq, at('2026-10-15', '10:00'))).action, 'checkout');
  const s3 = await scan(store, emp, kir, at('2026-10-15', '14:00'));
  assert.equal(s3.action, 'checkin');
  assert.equal(s3.firstOfDay, false);
  let r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.checkOut, null, 'inside again: no departure yet');
  assert.equal(r.workedMinutes, 110);
  assert.equal(r.openSessions, 1);
  assert.equal(r.lateMinutes, 10, 'lateness is measured from the first arrival only');
  const s4 = await scan(store, emp, chiq, at('2026-10-15', '16:00'));
  assert.equal(s4.action, 'checkout');
  assert.equal(s4.session.minutes, 120);
  r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.workedMinutes, 230, '08:10–10:00 + 14:00–16:00, not 08:10–16:00');
  assert.equal(r.earlyMinutes, 60);
  assert.equal(r.openSessions, 0);
  assert.equal(r.sessions.length, 2);
  assert.equal(r.sessions[1].inDeviceName, 'Kirish');

  // forgot to scan out, came in again: the first visit stays open
  await scan(store, emp, kir, at('2026-10-16', '08:00'));
  await scan(store, emp, kir, at('2026-10-16', '13:00'));
  await scan(store, emp, chiq, at('2026-10-16', '17:00'));
  r = await store.getAttendance(emp.id, '2026-10-16');
  assert.deepEqual(r.sessions.map((x) => [!!x.in, !!x.out]), [[true, false], [true, true]]);
  assert.equal(r.workedMinutes, 240);
  assert.equal(r.openSessions, 1);

  // a departure delivered late (terminal backlog) still closes the right session
  await scan(store, emp, kir, at('2026-10-17', '08:00'));
  await scan(store, emp, kir, at('2026-10-17', '13:00'));
  await scan(store, emp, chiq, at('2026-10-17', '12:00'));
  r = await store.getAttendance(emp.id, '2026-10-17');
  assert.deepEqual(r.sessions.map((x) => x.minutes), [240, null]);

  // the same face twice within the debounce window counts once
  const twentySecondsLater = new Date(at('2026-10-17', '12:00').getTime() + 20000);
  assert.equal((await scan(store, emp, chiq, twentySecondsLater)).action, 'duplicate');
});

test('records saved by older versions (check-in / check-out only) keep working', async () => {
  const { store, emp } = setup();
  store.db.prepare(`INSERT INTO attendance (employee_id, date, check_in, check_in_device_name, check_out, work_start, work_end, late_minutes, worked_minutes)
    VALUES (?, '2026-10-15', ?, 'Kirish', ?, '08:00', '17:00', 0, 540)`).run(emp.id, at('2026-10-15', '08:00').toISOString(), at('2026-10-15', '17:00').toISOString());
  let r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].inDeviceName, 'Kirish');
  // a new scan on that day adds to the old times
  await scan(store, emp, { id: 'k', name: 'Kirish', direction: 'in' }, at('2026-10-15', '18:00'));
  r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.sessions.length, 2);
  assert.equal(r.workedMinutes, 540);
});

test('snapshot of work hours is kept for the day even if the schedule changes', async () => {
  const { store, emp } = setup();
  const dev = { id: 'a', name: 'A', direction: 'auto' };
  await scan(store, emp, dev, at('2026-10-15', '08:30'));
  const s = store.listSchedules()[0];
  store.saveSchedule({ ...s, days: { ...s.days, 4: { start: '09:00', end: '17:00' } } });
  await scan(store, emp, dev, at('2026-10-15', '17:00'));
  const r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.lateMinutes, 30);
  assert.equal(r.workStart, '08:00');
});

test('afternoon shift is "pending", not absent, in the morning; registration day is not counted', () => {
  const { store, emp } = setup();
  const sid = store.saveSchedule({ name: '2-smena', days: { 1: { start: '13:00', end: '18:00' }, 2: null, 3: null, 4: { start: '13:00', end: '18:00' }, 5: null, 6: null, 0: null } });
  store.updateEmployee(emp.id, { ...emp, scheduleId: sid });
  const morning = at('2026-10-15', '09:30'); // Thursday
  assert.equal(daySummary(store, '2026-10-15', tz, morning)[0].status, 'pending');
  assert.equal(daySummary(store, '2026-10-15', tz, at('2026-10-15', '13:30'))[0].status, 'absent');
  const p = periodSummary(store, '2026-10-15', '2026-10-15', tz, morning).summary[0];
  assert.equal(p.absentDays, 0);

  // registered at 15:00 on a work day -> that day is not "absent"
  store.db.prepare("UPDATE employees SET created_at = ?").run(at('2026-10-12', '15:00').toISOString()); // Monday
  store.reloadEmployees(false);
  assert.equal(daySummary(store, '2026-10-12', tz, at('2026-10-20', '12:00'))[0].status, 'off');
});

test('the default schedule cannot be deleted while employees implicitly use it', () => {
  const { store } = setup();
  store.saveSchedule({ name: 'Boshqa', days: {} });
  const first = store.listSchedules()[0];
  assert.throws(() => store.deleteSchedule(first.id), /biriktirilgan/);
});

test('personal schedule: only the employee\'s own days count, shared schedules ignore them', () => {
  const { store, emp } = setup();
  const days = { 0: null, 1: { start: '08:00', end: '12:00' }, 2: null, 3: null, 4: { start: '14:00', end: '16:00' }, 5: null, 6: null };
  store.updateEmployee(emp.id, { ...emp, personalSchedule: { days } });
  const e = store.getEmployee(emp.id);
  assert.deepEqual(e.personalSchedule.days['4'], { start: '14:00', end: '16:00' });
  assert.deepEqual(store.getWorkHoursSync(e, '2026-10-15'), { start: '14:00', end: '16:00' }); // Thursday
  assert.equal(store.getWorkHoursSync(e, '2026-10-14'), null); // Wednesday: day off for this person
  // Wednesday is not "absent", Thursday afternoon is pending in the morning
  assert.equal(daySummary(store, '2026-10-14', tz, at('2026-10-14', '18:00'))[0].status, 'off');
  assert.equal(daySummary(store, '2026-10-15', tz, at('2026-10-15', '10:00'))[0].status, 'pending');
  const week = periodSummary(store, '2026-10-12', '2026-10-18', tz, at('2026-10-19', '09:00')).summary[0];
  assert.equal(week.workDays, 2);
  assert.equal(week.absentDays, 2);
  // the default schedule is not "used" by someone with a personal schedule -> can be deleted once another exists
  store.saveSchedule({ name: 'Boshqa', days: {} });
  store.deleteSchedule(store.listSchedules()[0].id);
  // back to the shared schedule
  store.updateEmployee(emp.id, { ...e, personalSchedule: null });
  assert.equal(store.getEmployee(emp.id).personalSchedule, null);
});

test('flexible schedule: no lateness, no absence; presence and hours still counted', async () => {
  const { store, emp } = setup();
  // shared flexible schedule
  const sid = store.saveSchedule({ name: 'O\'qituvchilar', type: 'flexible', days: {} });
  store.updateEmployee(emp.id, { ...emp, scheduleId: sid });
  let e = store.getEmployee(emp.id);
  assert.equal(store.isFlexible(e), true);
  assert.equal(store.getWorkHoursSync(e, '2026-10-15'), null);
  const dev = { id: 'a', name: 'A', direction: 'auto' };
  await scan(store, e, dev, at('2026-10-15', '11:40'));
  await scan(store, e, dev, at('2026-10-15', '13:10'));
  const r = await store.getAttendance(e.id, '2026-10-15');
  assert.equal(r.lateMinutes, 0);
  assert.equal(r.earlyMinutes, 0);
  assert.equal(r.workedMinutes, 90);
  assert.equal(daySummary(store, '2026-10-15', tz, at('2026-10-15', '18:00'))[0].status, 'present');
  assert.equal(daySummary(store, '2026-10-16', tz, at('2026-10-16', '18:00'))[0].status, 'free');
  const p = periodSummary(store, '2026-10-12', '2026-10-17', tz, at('2026-10-18', '09:00')).summary[0];
  assert.equal(p.flexible, true);
  assert.equal(p.absentDays, 0);
  assert.equal(p.presentDays, 1);
  assert.equal(p.workedMinutes, 90);

  // personal flexible schedule works the same way
  store.updateEmployee(emp.id, { ...e, scheduleId: null, personalSchedule: { type: 'flexible', days: {} } });
  e = store.getEmployee(emp.id);
  assert.equal(store.isFlexible(e), true);
  assert.equal(daySummary(store, '2026-10-16', tz, at('2026-10-16', '18:00'))[0].status, 'free');
  // the daily Telegram report does not list them as expected at work
  const { buildDailyReport } = require('../src/report');
  assert.equal(buildDailyReport(store, '2026-10-16', tz), null);
});
