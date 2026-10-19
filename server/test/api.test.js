'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { createAuth } = require('../src/auth');
const { createApi } = require('../src/api');
const { createServer } = require('../src/server');
const { createBackup } = require('../src/backup');
const { buildDailyReport } = require('../src/report');

const quiet = { log() {}, warn() {}, error() {} };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 7), Buffer.from([0xff, 0xd9])]).toString('base64');

async function setup() {
  const db = openDatabase(':memory:');
  const store = new LocalStore(db);
  const auth = createAuth({ store, secret: 'test-secret' });
  const cfg = { timezone: 'Asia/Tashkent', port: 3000, webDir: '/nonexistent' };
  const sync = { schedule() {} };
  const api = createApi({ store, auth, cfg, sync, backup: createBackup({ db, dir: '/tmp', tz: cfg.timezone, log: quiet }), version: 'test' });
  const app = createServer({ store, cfg, api, telegram: null, log: quiet });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  const push = async (deviceId, emp, time, serial) => {
    await fetch(`${base}/hik/${deviceId}/event`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dateTime: time, eventType: 'AccessControllerEvent', AccessControllerEvent: { majorEventType: 5, subEventType: 75, employeeNoString: emp, serialNo: serial } }),
    });
    await app.locals.push.idle;
  };
  return { store, server, call, push };
}

test('first-run setup, login, auth required', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  let r = await call('GET', '/api/session');
  assert.equal(r.body.needsSetup, true);
  assert.equal((await call('GET', '/api/employees')).status, 401);
  r = await call('POST', '/api/setup', { username: 'direktor', password: '123', organizationName: '5-maktab' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/setup', { username: 'direktor', password: 'parol123', organizationName: '5-maktab' });
  assert.equal(r.status, 200);
  assert.equal((await call('POST', '/api/setup', { username: 'x', password: 'parol123' })).status, 409);
  assert.equal((await call('GET', '/api/employees')).status, 200);
  await call('POST', '/api/logout');
  assert.equal((await call('GET', '/api/employees')).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'direktor', password: 'xato' })).status, 401);
  assert.equal((await call('POST', '/api/login', { username: 'DIREKTOR', password: 'parol123' })).status, 200);
  assert.equal((await call('GET', '/api/status')).body.settings.organizationName, '5-maktab');
});

