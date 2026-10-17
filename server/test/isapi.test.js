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
