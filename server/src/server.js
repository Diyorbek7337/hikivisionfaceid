'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { extractEvent, normalizeEvent } = require('./hikvision');
const { createEventProcessor } = require('./events');

function cleanIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

/** Finds the terminal for a push: by the id in the URL, or by the sender's IP address. */
function findDevice(store, deviceId, remoteIp) {
  if (deviceId && store.devices.has(deviceId)) return store.devices.get(deviceId);
  for (const d of store.devices.values()) if (d.ip && d.ip === remoteIp) return d;
  return null;
}

function createPushHandler({ store, processor, log = console, samplePath = null }) {
  const seen = new Set(); // devices that have pushed something since start
  const handler = (req, res) => {
    const p = run(req, res);
    handler.idle = Promise.all([handler.idle, p]).then(() => {});
    return p;
  };
  handler.idle = Promise.resolve();

  async function run(req, res) {
    // Answer right away: the terminal waits for the response before sending the next event.
    res.send('OK');
    await store.ready;
    const remoteIp = cleanIp(req.socket.remoteAddress);
    const device = findDevice(store, req.params.deviceId, remoteIp);
    if (!device) {
      log.warn(`⚠️  Noma'lum terminaldan event keldi (${remoteIp}, ${req.originalUrl}) — web app'da terminalni qo'shing`);
      return;
    }
    store.updateDevice(device.id, { lastPushAt: Date.now() }).catch(() => {});
    if (!seen.has(device.id)) {
      seen.add(device.id);
      log.log(`📡 ${device.name}: terminaldan aloqa bor (${remoteIp})`);
    }
    let raw;
    try {
      raw = extractEvent(req.body, req.get('content-type'));
    } catch {
      raw = null;
    }
    if (!raw) {
      log.warn(`⚠️  ${device.name}: tushunilmagan event (${req.get('content-type') || 'turi yo\'q'}, ${req.body ? req.body.length : 0} bayt)`);
      saveSample(req);
      return;
    }
    const ev = normalizeEvent(raw);
    if (ev.isHeartbeat) return;
    if (!ev.isAccess) {
      log.log(`ℹ️  ${device.name}: ${ev.eventType || 'noma\'lum event'} (o'tkazib yuborildi)`);
      saveSample(req);
      return;
    }
    await processor.process(device, ev);
  }
  return handler;

  /** Keeps the last event we could not use, for troubleshooting (data/oxirgi-noma-lum-event.txt). */
  function saveSample(req) {
    if (!samplePath) return;
    try {
      const head = `${new Date().toISOString()} ${req.method} ${req.originalUrl}\nContent-Type: ${req.get('content-type') || ''}\n\n`;
      const body = req.body && req.body.length ? req.body.subarray(0, 20000).toString('latin1').replace(/[^\x09\x0a\x0d\x20-\x7e\u00a0-\u00ff]/g, '.') : '';
      fs.writeFileSync(samplePath, head + body);
    } catch { /* ignore */ }
  }
}

function createServer({ store, cfg, telegram, api, processor, log = console }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/health', (req, res) => res.json({ status: 'OK', service: 'hikvision-bridge', time: new Date().toISOString() }));

  const proc = processor || createEventProcessor({ store, tz: cfg.timezone, telegram, log });
  const push = createPushHandler({
    store, processor: proc, log,
    samplePath: cfg.dataDir ? path.join(cfg.dataDir, 'oxirgi-noma-lum-event.txt') : null,
  });
  app.locals.push = push;
  app.locals.processor = proc;
  const raw = express.raw({ type: () => true, limit: '20mb' });
  app.post('/hik/:deviceId', raw, push);
  app.post('/hik/:deviceId/*', raw, push);
  // Terminal configured with an empty/other URL: identify it by IP.
  app.post('/ISAPI/*', raw, push);

  if (api) app.use('/api', api);
  // A terminal configured with some other URL path: accept the push anyway and identify it by IP.
  app.post(/^\/(?!api\/).*/, raw, push);

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