test('import, schedules, faces, scans, report with absences', async (t) => {
  const { store, server, call, push } = await setup();
  t.after(() => server.close());
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });

  // Schedule: second shift, Mon-Sat 13:00-18:00
  const sched = await call('POST', '/api/schedules', {
    name: '2-smena', days: { 1: { start: '13:00', end: '18:00' }, 2: { start: '13:00', end: '18:00' }, 3: { start: '13:00', end: '18:00' }, 4: { start: '13:00', end: '18:00' }, 5: { start: '13:00', end: '18:00' }, 6: { start: '13:00', end: '18:00' } },
  });
  const r = await call('POST', '/api/employees/import', {
    rows: [{ name: 'Aliyeva Malika', position: 'O\'qituvchi' }, { name: 'Karimov Aziz' }, { name: '  ' }, { name: 'karimov  aziz' }],
  });
  assert.deepEqual(r.body, { added: 2, skipped: 2 });
  const emps = (await call('GET', '/api/employees')).body;
  assert.deepEqual(emps.map((e) => e.employeeNo), ['1', '2']);
  const aziz = emps.find((e) => e.name === 'Karimov Aziz');
  const upd = await call('PUT', `/api/employees/${aziz.id}`, { ...aziz, scheduleId: sched.body.id, payRate: 30000 });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));

  // Face upload
  assert.equal((await call('PUT', `/api/employees/${aziz.id}/face`, { image: 'bm90LWpwZWc=' })).status, 400);
  const f = await call('PUT', `/api/employees/${aziz.id}/face`, { image: JPEG });
  assert.equal(f.body.hasFace, true);
  assert.equal((await call('GET', `/api/employees/${aziz.id}/face.jpg`)).status, 200);

  // Pretend both were created long ago so absences count
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);

  const dev = await call('POST', '/api/devices', { name: 'Kirish', ip: '127.0.0.1', password: 'x', direction: 'in' });
  const devOut = await call('POST', '/api/devices', { name: 'Chiqish', ip: '127.0.0.1', port: 81, password: 'x', direction: 'out' });
  assert.equal((await call('GET', '/api/devices')).body[0].password, undefined);
  // terminals "added" before the test dates (events from before that are ignored as old terminal memory)
  store.db.prepare("UPDATE devices SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadDevices(false);

  // Monday 2026-01-12: Aziz (2nd shift) arrives 13:20 -> 20 min late, leaves 18:00
  await push(dev.body.id, aziz.employeeNo, '2026-01-12T13:20:00+05:00', 1);
  await push(devOut.body.id, aziz.employeeNo, '2026-01-12T18:00:00+05:00', 1);
  // Sunday 2026-01-11 is a day off for everybody -> not absent
  const rep = await call('GET', '/api/report?from=2026-01-11&to=2026-01-13');
  const sA = rep.body.summary.find((s) => s.name === 'Karimov Aziz');
  assert.equal(sA.lateCount, 1);
  assert.equal(sA.lateMinutes, 20);
  assert.equal(sA.workDays, 2); // Mon + Tue
  assert.equal(sA.absentDays, 1); // Tue
  assert.equal(Math.round(sA.pay), Math.round((280 / 60) * 30000));
  const sM = rep.body.summary.find((s) => s.name === 'Aliyeva Malika');
  assert.equal(sM.absentDays, 2);

  // Day view
  const day = await call('GET', '/api/today?date=2026-01-12');
  assert.equal(day.body.rows.find((x) => x.employee.name === 'Karimov Aziz').status, 'late');
  assert.equal(day.body.rows.find((x) => x.employee.name === 'Aliyeva Malika').status, 'absent');
  assert.equal((await call('GET', '/api/today?date=2026-01-11')).body.rows[0].status, 'off');

  // Manual fix: Malika forgot to scan on Tuesday
  const malika = emps.find((e) => e.name === 'Aliyeva Malika');
  const m = await call('PUT', '/api/attendance', { employeeId: malika.id, date: '2026-01-13', checkIn: '08:10', checkOut: '17:00' });
  assert.equal(m.body.lateMinutes, 10);
  assert.equal(m.body.workedMinutes, 530);
  assert.equal(m.body.manual, true);

  // "Qo'lda qo'shish" with only a check-out keeps the terminal's check-in
  const keep = await call('PUT', '/api/attendance', { employeeId: aziz.id, date: '2026-01-12', checkOut: '18:30' });
  assert.equal(keep.body.lateMinutes, 20, 'terminal check-in kept');
  assert.equal(new Date(keep.body.checkIn).toISOString(), '2026-01-12T08:20:00.000Z');
  // editing with replace: true and an empty check-in removes it
  const rep2 = await call('PUT', '/api/attendance', { employeeId: aziz.id, date: '2026-01-12', checkIn: '', checkOut: '18:30', replace: true });
  assert.equal(rep2.body.checkIn, null);
  await call('PUT', '/api/attendance', { employeeId: aziz.id, date: '2026-01-12', checkIn: '13:20', checkOut: '18:00', replace: true });
  // same terminal address twice is refused
  assert.equal((await call('POST', '/api/devices', { name: 'Nusxa', ip: '127.0.0.1', password: 'x' })).status, 400);
  // duplicate names: apostrophe forms do not matter
  await call('POST', '/api/employees', { name: 'G‘ulomova Oʻgʻiloy' });
  assert.equal((await call('POST', '/api/employees', { name: "g'ulomova  O'g'iloy" })).status, 409);
  assert.equal((await call('POST', '/api/employees', { name: "g'ulomova  O'g'iloy", allowDuplicate: true })).status, 200);
  // empty settings value keeps the old one; debounce has a floor
  await call('PUT', '/api/settings', { debounceSeconds: '' });
  assert.equal((await call('GET', '/api/status')).body.settings.debounceSeconds, 60);
  assert.equal((await call('PUT', '/api/settings', { debounceSeconds: 0 })).body.debounceSeconds, 10);

  // Times like 8:05 are normalized; night shifts and future dates are refused
  const m2 = await call('PUT', '/api/attendance', { employeeId: malika.id, date: '2026-01-14', checkIn: '8:05' });
  assert.equal(m2.status, 200);
  assert.equal((await call('PUT', '/api/attendance', { employeeId: malika.id, date: '2099-01-01', checkIn: '08:00' })).status, 400);
  const night = await call('POST', '/api/schedules', { name: 'Tungi', days: { 1: { start: '20:00', end: '08:00' } } });
  assert.equal(night.status, 400);
  const s8 = await call('POST', '/api/schedules', { name: 'Erta', days: { 1: { start: '8:00', end: '9:30' } } });
  assert.equal((await call('GET', '/api/schedules')).body.find((x) => x.id === s8.body.id).days['1'].start, '08:00');

  // Telegram daily report text
  const text = buildDailyReport(store, '2026-01-12', 'Asia/Tashkent');
  assert.match(text, /Kelgan: 1 \/ 2/);
  assert.match(text, /Karimov Aziz — 13:20/);
  assert.match(text, /Aliyeva Malika/);

  // Delete employee -> hidden, schedule then deletable
  await call('DELETE', `/api/employees/${aziz.id}`);
  assert.equal((await call('GET', '/api/employees')).body.length, 3);
  assert.equal((await call('DELETE', `/api/schedules/${sched.body.id}`)).status, 200);
  const evs = (await call('GET', '/api/events')).body;
  assert.equal(evs.length, 2);
});

