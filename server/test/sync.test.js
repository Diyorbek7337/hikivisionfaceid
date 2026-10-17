'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IsapiClient } = require('../src/isapi');
const { SyncEngine } = require('../src/sync');
const { DeviceMonitor } = require('../src/monitor');
const { MemoryStore, startFakeTerminal } = require('./helpers');

const quiet = { log() {}, warn() {}, error() {} };

async function setup(termOpts) {
  const term = await startFakeTerminal(termOpts);
  const store = new MemoryStore();
  store.addDevice({ id: 'd1', name: 'Kirish', ip: '127.0.0.1', port: term.port, username: 'admin', password: 'secret', direction: 'in' });
  const clientFor = (d) => new IsapiClient({ host: d.ip, port: d.port, username: d.username, password: d.password });
  const sync = new SyncEngine({ store, clientFor, log: quiet });
  return { term, store, sync, clientFor };
}

test('pushes new employees with faces, updates and removes them', async (t) => {
  const { term, store, sync } = await setup();
  t.after(() => term.close());
  store.addEmployee({ id: 'e1', employeeNo: '1', name: 'Aziz', hasFace: true });
  store.faces.set('e1', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  store.addEmployee({ id: 'e2', employeeNo: '2', name: 'Ali', hasFace: false });

  await sync.schedule();
  assert.deepEqual([...term.state.users.keys()].sort(), ['1', '2']);
  assert.ok(term.state.faces.has('1'));
  assert.equal(store.employees.get('e1').deviceSync.d1.status, 'ok');

  // Nothing changed -> nothing sent
  const before = term.state.requests.length;
  await sync.schedule();
  assert.equal(term.state.requests.length, before);

  // Rename -> modify
  Object.assign(store.employees.get('e2'), { name: 'Ali Valiyev', version: 2 });
  await sync.schedule();
  assert.equal(term.state.users.get('2').name, 'Ali Valiyev');

  // Deactivate -> removed from terminal
  Object.assign(store.employees.get('e1'), { active: false, version: 2 });
  await sync.schedule();
  assert.ok(!term.state.users.has('1'));
  assert.equal(store.employees.get('e1').deviceSync.d1.version, 2);
});

test('face errors are reported per employee and retried later', async (t) => {
  const { term, store, sync } = await setup({ faceError: 'faceQualityLow' });
  t.after(() => term.close());
  store.addEmployee({ id: 'e1', employeeNo: '1', name: 'Aziz', hasFace: true });
  store.faces.set('e1', Buffer.from([1, 2, 3]));
  await sync.schedule();
  const s = store.employees.get('e1').deviceSync.d1;
  assert.equal(s.status, 'error');
  assert.match(s.message, /yuz/i);
  assert.equal(sync.needsSync(store.employees.get('e1'), store.devices.get('d1')), false);
  sync.now = () => Date.now() + 120000;
  assert.equal(sync.needsSync(store.employees.get('e1'), store.devices.get('d1')), true);
});

test('resync request re-pushes everybody', async (t) => {
  const { term, store, sync } = await setup();
  t.after(() => term.close());
  store.addEmployee({ id: 'e1', employeeNo: '1', name: 'Aziz' });
  await sync.schedule();
  term.state.users.clear(); // someone wiped the terminal
  store.devices.get('d1').resyncRequestedAt = new Date('2026-01-01T00:00:00Z');
  await sync.schedule();
  assert.ok(term.state.users.has('1'));
  assert.equal(store.devices.get('d1').resyncDoneFor, new Date('2026-01-01T00:00:00Z').getTime());
});

test('monitor marks device online and fixes its clock', async (t) => {
  const { term, store, clientFor } = await setup();
  t.after(() => term.close());
  let onlineCalls = 0;
  const mon = new DeviceMonitor({ store, clientFor, tz: 'Asia/Tashkent', onOnline: () => { onlineCalls += 1; }, log: quiet });
  await mon.checkAll();
  const d = store.devices.get('d1');
  assert.equal(d.online, true);
  assert.equal(d.model, 'DS-K1T331W');
  assert.ok(term.state.setTimeBody, 'clock was set');
  assert.equal(onlineCalls, 1);

  store.updateDevice('d1', { password: 'wrong' });
  await mon.checkOne(store.devices.get('d1'));
  assert.equal(store.devices.get('d1').online, false);
  assert.match(store.devices.get('d1').lastError, /parol/);
});
