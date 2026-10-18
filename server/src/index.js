'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadEnvFile } = require('./env');

loadEnvFile();

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

const httpServer = app.listen(cfg.port, () => {
  console.log(`🚀 Davomat tizimi ishga tushdi (v${pkg.version})`);
  console.log(`   Shu kompyuterda: http://localhost:${cfg.port}`);
  for (const ip of lanAddresses()) console.log(`   Tarmoqdagi manzil: http://${ip}:${cfg.port}`);
  console.log(`   Baza: ${cfg.dbPath}`);
  console.log(`   ${store.employees.size} xodim, ${store.devices.size} terminal`);
  if (store.countUsers() === 0) console.log(`👉 Birinchi marta: brauzerda http://localhost:${cfg.port} ni ochib administrator yarating`);

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
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`
❌ ${cfg.port}-port band — uni boshqa dastur ishlatyapti.
   1) Ehtimol tizim allaqachon ochiq: boshqa qora oynani yoping va qayta urinib ko'ring.
   2) Yoki boshqa port tanlang: server\\.env faylida PORT=${cfg.port === 3050 ? 3080 : 3050} deb yozing
      (fayl yo'q bo'lsa, server\\.env.example dan nusxa oling). Keyin terminallardagi
      HTTP Listening portini ham shu raqamga o'zgartiring.
   Portni kim band qilganini ko'rish: cmd → netstat -ano | findstr :${cfg.port}`);
  } else {
    console.error('❌ Serverni ishga tushirib bo\'lmadi:', err.message);
  }
  process.exit(1);
});
