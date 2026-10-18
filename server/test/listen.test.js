'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const express = require('express');
const { startListening } = require('../src/listen');

const appOk = () => { const a = express(); a.get('/health', (q, r) => r.json({ service: 'davomat' })); return a; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'port-'));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });

test('home port is kept; a second copy does not start; a foreign program causes a temporary port', async () => {
  const dataDir = tmp();
  const base = await freePort();
  fs.writeFileSync(path.join(dataDir, 'port.json'), JSON.stringify({ v: 2, port: base }));
  const cfg = { dataDir };

  const a = await startListening(appOk(), cfg, {});
  assert.equal(a.port, base);
  assert.equal(a.mode, 'home');

  // second copy of the system
  const b = await startListening(appOk(), cfg, {});
  assert.equal(b.alreadyRunning, base);
  await new Promise((r) => a.server.close(r));

  // a foreign program on the home port
  const foreign = net.createServer().listen(base);
  await new Promise((r) => foreign.once('listening', r));
  const c = await startListening(appOk(), cfg, {});
  assert.equal(c.mode, 'temporary');
  assert.notEqual(c.port, base);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'port.json'))).port, base, 'home not overwritten');
  await new Promise((r) => c.server.close(r));
  foreign.close();
});

test('old-format port file (possibly a temporary port) is not trusted', async () => {
  const dataDir = tmp();
  fs.writeFileSync(path.join(dataDir, 'port.json'), JSON.stringify({ port: 3999 }));
  const { savedHomePort } = require('../src/listen');
  assert.equal(savedHomePort({ dataDir }), null);
});
