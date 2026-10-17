'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { extractEvent, normalizeEvent } = require('./hikvision');
const { processScan, notifyScan } = require('./attendance');

function cleanIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/** Finds the terminal for a push: by the id in the URL, or by the sender's IP address. */
function findDevice(store, deviceId, remoteIp) {
  if (deviceId && store.devices.has(deviceId)) return store.devices.get(deviceId);
  for (const d of store.devices.values()) if (d.ip && d.ip === remoteIp) return d;
  return null;
}

function eventKey(deviceId, ev) {
  if (ev.serialNo != null && ev.time) return `${deviceId}_${ev.serialNo}_${ev.time.getTime()}`;
  return `${deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPushHandler({ store, tz, telegram, log = console }) {
  // Events are processed one at a time so two quick scans cannot overwrite each other's attendance.
  let queue = Promise.resolve();
  const handler = (req, res) => {
    // Answer right away: the terminal waits for the response before sending the next event.
    res.send('OK');
    const job = queue.then(() => handle(req));
    queue = job.catch(() => {});
    handler.idle = queue;
    return job;
  };
  handler.idle = queue;
  return handler;

  async function handle(req) {
    await store.ready;
    const remoteIp = cleanIp(req.socket.remoteAddress);
    const device = findDevice(store, req.params.deviceId, remoteIp);
    if (!device) {
      log.warn(`⚠️  Noma'lum terminaldan event keldi (${remoteIp}, ${req.originalUrl}) — web app'da terminalni qo'shing`);
      return;
    }
    try {
      const raw = extractEvent(req.body, req.get('content-type'));
      if (!raw) return;
      const ev = normalizeEvent(raw);
      if (ev.isHeartbeat || !ev.isAccess) return;
      if (!ev.employeeNo && ev.major !== 5) return;

      const key = eventKey(device.id, ev);
      if (await store.eventExists(key)) return; // terminal re-sent an event we already have

      const base = {
        deviceId: device.id, deviceName: device.name || '', time: ev.time || new Date(),
        employeeNo: ev.employeeNo || null, personName: ev.name || null, major: ev.major, minor: ev.minor,
      };
      if (!ev.employeeNo) {
        await store.saveEvent(key, { ...base, action: 'not_recognized' });
        return;
      }
      const result = await processScan(store, store.settings, tz, device, ev);
      await store.saveEvent(key, { ...base, action: result.action, employeeId: result.employee ? result.employee.id : null });
      if (result.action === 'checkin' || result.action === 'checkout') {
        log.log(`✅ ${result.employee.name}: ${result.action === 'checkin' ? 'keldi' : 'ketdi'} (${device.name})`);
      } else {
        log.log(`ℹ️  ${ev.employeeNo} ${ev.name || ''}: ${result.action} (${device.name})`);
      }
      notifyScan(telegram, tz, result);
    } catch (err) {
      log.error('❌ Event ishlovida xato:', err);
    }
  }
}

function createServer({ store, cfg, telegram, api, log = console }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => res.json({ status: 'OK', service: 'hikvision-bridge', time: new Date().toISOString() }));

  const push = createPushHandler({ store, tz: cfg.timezone, telegram, log });
  app.locals.push = push;
  const raw = express.raw({ type: () => true, limit: '20mb' });
  app.post('/hik/:deviceId', raw, push);
  app.post('/hik/:deviceId/*', raw, push);
  // Terminal configured with an empty/other URL: identify it by IP.
  app.post('/ISAPI/*', raw, push);

  if (api) app.use('/api', api);

  // Web app (Next.js static export).
  if (fs.existsSync(cfg.webDir)) {
    app.use(express.static(cfg.webDir, { extensions: ['html'] }));
    app.use((req, res) => {
      const notFound = path.join(cfg.webDir, '404.html');
      if (fs.existsSync(notFound)) res.status(404).sendFile(notFound);
      else res.status(404).send('Not found');
    });
  } else {
    app.get('/', (req, res) => res.send(`Web app hali yig'ilmagan (${cfg.webDir} yo'q). web papkasida "npm run build" qiling.`));
  }
  return app;
}

module.exports = { createServer, createPushHandler, findDevice };
