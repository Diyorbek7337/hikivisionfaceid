'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { processScan } = require('../src/attendance');
const { EdumeClient } = require('../src/edume');
const { CrmIntegration } = require('../src/crm');
const { startFakeEdume } = require('./fake-edume');

const tz = 'Asia/Tashkent';
const at = (d, hm) => new Date(`${d}T${hm}:00+05:00`);
const MON = '2026-10-19'; // Monday
const quiet = { log() {}, warn() {}, error() {} };

async function setup() {
  const edume = await startFakeEdume();
  const d = edume.state.docs;
  d.set('users/dev1', { role: 'device', centerId: 'c1', fullName: 'Face ID' });
  d.set('centers/c1', { name: 'ProTeach' });
  d.set('centers/c1/settings/main', { telegramBotToken: 'CRM-BOT' });
  d.set('centers/c1/groups/g1', { name: 'Ingliz B1', status: 'active', schedule: { scheduleDays: [1, 3, 5], startTime: '14:00', endTime: '15:30' } });
  d.set('centers/c1/students/s1', { fullName: 'Aliyev  Jasur', groupId: 'g1', status: 'active', parentTelegramChatId: 555 });
  d.set('centers/c1/students/s2', { fullName: 'Karimova Laylo', groupId: 'g1', status: 'active' });
  d.set('centers/c1/students/s3', { fullName: 'Arxiv Bola', groupId: 'g1', status: 'archived' });
  d.set('centers/c1/students/s4', { fullName: 'Guruhsiz Bola', status: 'active' });
  const store = new LocalStore(openDatabase(':memory:'));
  const sent = [];
  let clock = at(MON, '13:00');
  const crm = new CrmIntegration({
    store, tz, log: quiet,
    clientFactory: (cfg) => new EdumeClient(cfg, { bases: edume.bases }),
    telegramFactory: (token) => ({ send: async (chat, text) => { sent.push([token, chat, text]); } }),
    now: () => clock,
  });
  const setClock = (t) => { clock = t; };
  const scan = async (name, time, direction = 'in') => {
    const emp = [...store.employees.values()].find((e) => e.name === name);
    const r = await processScan(store, store.settings, tz, { id: direction, name: direction, direction }, { employeeNo: emp.employeeNo, time });
    await crm.onScan(r);
    return r;
  };
  const marks = () => [...d.entries()].filter(([k]) => k.startsWith('centers/c1/attendance/')).map(([, v]) => v);
  return { edume, d, store, crm, sent, setClock, scan, marks };
}

const oldEnough = (store) => {
  store.db.prepare("UPDATE employees SET created_at = '2026-01-01T00:00:00Z'").run();
  store.reloadEmployees(false);
};

test('connect: device account only; students come from Edume with their group and lesson days', async (t) => {
  const { edume, d, store, crm } = await setup();
  t.after(() => edume.close());
  await assert.rejects(crm.connect('not-a-code'), /Ulanish kodi/);
  d.set('users/dev1', { role: 'teacher', centerId: 'c1' });
  await assert.rejects(crm.connect(edume.code), /qurilma akkaunti emas/);
  d.set('users/dev1', { role: 'device', centerId: 'c1' });
  const st = await crm.connect(edume.code);
  assert.equal(st.connected, true);
  assert.equal(st.centerName, 'ProTeach');
  assert.equal(st.students, 3, 'archived student is not added');
  const jasur = store.findByExternalId('s1');
  assert.equal(jasur.name, 'Aliyev Jasur');
  assert.equal(jasur.kind, 'student');
  assert.equal(jasur.className, 'Ingliz B1');
  assert.deepEqual(jasur.personalSchedule.days['1'], { start: '14:00', end: '15:30' });
  assert.equal(jasur.personalSchedule.days['2'], null);
  assert.equal(store.findByExternalId('s4').personalSchedule.type, 'flexible');
  assert.equal(store.findByExternalId('s4').className, 'Guruhsiz');
  // the password never leaves the server through settings; the status has no password either
  assert.equal(JSON.stringify(st).includes('pw-123456'), false);

  // changes in Edume: renamed, moved, archived
  d.get('centers/c1/students/s2').fullName = 'Karimova Laylo Anvarovna';
  d.get('centers/c1/students/s1').status = 'archived';
  const ch = await crm.sync();
  assert.deepEqual(ch, { added: 0, updated: 1, removed: 1 });
  assert.equal(store.findByExternalId('s1').active, false, 'archived in Edume -> off the terminals');
  assert.equal(store.findByExternalId('s2').name, 'Karimova Laylo Anvarovna');
  assert.equal((await crm.sync()).updated, 0, 'nothing changed -> nothing updated');
});

