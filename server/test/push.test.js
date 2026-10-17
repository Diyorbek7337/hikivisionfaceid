'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../src/server');
const { MemoryStore } = require('./helpers');

const quiet = { log() {}, warn() {}, error() {} };

function event(employeeNo, dateTime, serialNo) {
  return JSON.stringify({
    dateTime, eventType: 'AccessControllerEvent',
    AccessControllerEvent: { majorEventType: 5, subEventType: 75, name: 'X', employeeNoString: employeeNo, serialNo },
  });
}

async function setup() {
  const store = new MemoryStore();
  store.addDevice({ id: 'in1', name: 'Kirish', direction: 'in', ip: '10.0.0.5' });
  store.addDevice({ id: 'out1', name: 'Chiqish', direction: 'out', ip: '10.0.0.6' });
  store.addEmployee({ id: 'e1', employeeNo: '1', name: 'Aziz', hourlyRate: 25000, telegramChatId: '111' });
  const sent = [];
  const telegram = { enabled: true, async send(c, t) { sent.push({ c, t }); }, async notifyAdmins(t) { sent.push({ c: 'admins', t }); } };
  const app = createServer({
    store, telegram, log: quiet,
    cfg: { timezone: 'Asia/Tashkent', webDir: '/nonexistent', webConfigPath: '/nonexistent.json' },
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    await app.locals.push.idle;
    return r;
  };
  return { store, sent, server, post };
}

test('check-in on entry terminal, check-out on exit terminal', async (t) => {
  const { store, server, post } = await setup();
  t.after(() => server.close());
  const d = '2026-01-15';
  await post('/hik/in1/event', event('1', `${d}T09:15:00+05:00`, 1));
  await post('/hik/in1/event', event('1', `${d}T09:15:00+05:00`, 1)); // re-sent
  await post('/hik/in1/event', event('1', `${d}T09:15:30+05:00`, 2)); // too soon
  await post('/hik/out1/event', event('1', `${d}T18:10:00+05:00`, 1));
  const a = store.attendance.get(`e1_${d}`);
  assert.equal(a.lateMinutes, 15);
  assert.equal(a.workedMinutes, 8 * 60 + 55);
  assert.equal(a.employeeName, 'Aziz');
  assert.equal(a.checkInDeviceName, 'Kirish');
  const actions = [...store.events.values()].map((e) => e.action);
  assert.deepEqual(actions, ['checkin', 'duplicate', 'checkout']);
});

test('unknown employee, unknown device, heartbeat', async (t) => {
  const { store, server, post } = await setup();
  t.after(() => server.close());
  await post('/hik/in1/event', event('99', '2026-01-15T09:00:00+05:00', 5));
  await post('/hik/zzz/event', event('1', '2026-01-15T09:00:00+05:00', 6));
  await post('/hik/in1/event', '{"eventType":"heartBeat"}');
  assert.deepEqual([...store.events.values()].map((e) => e.action), ['unknown_employee']);
});

test('fresh events send Telegram messages', async (t) => {
  const { sent, server, post } = await setup();
  t.after(() => server.close());
  const now = new Date();
  await post('/hik/in1/event', event('1', new Date(now - 5 * 60000).toISOString(), 10));
  await post('/hik/out1/event', event('1', now.toISOString(), 11));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(sent.some((m) => m.c === '111' && /Kelganingiz/.test(m.t)));
  assert.ok(sent.some((m) => m.c === '111' && /Ketganingiz/.test(m.t)));
});
