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

// Never let one unexpected error stop the whole system: log it and keep running.
process.on('unhandledRejection', (err) => console.error('❌ Kutilmagan xato:', (err && err.stack) || err));
process.on('uncaughtException', (err) => console.error('❌ Kutilmagan xato:', (err && err.stack) || err));

const { loadConfig } = require('./config');
const { openDatabase } = require('./db');
const { LocalStore } = require('./store');
const { IsapiClient } = require('./isapi');
const { SyncEngine } = require('./sync');
const { DeviceMonitor } = require('./monitor');
const { createServer } = require('./server');
const { createEventProcessor } = require('./events');
const { EventPoller } = require('./poller');
const { createApi } = require('./api');
const { createAuth } = require('./auth');
const { createBackup } = require('./backup');
const { createTelegram } = require('./telegram');
const { createTgApi } = require('./tgapp');
const { createBotHandler } = require('./bot');
const { startDailyReport } = require('./report');
const { lanAddresses } = require('./net');
const { startListening } = require('./listen');
const pkg = require('../package.json');

const cfg = loadConfig();
const db = openDatabase(cfg.dbPath);
const store = new LocalStore(db);

// Session secret: generated once and kept next to the database.
const secretFile = path.join(cfg.dataDir, '.session_secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = fs.readFileSync(secretFile, 'utf8').trim();
const auth = createAuth({ store, secret });

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

const api = createApi({ store, auth, cfg, sync, backup, clientFor, version: pkg.version });
const processor = createEventProcessor({ store, tz: cfg.timezone, telegram });
const poller = new EventPoller({ store, clientFor, processor, tz: cfg.timezone });
const tgApi = createTgApi({ store, cfg, secret });
const app = createServer({ store, cfg, telegram, api, tgApi, processor });

startListening(app, cfg).then((started) => {
  if (started.alreadyRunning) {
    console.log(`
ℹ️  Davomat tizimi allaqachon ishlayapti: http://localhost:${started.alreadyRunning}
   (boshqa qora oyna ochiq). Ikkinchi nusxa ishga tushirilmaydi — brauzer ochiladi.
   Bu oyna 10 soniyadan keyin yopiladi.`);
    if (process.env.OPEN_BROWSER === '1') openBrowser(`http://localhost:${started.alreadyRunning}`);
    setTimeout(() => process.exit(0), 10000);
    return;
  }
  const { port } = started;
  cfg.port = port;
  console.log(`🚀 Davomat tizimi ishga tushdi (v${pkg.version})`);
  if (started.mode === 'temporary') {
    console.warn(`
⚠️⚠️  DIQQAT: tizim porti ${started.home}, lekin uni BOSHQA dastur band qilgan.
   Hozircha vaqtincha ${port}-portda ishlayapti — terminallar ${started.home}-portga yuborgani uchun
   ularning HTTP Listening eventlari yetib kelmaydi (terminal xotirasidan o'qish baribir ishlaydi).
   ${started.home}-portni band qilgan dasturni yoping va tizimni qayta ishga tushiring.
   Kim band qilganini ko'rish: cmd → netstat -ano | findstr :${started.home}
`);
  } else if (started.mode === 'first') {
    console.log(`   Tizim porti: ${port} (doimiy — terminallarda shu port yoziladi)`);
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

  poller.start();

  backup.daily();
  setInterval(() => backup.daily(), 3600 * 1000).unref();
  store.pruneEvents(90);
  setInterval(() => store.pruneEvents(90), 24 * 3600 * 1000).unref();

  if (telegram.enabled) {
    console.log('🤖 Telegram bot yoqilgan');
    telegram.startPolling(createBotHandler({ store, cfg, telegram }));
    if (cfg.publicUrl) console.log(`📱 Telegram mini ilova: ${cfg.publicUrl}/tg/`);
    startDailyReport({ store, telegram, tz: cfg.timezone });
  }
}).catch((err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('❌ Bo\'sh port topilmadi. server\\.env faylida PORT= ni boshqa raqamga o\'zgartiring.');
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