test('scan during a lesson -> present / late in Edume; outside lessons nothing; existing marks respected', async (t) => {
  const { edume, d, store, crm, scan, marks, setClock, sent } = await setup();
  t.after(() => edume.close());
  await crm.connect(edume.code);
  oldEnough(store);

  setClock(at(MON, '13:50'));
  await scan('Aliyev Jasur', at(MON, '13:50'));
  assert.deepEqual(marks().map((m) => [m.studentId, m.status, m.date, m.groupId, m.checkInTime]), [['s1', 'present', MON, 'g1', '13:50']]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].slice(0, 2), ['CRM-BOT', '555']);
  assert.match(sent[0][2], /Aliyev Jasur<\/b> \(Ingliz B1\) maktabga keldi — 13:50/);

  // a teacher already marked Laylo absent; she comes 20 min late -> late (the scan proves she came)
  d.set('centers/c1/attendance/x1', { groupId: 'g1', date: MON, studentId: 's2', status: 'absent' });
  setClock(at(MON, '14:20'));
  await scan('Karimova Laylo', at(MON, '14:20'));
  assert.equal(d.get('centers/c1/attendance/x1').status, 'late');
  assert.equal(marks().length, 2, 'updated, not duplicated');

  // leaving and coming back does not change "present"
  setClock(at(MON, '15:00'));
  await scan('Aliyev Jasur', at(MON, '15:00'), 'out');
  await scan('Aliyev Jasur', at(MON, '15:10'));
  assert.equal(marks().find((m) => m.studentId === 's1').status, 'present');
  assert.match(sent.at(-2)[2], /maktabdan chiqdi/);

  // Tuesday: no lesson for this group -> nothing written
  setClock(at('2026-10-20', '14:00'));
  await scan('Aliyev Jasur', at('2026-10-20', '14:00'));
  assert.equal(marks().length, 2);
  // a scan long after the lesson -> nothing
  await scan('Karimova Laylo', at('2026-10-21', '18:00'));
  assert.equal(marks().length, 2);
});

test('absent after the lesson: only students with a face, only if the terminals worked, once', async (t) => {
  const { edume, store, crm, scan, marks, setClock } = await setup();
  t.after(() => edume.close());
  await crm.connect(edume.code);
  oldEnough(store);
  const face = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  for (const id of ['s1', 's2']) store.setFace(store.findByExternalId(id).id, face);

  // nobody scanned today: the terminals may be down -> nobody is marked absent
  setClock(at(MON, '16:00'));
  assert.equal(await crm.checkAbsent(), 0);

  await scan('Aliyev Jasur', at(MON, '13:58'));
  setClock(at(MON, '15:40')); // lesson ended 15:30, +15 min not yet
  assert.equal(await crm.checkAbsent(), 0);
  setClock(at(MON, '15:46'));
  assert.equal(await crm.checkAbsent(), 1);
  const laylo = marks().find((m) => m.studentId === 's2');
  assert.equal(laylo.status, 'absent');
  assert.equal(laylo.source, 'faceid');
  assert.equal(marks().length, 2, 'the student without a face is left to the teacher');
  assert.equal(await crm.checkAbsent(), 0, 'each lesson is checked once');
  // switched off
  crm.setOptions({ autoAbsent: false });
  assert.equal(crm.status().autoAbsent, false);
});

test('Edume problems are reported, not thrown at the terminal', async (t) => {
  const { edume, store, crm, scan, setClock } = await setup();
  t.after(() => edume.close());
  await crm.connect(edume.code);
  oldEnough(store);
  edume.state.deny = true;
  setClock(at(MON, '14:00'));
  await scan('Aliyev Jasur', at(MON, '14:00')); // does not throw
  await assert.rejects(crm.sync(), /ruxsat bermadi/);
  assert.match(crm.status().lastError, /ruxsat bermadi/);
  edume.state.deny = false;
  await crm.sync();
  assert.equal(crm.status().lastError, '');
  crm.disconnect();
  assert.equal(crm.status().connected, false);
  assert.equal(store.settings.crm, null);
});

test('API: connect from the web app; the password never comes back; teachers have no access', async (t) => {
  const { edume, store, crm } = await setup();
  t.after(() => edume.close());
  const { createAuth } = require('../src/auth');
  const { createApi } = require('../src/api');
  const { createServer } = require('../src/server');
  const cfg = { timezone: tz, port: 3000, webDir: '/nonexistent' };
  const api = createApi({ store, auth: createAuth({ store, secret: 's' }), cfg, sync: { schedule() {} }, backup: {}, clientFor: () => null, crm, version: 't' });
  const server = await new Promise((r) => { const s = createServer({ store, cfg, api, telegram: null, log: quiet }).listen(0, '127.0.0.1', () => r(s)); });
  t.after(() => server.close());
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.text() };
  };
  await call('POST', '/api/setup', { username: 'admin', password: 'parol123' });
  assert.equal((await call('PUT', '/api/crm', { code: 'xato' })).status, 400);
  const ok = await call('PUT', '/api/crm', { code: edume.code });
  assert.equal(ok.status, 200, ok.body);
  for (const p of ['/api/crm', '/api/status']) {
    const r = await call('GET', p);
    assert.equal(r.body.includes('pw-123456'), false, p);
    assert.equal(r.body.includes('"apiKey"'), false, p);
  }
  assert.match((await call('GET', '/api/status')).body, /"crm":\{"connected":true,"centerName":"ProTeach"\}/);
  assert.equal((await call('PUT', '/api/settings', { organizationName: 'X' })).body.includes('pw-123456'), false);
  assert.equal((await call('PUT', '/api/crm/options', { absentAfterMinutes: 30 })).status, 200);
  assert.equal(crm.status().absentAfterMinutes, 30);
  await call('POST', '/api/users', { username: 'ustoz', password: 'parol123', role: 'teacher', classes: 'Ingliz B1' });
  await call('POST', '/api/logout');
  await call('POST', '/api/login', { username: 'ustoz', password: 'parol123' });
  assert.equal((await call('GET', '/api/crm')).status, 403);
  assert.equal((await call('DELETE', '/api/crm')).status, 403);
});

test('class names: "9 a" style is normalised, course group names keep their spelling', () => {
  const { normClass } = require('../src/api');
  assert.equal(normClass('9 a'), '9-A');
  assert.equal(normClass('10-в'), '10-V');
  assert.equal(normClass(' Ingliz  B1 '), 'Ingliz B1');
});
