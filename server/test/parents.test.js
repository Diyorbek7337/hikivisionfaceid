'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore, normCode } = require('../src/store');
const { createBotHandler } = require('../src/bot');
const { createEventProcessor } = require('../src/events');

const tz = 'Asia/Tashkent';
const quiet = { log() {}, warn() {}, error() {} };

function setup() {
  const store = new LocalStore(openDatabase(':memory:'));
  const sent = [];
  const telegram = {
    enabled: true,
    async send(chat, text) {
      if (chat === 'blocked') throw Object.assign(new Error('Forbidden: bot was blocked by the user'), { code: 403 });
      sent.push([chat, text]);
    },
    async notifyAdmins() {},
    async call() {},
  };
  const handle = createBotHandler({ store, cfg: { timezone: tz, adminTelegramIds: [] }, telegram });
  const msg = (id, text, first = 'Ona') => ({ chat: { id, type: 'private' }, from: { id, first_name: first }, text });
  return { store, sent, telegram, handle, msg };
}

test('student codes: every student gets one; parents link by code or by /start CODE; wrong codes are limited', async () => {
  const { store, handle, msg } = setup();
  const id = store.createEmployee({ name: 'Aliyev Jasur', kind: 'student', className: '9-A' });
  const staff = store.createEmployee({ name: 'Ustoz' });
  const jasur = store.getEmployee(id);
  assert.match(jasur.linkCode, /^[A-Z2-9]{8}$/);
  assert.equal(store.getEmployee(staff).linkCode, '', 'staff have no code');
  assert.equal(normCode(' abcd-2345 '), 'ABCD2345');

  // by QR link (/start CODE) and by typing the code with spaces / lower case
  assert.match((await handle(msg(10, `/start ${jasur.linkCode}`))).text, /Ulandingiz: <b>Aliyev Jasur<\/b> \(9-A\)/);
  const typed = `${jasur.linkCode.slice(0, 4).toLowerCase()} ${jasur.linkCode.slice(4)}`;
  assert.match((await handle(msg(20, typed, 'Ota'))).text, /Ulandingiz/);
  assert.deepEqual(store.parentChats(id).sort(), ['10', '20']);
  assert.match((await handle(msg(10, '/farzandlarim'))).text, /Aliyev Jasur/);

  // a new code: the old one stops working, linked parents stay
  const old = jasur.linkCode;
  store.setLinkCode(id);
  assert.match((await handle(msg(30, old))).text, /topilmadi/);
  assert.equal(store.parentChats(id).length, 2);

  // guessing is limited
  for (let i = 0; i < 10; i += 1) await handle(msg(40, 'ZZZZ2222'));
  assert.match((await handle(msg(40, store.getEmployee(id).linkCode))).text, /Juda ko'p/);

  // /uzish
  assert.match((await handle(msg(20, '/uzish'))).text, /to'xtatildi/);
  assert.deepEqual(store.parentChats(id), ['10']);
  // deleting the student drops the links
  store.deleteEmployee(id);
  assert.deepEqual(store.parentChats(id), []);
});

test('parents get arrival / departure messages; staff scans and old backlog do not notify; blocked chats are dropped', async () => {
  const { store, sent, telegram, msg, handle } = setup();
  const id = store.createEmployee({ name: 'Karimova Laylo', kind: 'student', className: '9-B' });
  store.createEmployee({ name: 'Ustoz' });
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);
  const code = store.getEmployee(id).linkCode;
  await handle(msg(10, code));
  store.linkParent(id, 'blocked', 'X');
  const kir = { id: 'k', name: 'Kirish', direction: 'in' };
  const chiq = { id: 'c', name: 'Chiqish', direction: 'out' };
  const proc = createEventProcessor({ store, tz, telegram, log: quiet });
  const now = Date.now();
  await proc.process(kir, { major: 5, minor: 75, employeeNo: store.getEmployee(id).employeeNo, time: new Date(now - 60 * 60000), serialNo: 1 });
  await proc.process(kir, { major: 5, minor: 75, employeeNo: '2', time: new Date(now - 50 * 60000), serialNo: 2 });
  await proc.process(chiq, { major: 5, minor: 75, employeeNo: store.getEmployee(id).employeeNo, time: new Date(now - 5 * 60000), serialNo: 3 });
  await proc.process(kir, { major: 5, minor: 75, employeeNo: store.getEmployee(id).employeeNo, time: new Date(now - 60000), serialNo: 4 });
  await new Promise((r) => setTimeout(r, 20));
  const texts = sent.filter(([c]) => c === '10').map(([, t]) => t);
  // the first scan is 60 min old (backlog) -> not announced; departure and return are
  assert.equal(texts.length, 2, JSON.stringify(texts));
  assert.match(texts[0], /Karimova Laylo<\/b> \(9-B\) maktabdan chiqdi/);
  assert.match(texts[1], /maktabga qaytib keldi/);
  assert.deepEqual(store.parentChats(id), ['10'], 'blocked chat removed');
  // switched off in settings
  store.saveSettings({ parentNotifications: false });
  await proc.process(chiq, { major: 5, minor: 75, employeeNo: store.getEmployee(id).employeeNo, time: new Date(), serialNo: 5 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sent.filter(([c]) => c === '10').length, 2);
});

test('slips API: codes per class; teachers see their own classes only; new code / unlink', async (t) => {
  const { createAuth } = require('../src/auth');
  const { createApi } = require('../src/api');
  const { createServer } = require('../src/server');
  const store = new LocalStore(openDatabase(':memory:'));
  const cfg = { timezone: tz, port: 3000, webDir: '/nonexistent', botUsername: 'maktab5_bot' };
  const api = createApi({ store, auth: createAuth({ store, secret: 's' }), cfg, sync: { schedule() {} }, backup: {}, clientFor: () => null, version: 't' });
  const server = await new Promise((r) => { const s = createServer({ store, cfg, api, telegram: null, log: quiet }).listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => server.close());
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json() };
  };
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  await call('POST', '/api/employees/import', { kind: 'student', rows: [{ name: 'A', className: '9-A' }, { name: 'B', className: '9-B' }] });
  // a student from an older version without a code gets one
  store.db.prepare("UPDATE employees SET link_code = NULL WHERE name = 'B'").run();
  store.reloadEmployees(false);
  const all = await call('GET', '/api/parents/slips');
  assert.equal(all.body.botUsername, 'maktab5_bot');
  assert.ok(all.body.students.every((x) => /^[A-Z2-9]{8}$/.test(x.code)));
  assert.deepEqual((await call('GET', '/api/parents/slips?class=9%20a')).body.students.map((x) => x.name), ['A']);
  const a = all.body.students.find((x) => x.name === 'A');
  store.linkParent(a.id, '77', 'Ona');
  assert.equal((await call('GET', '/api/employees')).body.find((e) => e.name === 'A').parents, 1);
  const nc = await call('POST', `/api/employees/${a.id}/link-code`);
  assert.notEqual(nc.body.code, a.code);
  assert.equal((await call('DELETE', `/api/employees/${a.id}/parents`)).body.removed, 1);

  await call('POST', '/api/users', { username: 'ustoz', password: 'parol123', role: 'teacher', classes: '9-B' });
  await call('POST', '/api/logout');
  await call('POST', '/api/login', { username: 'ustoz', password: 'parol123' });
  assert.deepEqual((await call('GET', '/api/parents/slips')).body.students.map((x) => x.name), ['B']);
  assert.equal((await call('POST', `/api/employees/${a.id}/link-code`)).status, 403);
});
