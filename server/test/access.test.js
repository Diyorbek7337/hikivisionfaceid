'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { IsapiClient } = require('../src/isapi');
const { SyncEngine } = require('../src/sync');
const { createAuth } = require('../src/auth');
const { createApi } = require('../src/api');
const { createServer } = require('../src/server');
const { startFakeTerminal } = require('./helpers');

const quiet = { log() {}, warn() {}, error() {} };
const WORK = { 0: null, 1: { start: '07:00', end: '19:00' }, 2: { start: '07:00', end: '19:00' }, 3: null, 4: null, 5: null, 6: null };

async function setup() {
  const kir = await startFakeTerminal();
  const chiq = await startFakeTerminal();
  const store = new LocalStore(openDatabase(':memory:'));
  store.saveDevice({ name: 'Kirish', ip: '127.0.0.1', port: kir.port, username: 'admin', password: 'secret', direction: 'in' });
  store.saveDevice({ name: 'Chiqish', ip: '127.0.0.1', port: chiq.port, username: 'admin', password: 'secret', direction: 'out' });
  const clientFor = (d) => new IsapiClient({ host: d.ip, port: d.port, username: d.username, password: d.password });
  const sync = new SyncEngine({ store, clientFor, log: quiet });
  const dev = (name) => [...store.devices.values()].find((d) => d.name === name);
  return { kir, chiq, store, sync, clientFor, dev };
}

test('entry schedules: written to terminals, people refer to them, exit terminal stays "any time"', async (t) => {
  const { kir, chiq, store, sync } = await setup();
  t.after(() => Promise.all([kir.close(), chiq.close()]));
  const pid = store.saveAccessProfile({ name: 'Ish vaqti', days: WORK });
  const slot = store.getAccessProfile(pid).slot;
  assert.equal(slot, 2);
  const a = store.getEmployee(store.createEmployee({ name: 'Aziz', accessProfileId: pid }));
  store.createEmployee({ name: 'Bobur' });
  await sync.schedule();

  // the week plan and the template are on the entrance terminal
  const plan = kir.state.weekPlans.get(slot);
  assert.deepEqual(plan.WeekPlanCfg.find((d) => d.week === 'Monday').TimeSegment, { beginTime: '07:00:00', endTime: '19:00:00' });
  assert.equal(plan.WeekPlanCfg.find((d) => d.week === 'Sunday').enable, false);
  assert.equal(kir.state.templates.get(slot).weekPlanNo, slot);
  assert.equal(kir.state.users.get(a.employeeNo).RightPlan[0].planTemplateNo, String(slot));
  assert.equal(kir.state.users.get('2').RightPlan[0].planTemplateNo, '1', 'no schedule = any time');
  // exit terminal: never restricted
  assert.equal(chiq.state.users.get(a.employeeNo).RightPlan[0].planTemplateNo, '1');

  // editing the schedule rewrites it; nothing else is sent again
  const usersBefore = kir.state.requests.filter((r) => r.includes('UserInfo')).length;
  store.saveAccessProfile({ id: pid, name: 'Ish vaqti', days: { ...WORK, 1: { start: '06:30', end: '20:00' } } });
  await sync.schedule();
  assert.equal(kir.state.weekPlans.get(slot).WeekPlanCfg.find((d) => d.week === 'Monday').TimeSegment.beginTime, '06:30:00');
  assert.equal(kir.state.requests.filter((r) => r.includes('UserInfo')).length, usersBefore);

  // in use -> cannot delete; after unassigning it can, and the slot is reused
  assert.throws(() => store.deleteAccessProfile(pid), /biriktirilgan/);
  store.updateEmployee(a.id, { ...a, accessProfileId: null });
  await sync.schedule();
  assert.equal(kir.state.users.get(a.employeeNo).RightPlan[0].planTemplateNo, '1');
  store.deleteAccessProfile(pid);
  assert.equal(store.getAccessProfile(store.saveAccessProfile({ name: 'Yangi', days: WORK })).slot, 2);
});

