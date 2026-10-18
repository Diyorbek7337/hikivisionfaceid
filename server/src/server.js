'use strict';
const { publicGate } = require('./tgapp');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { extractEvent, normalizeEvent } = require('./hikvision');
const { createEventProcessor } = require('./events');

function cleanIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

const isIPv4 = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(String(s || ''));

/**
 * Finds the terminal for a push. A push is accepted only from the terminal's own IP address,
 * so knowing the URL is not enough to forge attendance from another computer on the network.
 * Returns { device } or { reason }.
 */
function findDevice(store, deviceId, remoteIp) {
  const byId = deviceId ? store.devices.get(deviceId) : null;
  if (byId) {
    if (!isIPv4(byId.ip) || byId.ip === remoteIp) return { device: byId };
    return { reason: `URL "${byId.name}" terminaliniki, lekin so'rov boshqa manzildan (${remoteIp}) keldi` };
  }
  for (const d of store.devices.values()) if (d.ip && d.ip === remoteIp) return { device: d };
  return { reason: `noma'lum manzil ${remoteIp}` };
}

/** Rejects pushes from unknown senders before their body is read (no memory spent on them). */
function createPushGuard({ store, log = console }) {
  const lastWarn = new Map();
  return (req, res, next) => {
    const remoteIp = cleanIp(req.socket.remoteAddress);
    const found = findDevice(store, req.params.deviceId, remoteIp);
    if (found.device) {
      req.device = found.device;
      return next();
    }
    const now = Date.now();
    if (now - (lastWarn.get(remoteIp) || 0) > 60 * 1000) {
      lastWarn.set(remoteIp, now);
      if (lastWarn.size > 1000) lastWarn.clear();
      log.warn(`⚠️  Event rad etildi: ${found.reason}. Terminal bo'lsa — Terminallar sahifasida uning IP manzilini tekshiring.`);
    }
    res.on('finish', () => req.destroy());
    return res.status(403).set('Connection', 'close').end();
  };
}

function createPushHandler({ store, processor, log = console, samplePath = null }) {
  const seen = new Set(); // devices that have pushed something since start
  const handler = (req, res) => {
    const p = run(req, res).catch((err) => log.error('❌ Event qabul qilishda xato:', err && err.message));
    handler.idle = Promise.all([handler.idle, p]).then(() => {});
    return p;
  };
  handler.idle = Promise.resolve();

  async function run(req, res) {
    // Answer right away: the terminal waits for the response before sending the next event.
    res.send('OK');
    await store.ready;
    const remoteIp = cleanIp(req.socket.remoteAddress);
    const { device } = req;
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
    if (!ev || ev.isHeartbeat) return;
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

function createServer({ store, cfg, telegram, api, tgApi, processor, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  // Through the public tunnel only the Telegram mini app is reachable.
  app.use(publicGate(cfg));

  app.get('/health', (req, res) => res.json({ status: 'OK', service: 'davomat', time: new Date().toISOString() }));

  const proc = processor || createEventProcessor({ store, tz: cfg.timezone, telegram, log });
  const push = createPushHandler({
    store, processor: proc, log,
    samplePath: cfg.dataDir ? path.join(cfg.dataDir, 'oxirgi-noma-lum-event.txt') : null,
  });
  app.locals.push = push;
  app.locals.processor = proc;
  // Hikvision snapshots are ~100–300 KB; 2 MB is plenty.
  const raw = express.raw({ type: () => true, limit: '2mb' });
  const guard = createPushGuard({ store, log });
  app.post('/hik/:deviceId', guard, raw, push);
  app.post('/hik/:deviceId/*', guard, raw, push);
  // Terminal configured with an empty/other URL: identify it by IP.
  app.post('/ISAPI/*', guard, raw, push);

  if (tgApi) app.use('/api/tg', tgApi);
  if (api) app.use('/api', api);
  // A terminal configured with some other URL path: accept the push anyway and identify it by IP.
  app.post(/^\/(?!api\/).*/, guard, raw, push);

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

module.exports = { createServer, createPushHandler, findDevice, isIPv4 };
