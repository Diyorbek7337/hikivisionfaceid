'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { IsapiClient } = require('../src/isapi');
const { startFakeTerminal } = require('./helpers');

test('digest auth, users, faces, device info, time', async (t) => {
  const term = await startFakeTerminal();
  t.after(() => term.close());
  const c = new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'secret' });

  const info = await c.deviceInfo();
  assert.equal(info.model, 'DS-K1T331W');

  assert.equal(await c.upsertUser({ employeeNo: '1', name: 'Aziz' }), 'added');
  assert.equal(await c.upsertUser({ employeeNo: '1', name: 'Aziz Karimov' }), 'updated');
  assert.equal(term.state.users.get('1').name, 'Aziz Karimov');

  await c.setFace('1', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.ok(term.state.faces.has('1'));

  await c.deleteUser('1');
  assert.equal(term.state.users.size, 0);
  await c.deleteUser('1'); // missing -> no error

  const tm = await c.getTime();
  assert.equal(tm.date.toISOString(), '2019-12-31T19:00:00.000Z');
  await c.setTime('2026-10-18T09:00:00', 'CST-5:00:00');
  assert.match(term.state.setTimeBody, /<localTime>2026-10-18T09:00:00<\/localTime><timeZone>CST-5:00:00<\/timeZone>/);
});

test('wrong password and unreachable terminal give clear errors', async (t) => {
  const term = await startFakeTerminal();
  t.after(() => term.close());
  const bad = new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'nope' });
  await assert.rejects(bad.deviceInfo(), /parol/);
  const off = new IsapiClient({ host: '127.0.0.1', port: 1, timeoutMs: 2000 });
  await assert.rejects(off.deviceInfo(), (e) => e.connection === true);
});

test('single-use nonces and parallel requests still work', async (t) => {
  const term = await startFakeTerminal({ singleUseNonce: true });
  t.after(() => term.close());
  const c = new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'secret' });
  // monitor + sync at the same time
  const results = await Promise.all([
    c.deviceInfo(), c.upsertUser({ employeeNo: '1', name: 'A' }), c.getTime(), c.upsertUser({ employeeNo: '2', name: 'B' }),
  ]);
  assert.equal(results[0].model, 'DS-K1T331W');
  assert.equal(term.state.users.size, 2);
  await c.setFace('1', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.ok(term.state.faces.has('1'));
});

test('lock-out is reported clearly', async (t) => {
  const term = await startFakeTerminal({ lockAfter: 2 });
  t.after(() => term.close());
  // a fresh client each time (as if the program restarted) eventually hits the terminal's lock
  const fresh = () => new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'nope' });
  await assert.rejects(fresh().deviceInfo(), /parol/);
  await assert.rejects(fresh().deviceInfo(), /parol/);
  await assert.rejects(fresh().deviceInfo(), /blokladi \(~30 daqiqa\)/);
});

test('after a rejected login the client stops trying (no lock-out by repeated attempts)', async (t) => {
  const term = await startFakeTerminal({ lockAfter: 3 });
  t.after(() => term.close());
  const bad = new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'nope' });
  for (let i = 0; i < 10; i += 1) await assert.rejects(bad.deviceInfo(), /parol/);
  // only one real login attempt reached the terminal, so it is not locked:
  const good = new IsapiClient({ host: '127.0.0.1', port: term.port, username: 'admin', password: 'secret' });
  assert.equal((await good.deviceInfo()).model, 'DS-K1T331W');
});

test('never sends Basic credentials unless the terminal asks for Basic', async (t) => {
  const http = require('node:http');
  const seen = [];
  const srv = http.createServer((req, res) => { seen.push(req.headers.authorization || ''); res.statusCode = 401; res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  t.after(() => srv.close());
  const c = new IsapiClient({ host: '127.0.0.1', port: srv.address().port, username: 'admin', password: 'TermPass1!' });
  await assert.rejects(c.deviceInfo());
  assert.ok(seen.every((h) => !/^Basic/i.test(h)), `leaked: ${seen.join(',')}`);
});