test('terminal without entry schedules: people still get in at any time', async (t) => {
  const { kir, chiq, store, sync, dev } = await setup();
  t.after(() => Promise.all([kir.close(), chiq.close()]));
  const orig = IsapiClient.prototype.setAccessPlan;
  IsapiClient.prototype.setAccessPlan = async () => { throw Object.assign(new Error('notSupport'), { status: 404, subStatusCode: 'notSupport' }); };
  t.after(() => { IsapiClient.prototype.setAccessPlan = orig; });
  const pid = store.saveAccessProfile({ name: 'Ish vaqti', days: WORK });
  store.createEmployee({ name: 'Aziz', accessProfileId: pid });
  await sync.schedule();
  assert.match(dev('Kirish').accessPlanError, /notSupport/);
  assert.equal(kir.state.users.get('1').RightPlan[0].planTemplateNo, '1');
  // firmware updated -> schedules accepted -> the person is sent again with the schedule
  IsapiClient.prototype.setAccessPlan = orig;
  store.requestResync(dev('Kirish').id);
  await sync.schedule();
  assert.equal(dev('Kirish').accessPlanError, '');
  assert.equal(kir.state.users.get('1').RightPlan[0].planTemplateNo, '2');
});

test('door control from the web app is sent to the terminal and logged', async (t) => {
  const { kir, chiq, store, clientFor, dev } = await setup();
  t.after(() => Promise.all([kir.close(), chiq.close()]));
  const auth = createAuth({ store, secret: 's' });
  const cfg = { timezone: 'Asia/Tashkent', port: 3000, webDir: '/nonexistent' };
  const api = createApi({ store, auth, cfg, sync: { schedule() {} }, backup: {}, clientFor, version: 't' });
  const app = createServer({ store, cfg, api, telegram: null, log: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  const id = dev('Kirish').id;
  const log = console.log;
  console.log = () => {};
  t.after(() => { console.log = log; });
  assert.equal((await call('POST', `/api/devices/${id}/door`, { cmd: 'open' })).status, 200);
  assert.equal((await call('POST', `/api/devices/${id}/door`, { cmd: 'alwaysOpen' })).status, 200);
  assert.equal(dev('Kirish').doorMode, 'alwaysOpen');
  assert.equal((await call('POST', `/api/devices/${id}/door`, { cmd: 'close' })).status, 200);
  assert.equal(dev('Kirish').doorMode, 'normal');
  assert.equal((await call('POST', `/api/devices/${id}/door`, { cmd: 'alwaysClose' })).status, 400);
  assert.deepEqual(kir.state.doorCommands, ['open', 'alwaysOpen', 'close']);
  const events = (await call('GET', '/api/events')).body;
  assert.deepEqual(events.map((e) => e.action).sort(), ['door_always_open', 'door_normal', 'door_open']);
  assert.equal(events[0].personName, 'admin');
  // unreachable terminal: a clear error
  store.saveDevice({ ...dev('Chiqish'), port: 1 });
  const bad = await call('POST', `/api/devices/${dev('Chiqish').id}/door`, { cmd: 'open' });
  assert.equal(bad.status, 502);
  assert.match(bad.body.error, /Terminal buyruqni bajarmadi/);
  // the access schedule API validates
  assert.equal((await call('POST', '/api/access-profiles', { name: 'Bo\'sh', days: {} })).status, 400);
  const p = await call('POST', '/api/access-profiles', { name: 'Ish vaqti', days: WORK });
  assert.equal(p.status, 200);
  assert.equal((await call('POST', '/api/employees', { name: 'X', accessProfileId: 999 })).status, 400);
  assert.equal((await call('POST', '/api/employees', { name: 'X', accessProfileId: p.body.id })).body.accessProfileId, p.body.id);
  assert.equal((await call('GET', '/api/access-profiles')).body[0].employees, 1);
});