test('backup download works', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  const r = await call('GET', '/api/backup');
  assert.equal(r.status, 200);
  assert.ok(String(r.body).startsWith('SQLite format 3'));
});

test('security: sessions are revoked on logout/password change; bad cookies; device password re-entry', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async () => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"username":"admin","password":"parol123"}' });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const get = (cookie, path = '/api/users') => fetch(base + path, { headers: { cookie } }).then((r) => r.status);
  const c1 = await login();
  const c2 = await login();
  assert.equal(await get(c1), 200);
  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie: c1 } });
  assert.equal(await get(c1), 401, 'old cookie revoked after logout');
  assert.equal(await get(c2), 401, 'logout ends all sessions of the user');

  assert.equal(await get('davomat_session=%E0%A4%A'), 401, 'malformed cookie -> 401, not 500');

  await call('POST', '/api/login', { username: 'admin', password: 'parol123' });
  // device: changing the IP without re-entering the password is refused (password never sent to a new address)
  const d = await call('POST', '/api/devices', { name: 'K', ip: '192.168.1.10', password: 'p', direction: 'in' });
  let r = await call('PUT', `/api/devices/${d.body.id}`, { name: 'K', ip: '192.168.1.11', direction: 'in' });
  assert.equal(r.status, 400);
  r = await call('PUT', `/api/devices/${d.body.id}`, { name: 'K2', ip: '192.168.1.10', direction: 'out' });
  assert.equal(r.status, 200, 'same address keeps the saved password');
  for (const ip of ['evil.example.com', 'localhost', '1.2.3', '300.1.1.1']) {
    assert.equal((await call('POST', '/api/devices', { name: 'x', ip, password: 'p' })).status, 400, ip);
  }
  assert.equal((await call('POST', '/api/employees', { name: 'X', payRate: '1e400' })).body.payRate, 0);
  // personal schedule: times are checked like a shared schedule
  const badDays = await call('POST', '/api/employees', { name: 'Y', personalSchedule: { days: { 1: { start: '12:00', end: '09:00' } } } });
  assert.equal(badDays.status, 400);
  const own = await call('POST', '/api/employees', { name: 'Z', personalSchedule: { days: { 2: { start: '9:00', end: '11:30' } } } });
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.personalSchedule.days['2'], { start: '09:00', end: '11:30' });
  assert.equal(own.body.personalSchedule.days['1'], null);
  // flexible: days are optional and never rejected
  const flex = await call('POST', '/api/employees', { name: 'F', personalSchedule: { type: 'flexible', days: { 1: { start: '12:00', end: '09:00' } } } });
  assert.equal(flex.status, 200);
  assert.equal(flex.body.personalSchedule.type, 'flexible');
  const fs = await call('POST', '/api/schedules', { name: 'Erkin', type: 'flexible' });
  assert.equal((await call('GET', '/api/schedules')).body.find((x) => x.id === fs.body.id).type, 'flexible');
  const scheds = (await call('GET', '/api/schedules')).body;
  assert.equal(scheds[0].employees, 1, 'only X uses the default schedule');
});

test('first-run setup is refused when not addressed as localhost (DNS rebinding)', async (t) => {
  const { server } = await setup();
  t.after(() => server.close());
  const http = require('node:http');
  const status = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/setup', method: 'POST',
      headers: { 'content-type': 'application/json', host: 'evil.example.com' } }, (res) => resolve(res.statusCode));
    req.end('{"username":"admin","password":"parol123"}');
  });
  assert.equal(status, 403);
});

