'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDb } = require('../src/db');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { sign } = require('../src/auth');

function setup() {
  const cfg = loadConfig({
    ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'secret', SESSION_SECRET: 's'.repeat(32),
    DB_PATH: ':memory:', LATE_GRACE_MINUTES: '5', DEBOUNCE_SECONDS: '60', PUBLIC_URL: 'http://hik.example.com',
  });
  const repo = openDb(':memory:');
  const sent = [];
  const telegram = {
    enabled: true,
    async send(chatId, text) { sent.push({ chatId, text }); },
    async notifyAdmins(text) { sent.push({ chatId: 'admins', text }); },
  };
  const app = createApp({ repo, cfg, telegram });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const inDev = repo.getDevice(repo.saveDevice({ name: 'Kirish', direction: 'in' }));
  const outDev = repo.getDevice(repo.saveDevice({ name: 'Chiqish', direction: 'out' }));
  repo.saveEmployee({
    employee_no: '001', name: 'Aziz Karimov', work_start: '09:00', work_end: '18:00',
    hourly_rate: 25000, active: 1, telegram_chat_id: '111',
  });
  return { cfg, repo, sent, server, base, inDev, outDev };
}

function event(employeeNo, dateTime, serialNo) {
  return JSON.stringify({
    dateTime, eventType: 'AccessControllerEvent', ipAddress: '192.168.1.50',
    AccessControllerEvent: { majorEventType: 5, subEventType: 75, name: 'X', employeeNoString: employeeNo, serialNo },
  });
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
const iso = (localHHMM, date = null) => {
  // Builds a Tashkent (+05:00) time for today so notifications are "fresh"
  const d = date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent' }).format(new Date());
  return `${d}T${localHHMM}:00+05:00`;
};

test('two-terminal flow: check-in late, check-out, salary, dedup', async (t) => {
  const ctx = setup();
  t.after(() => ctx.server.close());
  const { repo, base, inDev, outDev, sent } = ctx;
  const date = '2026-01-15';

  let r = await post(`${base}/hik/${inDev.token}/event`, event('001', iso('09:15', date), 1));
  assert.equal(r.status, 200);
  // Same event re-sent by the terminal -> ignored
  await post(`${base}/hik/${inDev.token}/event`, event('001', iso('09:15', date), 1));
  // Second face read 20s later -> duplicate
  await post(`${base}/hik/${inDev.token}/event`, event('001', `${date}T09:15:20+05:00`, 2));

  const emp = repo.getEmployeeByNo('001');
  let att = repo.getAttendance(emp.id, date);
  assert.equal(att.late_minutes, 15);
  assert.equal(att.check_out_at, null);

  await post(`${base}/hik/${outDev.token}/event`, event('001', iso('17:45', date), 1));
  att = repo.getAttendance(emp.id, date);
  assert.equal(att.worked_minutes, 8 * 60 + 30);
  assert.equal(att.early_minutes, 15);

  // Later exit replaces the earlier one
  await post(`${base}/hik/${outDev.token}/event`, event('001', iso('18:10', date), 2));
  att = repo.getAttendance(emp.id, date);
  assert.equal(att.worked_minutes, 8 * 60 + 55);
  assert.equal(att.early_minutes, 0);

  const actions = repo.listEvents().map((e) => e.action).reverse();
  assert.deepEqual(actions, ['checkin', 'duplicate', 'checkout', 'checkout']);
  // Old date -> no Telegram notifications
  assert.equal(sent.length, 0);
});

test('auto direction and notifications for fresh events', async (t) => {
  const ctx = setup();
  t.after(() => ctx.server.close());
  const { repo, base, sent } = ctx;
  const dev = repo.getDevice(repo.saveDevice({ name: 'Bitta', direction: 'auto' }));
  const now = new Date();
  const ts = (offsetMin) => new Date(now.getTime() + offsetMin * 60000).toISOString();

  await post(`${base}/hik/${dev.token}/event`, event('001', ts(-5), 10));
  await post(`${base}/hik/${dev.token}/event`, event('001', ts(0), 11));
  await new Promise((r) => setTimeout(r, 50));
  const actions = repo.listEvents().map((e) => e.action).reverse();
  assert.deepEqual(actions, ['checkin', 'checkout']);
  assert.ok(sent.some((m) => m.chatId === '111' && m.text.includes('Kelganingiz')));
  assert.ok(sent.some((m) => m.chatId === '111' && m.text.includes('Ketganingiz')));
});

test('unknown employee, unknown device, heartbeat, garbage', async (t) => {
  const ctx = setup();
  t.after(() => ctx.server.close());
  const { repo, base, inDev } = ctx;
  let r = await post(`${base}/hik/nope/event`, event('001', iso('09:00'), 1));
  assert.equal(r.status, 404);
  r = await post(`${base}/hik/${inDev.token}/event`, event('999', iso('09:00'), 5));
  assert.equal(r.status, 200);
  await post(`${base}/hik/${inDev.token}/event`, '{"eventType":"heartBeat"}');
  await post(`${base}/hik/${inDev.token}/event`, 'xxx');
  const actions = repo.listEvents().map((e) => e.action).reverse();
  assert.deepEqual(actions, ['unknown_employee', 'unparsed']);
  assert.ok(repo.getDevice(inDev.id).last_seen_at);
});

test('admin panel requires login and renders pages', async (t) => {
  const ctx = setup();
  t.after(() => ctx.server.close());
  const { base, cfg } = ctx;
  let r = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=wrong',
  });
  assert.equal(r.status, 401);
  r = await fetch(`${base}/admin/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=secret',
  });
  assert.equal(r.status, 302);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie.startsWith('hik_session='));

  for (const p of ['/admin', '/admin/employees', '/admin/employees/new', '/admin/devices', '/admin/devices/new',
    '/admin/attendance', '/admin/events', '/admin/attendance.csv']) {
    r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(r.status, 200, p);
  }
  r = await fetch(`${base}/admin/devices`, { headers: { cookie } });
  assert.match(await r.text(), /\/hik\/[0-9a-f]{24}\/event/);

  // Create an employee via the form; duplicate Terminal ID is rejected
  r = await fetch(`${base}/admin/employees/new`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Ali&employee_no=002&work_start=08:30&work_end=17:30&hourly_rate=20000&active=1',
  });
  assert.equal(r.status, 302);
  r = await fetch(`${base}/admin/employees/new`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Vali&employee_no=002&work_start=08:30&work_end=17:30',
  });
  assert.equal(r.status, 400);

  // Expired / forged session
  const forged = sign({ u: 'admin', exp: 1 }, cfg.sessionSecret);
  r = await fetch(`${base}/admin`, { headers: { cookie: `hik_session=${forged}` }, redirect: 'manual' });
  assert.equal(r.status, 302);
});
