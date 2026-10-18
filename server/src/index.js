'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnvFile } = require('./env');

loadEnvFile();

// The Windows console cannot draw emoji: drop them from log lines there.
if (process.platform === 'win32') {
  const strip = (a) => (typeof a === 'string' ? a.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]\uFE0F?\s?/gu, '') : a);
  for (const k of ['log', 'warn', 'error']) {
    const orig = console[k].bind(console);
    console[k] = (...args) => orig(...args.map(strip));
  }
}

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { LocalStore } = require('./store');
const { IsapiClient } = require('./isapi');
const { SyncEngine } = require('./sync');
const { DeviceMonitor } = require('./monitor');
const { createServer } = require('./server');
const { createApi } = require('./api');
const { createAuth } = require('./auth');
const { createBackup } = require('./backup');
const { createTelegram } = require('./telegram');
const { startDailyReport } = require('./report');
const { lanAddresses } = require('./net');
const { preferredPort, rememberPort, listenWithFallback } = require('./listen');
const pkg = require('../package.json');

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const store = new LocalStore(db);

// Session secret: generated once and kept next to the database.
const secretFile = path.join(cfg.dataDir, '.session_secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const auth = createAuth({ store, secret: fs.readFileSync(secretFile, 'utf8').trim() });

const clients = new Map();
function clientFor(dev) {
  const key = [dev.id, dev.ip, dev.port, dev.username, dev.password].join('|');
  if (!clients.has(key)) {
    for (const k of clients.keys()) if (k.startsWith(`${dev.id}|`)) clients.delete(k);
    clients.set(key, new IsapiClient({ host: dev.ip, port: dev.port || 80, username: dev.username, password: dev.password }));
  }
  return clients.get(key);
}

const sync = new SyncEngine({ store, clientFor });
const monitor = new DeviceMonitor({ store, clientFor, tz: cfg.timezone, onOnline: () => sync.schedule() });
const telegram = createTelegram({ token: cfg.botToken, adminIds: cfg.adminTelegramIds });
const backup = createBackup({ db, dir: cfg.backupDir, tz: cfg.timezone });

store.on('employees', () => sync.schedule());
store.on('devices', () => {
  monitor.checkAll().then(() => sync.schedule()).catch((e) => console.error(e));
});

const api = createApi({ store, auth, cfg, sync, backup, version: pkg.version });
const app = createServer({ store, cfg, telegram, api });

const { port: wantedPort, fixed } = preferredPort(cfg);

listenWithFallback(app, wantedPort).then(({ port }) => {
  cfg.port = port;
  rememberPort(cfg, port);
  console.log(`🚀 Davomat tizimi ishga tushdi (v${pkg.version})`);
  if (port !== wantedPort) {
    console.warn(`
⚠️  ${wantedPort}-port band edi, shuning uchun ${port}-port ishlatilmoqda (keyingi safar ham shu port bo'ladi).
   Terminallar oldin ${wantedPort}-portga sozlangan bo'lsa: har bir terminalning HTTP Listening
   sahifasida Port ni ${port} ga o'zgartiring (Terminallar sahifasida ham ko'rsatilgan).
   Firewall: firewall-ochish.bat ni administrator sifatida qayta ishga tushiring.
`);
  }
  console.log(`   Shu kompyuterda: http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`   Tarmoqdagi manzil: http://${ip}:${port}`);
  console.log(`   Baza: ${cfg.dbPath}`);
  console.log(`   ${store.employees.size} xodim, ${store.devices.size} terminal`);
  if (store.countUsers() === 0) console.log(`👉 Birinchi marta: brauzerda http://localhost:${port} ni ochib administrator yarating`);
  if (process.env.OPEN_BROWSER === '1') openBrowser(`http://localhost:${port}`);

  monitor.checkAll().then(() => sync.schedule()).catch((e) => console.error(e));
  setInterval(() => {
    monitor.checkAll().then(() => sync.schedule()).catch((e) => console.error(e));
  }, cfg.deviceCheckSeconds * 1000).unref();

  backup.daily();
  setInterval(() => backup.daily(), 3600 * 1000).unref();
  store.pruneEvents(90);
  setInterval(() => store.pruneEvents(90), 24 * 3600 * 1000).unref();

  if (telegram.enabled) {
    console.log('🤖 Telegram bot yoqilgan');
    telegram.startPolling();
    startDailyReport({ store, telegram, tz: cfg.timezone });
  }
}).catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ ${wantedPort}–${wantedPort + 29} portlarning hammasi band${fixed ? ` (server\\.env dagi PORT=${wantedPort} ni o'zgartiring)` : ''}.`);
  } else {
    console.error('❌ Serverni ishga tushirib bo\'lmadi:', err.message);
  }
  process.exit(1);
});

function openBrowser(url) {
  const { exec } = require('node:child_process');
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}
