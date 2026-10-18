'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { IsapiClient } = require('../src/isapi');
const { EventPoller } = require('../src/poller');
const { createEventProcessor } = require('../src/events');
const { createServer } = require('../src/server');
const { startFakeTerminal } = require('./helpers');

const quiet = { log() {}, warn() {}, error() {} };
const tz = 'Asia/Tashkent';
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString().replace('Z', '+00:00');

async function setup() {
  const term = await startFakeTerminal();
  const store = new LocalStore(openDatabase(':memory:'));
  const devId = store.saveDevice({ name: 'Kirish', ip: '127.0.0.1', port: term.port, password: 'secret', direction: 'auto' });
  const empId = store.createEmployee({ name: 'Diyorbek' });
  // Registered and device added 10 minutes ago
  const tenMin = new Date(Date.now() - 10 * 60000).toISOString();
  store.db.prepare('UPDATE employees SET created_at = ?').run(tenMin);
  store.db.prepare('UPDATE devices SET created_at = ?').run(tenMin);
  store.reloadEmployees(false);
  store.reloadDevices(false);
  const processor = createEventProcessor({ store, tz, telegram: null, log: quiet });
  const clientFor = (d) => new IsapiClient({ host: d.ip, port: d.port, username: d.username, password: d.password });
  const poller = new EventPoller({ store, clientFor, processor, tz, log: quiet });
  return { term, store, devId, empId, processor, poller };
}

test('poller reads face events from the terminal log (no push needed)', async (t) => {
  const { term, store, devId, empId, poller } = await setup();
  t.after(() => term.close());
  const emp = store.getEmployee(empId);
  term.state.events.push(
    // old owner's event from yesterday with the same number -> must be ignored
    { major: 5, minor: 75, time: iso(26 * 3600000), employeeNoString: emp.employeeNo, serialNo: 1 },
    { major: 5, minor: 21, time: iso(3 * 60000), serialNo: 2 }, // door unlocked
    { major: 5, minor: 75, time: iso(3 * 60000), employeeNoString: emp.employeeNo, name: 'Diyorbek', serialNo: 3 },
  );
  await poller.tick();
  const today = require('../src/time').localDate(new Date(), tz);
  const att = await store.getAttendance(empId, today);
  assert.ok(att && att.checkIn, 'checked in');
  assert.equal(store.listEvents().length, 1);
  assert.ok(store.getDevice(devId).pollCursor > 0);

  // second tick: nothing new, nothing duplicated
  await poller.tick();
  assert.equal(store.listEvents().length, 1);

  // leaving 2 minutes later -> auto direction makes it a check-out
  term.state.events.push({ major: 5, minor: 75, time: iso(30000), employeeNoString: emp.employeeNo, serialNo: 4 });
  await poller.tick();
  assert.ok((await store.getAttendance(empId, today)).checkOut, 'checked out');
});

test('the same scan arriving by push and by polling is stored once', async (t) => {
  const { term, store, devId, empId, processor, poller } = await setup();
  t.after(() => term.close());
  const emp = store.getEmployee(empId);
  const when = iso(60000);
  term.state.events.push({ major: 5, minor: 75, time: when, employeeNoString: emp.employeeNo, serialNo: 7 });
  const app = createServer({ store, processor, cfg: { timezone: tz, webDir: '/none' }, log: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => server.close());
  await fetch(`http://127.0.0.1:${server.address().port}/hik/${devId}/event`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dateTime: when, eventType: 'AccessControllerEvent', AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: emp.employeeNo, serialNo: 7 } }),
  });
  await app.locals.push.idle;
  await poller.tick();
  assert.equal(store.listEvents().length, 1);
  assert.equal(store.listEvents()[0].action, 'checkin');
});
