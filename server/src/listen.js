'use strict';
const fs = require('node:fs');
const path = require('node:path');

/*
 * Port rules (terminals send events to this port, so it must not change by itself):
 *   - PORT in .env, or the "home" port saved on the first start (data/port.json), is always used.
 *   - First start: 3000, or the next free port if another program uses it; that becomes the home port.
 *   - Home port busy because this system is already running (another window): do not start a second
 *     copy, just tell the caller.
 *   - Home port busy because of another program: run on the next free port for now, NOT remembered,
 *     with a loud warning (terminals cannot reach us until that program is closed).
 */

const PORT_FILE = 'port.json';

function savedHomePort(cfg) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, PORT_FILE), 'utf8'));
    // Files from older versions ({port} only) could hold a temporary port: they are not trusted.
    if (saved.v === 2 && Number(saved.port)) return Number(saved.port);
  } catch { /* first start */ }
  return null;
}

function rememberPort(cfg, port) {
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.dataDir, PORT_FILE), JSON.stringify({ v: 2, port }));
  } catch { /* not critical */ }
}

function listenOnce(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

/** Is the program answering on this port our own attendance server? */
async function isOurServer(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && (j.service === 'davomat' || j.service === 'hikvision-bridge');
  } catch {
    return false;
  }
}

async function firstFree(app, from, tries) {
  for (let p = from; p < from + tries; p += 1) {
    try {
      return { server: await listenOnce(app, p), port: p };
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
      if (await isOurServer(p)) return { alreadyRunning: p };
    }
  }
  throw Object.assign(new Error('Bo\'sh port topilmadi'), { code: 'EADDRINUSE' });
}

/**
 * Resolves one of:
 *   { server, port, mode: 'home' | 'first' | 'temporary', home }
 *   { alreadyRunning: port }
 */
async function startListening(app, cfg, env = process.env) {
  const fixed = Number(env.PORT) || null;
  const home = fixed || savedHomePort(cfg);
  if (!home) {
    const r = await firstFree(app, 3000, 30);
    if (r.alreadyRunning) return r;
    rememberPort(cfg, r.port);
    return { ...r, mode: 'first', home: r.port };
  }
  try {
    const server = await listenOnce(app, home);
    if (!fixed) rememberPort(cfg, home);
    return { server, port: home, mode: 'home', home };
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await isOurServer(home)) return { alreadyRunning: home };
    const r = await firstFree(app, home + 1, 30);
    if (r.alreadyRunning) return r;
    return { ...r, mode: 'temporary', home };
  }
}

module.exports = { startListening, isOurServer, rememberPort, savedHomePort };