test('manual editing of a day with several sessions', async (t) => {
  const { store, server, call } = await setup();
  t.after(() => server.close());
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  const emp = (await call('POST', '/api/employees', { name: 'Usmonov Bekzod', hourlyRate: 60000 /* older clients */ })).body;
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);
  const put = (body) => call('PUT', '/api/attendance', { employeeId: emp.id, date: '2026-01-12', ...body });

  // two lessons the same day
  const r = await put({ sessions: [{ in: '14:00', out: '16:00' }, { in: '8:00', out: '10:00' }], replace: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.workedMinutes, 240);
  assert.equal(r.body.sessions.length, 2);
  assert.equal(r.body.lateMinutes, 0);
  // "Qo'lda qo'shish" adds a forgotten third visit
  const add = await put({ sessions: [{ in: '17:00', out: '' }] });
  assert.equal(add.body.sessions.length, 3);
  assert.equal(add.body.openSessions, 1);
  assert.equal(add.body.checkOut, null);
  assert.equal((await put({ sessions: [{ in: '17:00' }] })).status, 400, 'already there');
  // overlapping or reversed times are refused
  assert.equal((await put({ sessions: [{ in: '08:00', out: '11:00' }, { in: '10:00', out: '12:00' }], replace: true })).status, 400);
  assert.equal((await put({ sessions: [{ in: '12:00', out: '11:00' }], replace: true })).status, 400);
  assert.equal((await put({ sessions: [{ in: '08:00' }, { out: '12:00' }], replace: true })).status, 400);
  assert.equal((await put({ sessions: [{ in: '', out: '' }], replace: true })).status, 400);
  // pay counts complete sessions only
  const rep = await call('GET', '/api/report?from=2026-01-12&to=2026-01-12');
  assert.equal(rep.body.summary[0].pay, 240000);
  assert.equal(rep.body.records[0].pay, 240000, 'pay per day is sent with the record');
  assert.equal(rep.body.records[0].punches, undefined, 'raw scans stay on the server');
  // per-visit pay
  const up = await call('PUT', `/api/employees/${emp.id}`, { ...emp, payType: 'session', payRate: 70000 });
  assert.equal(up.body.payType, 'session');
  assert.equal((await call('PUT', `/api/employees/${emp.id}`, { ...emp, payType: 'weird', payRate: 5 })).body.payType, 'hourly');
  assert.equal(rep.body.records[0].sessions.length, 3);
});

test('students: classes, import per class, same name in two classes, separate daily report line', async (t) => {
  const { store, server, call } = await setup();
  t.after(() => server.close());
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  const imp = await call('POST', '/api/employees/import', {
    kind: 'student',
    rows: [
      { name: 'Aliyev Jasur', className: '9 a' }, { name: 'Karimova Laylo', className: '9-А' },
      { name: 'Aliyev Jasur', className: '10b' }, { name: 'Aliyev  Jasur', className: '9A' }, { name: 'Sinfsiz bola' },
    ],
  });
  assert.deepEqual(imp.body, { added: 3, skipped: 2 }, 'duplicate in 9-A and the one without a class are skipped');
  const all = (await call('GET', '/api/employees')).body;
  assert.deepEqual(all.map((e) => `${e.name}|${e.className}|${e.kind}`).sort(),
    ['Aliyev Jasur|10-B|student', 'Aliyev Jasur|9-A|student', 'Karimova Laylo|9-A|student']);
  // whole file into one class
  const one = await call('POST', '/api/employees/import', { kind: 'student', className: '11 v', rows: [{ name: 'Toshev Ali' }] });
  assert.equal(one.body.added, 1);
  assert.equal((await call('GET', '/api/employees')).body.find((e) => e.name === 'Toshev Ali').className, '11-V');
  // a student has no pay and no personal Telegram
  const s = await call('POST', '/api/employees', { name: 'Yangi', kind: 'student', className: '5-a', payRate: 50000, telegramChatId: '123' });
  assert.equal(s.body.payRate, 0);
  assert.equal(s.body.telegramChatId, '');
  assert.equal((await call('POST', '/api/employees', { name: 'X', kind: 'student' })).status, 400, 'class required');
  // staff import still works and is separate
  await call('POST', '/api/employees/import', { rows: [{ name: 'Aliyev Jasur' }] });
  assert.equal((await call('GET', '/api/employees')).body.filter((e) => e.name === 'Aliyev Jasur').length, 3);

  const { buildDailyReport } = require('../src/report');
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);
  const text = buildDailyReport(store, '2026-01-12', 'Asia/Tashkent');
  assert.match(text, /O'quvchilar:<\/b> keldi 0 \/ 5, kechikdi 0, kelmadi 5/);
  assert.match(text, /Xodimlar/);
  assert.doesNotMatch(text, /Karimova Laylo/, 'students are not listed by name');
});
