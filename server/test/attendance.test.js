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

test('auto terminal: backlog scans arriving out of order keep in = earliest, out = latest', async () => {
  const { store, emp } = setup();
  const dev = { id: 'a', name: 'A', direction: 'auto' };
  await scan(store, emp, dev, at('2026-10-15', '17:00'));
  await scan(store, emp, dev, at('2026-10-15', '08:00'));
  const r = await store.getAttendance(emp.id, '2026-10-15');
  assert.equal(r.checkIn.toISOString(), at('2026-10-15', '08:00').toISOString());
  assert.equal(r.checkOut.toISOString(), at('2026-10-15', '17:00').toISOString());
  assert.equal(r.workedMinutes, 540);
  assert.equal(r.lateMinutes, 0);
  // a scan in the middle of the day changes nothing
  assert.equal((await scan(store, emp, dev, at('2026-10-15', '12:00'))).action, 'repeat_in');
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
