'use strict';
const fs = require('node:fs');
const { loadEnvFile } = require('./env');

loadEnvFile();

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { loadConfig } = require('./config');
const { FirestoreStore } = require('./store');
const { IsapiClient } = require('./isapi');
const { SyncEngine } = require('./sync');
const { DeviceMonitor } = require('./monitor');
const { createServer } = require('./server');
const { createTelegram } = require('./telegram');
const { lanAddresses } = require('./net');
const pkg = require('../package.json');

const cfg = loadConfig();

const useEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
if (!useEmulator && !fs.existsSync(cfg.serviceAccountPath)) {
  console.error(`❌ Firebase kaliti topilmadi: ${cfg.serviceAccountPath}
   Firebase Console → Project settings → Service accounts → "Generate new private key"
   Yuklab olingan faylni shu nom bilan bridge papkasiga qo'ying (README ga qarang).`);
  process.exit(1);
}

if (useEmulator) {
  // Local testing with the Firebase emulators (FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST).
  initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-davomat' });
  console.log(`🧪 Firebase emulyatori: ${process.env.FIRESTORE_EMULATOR_HOST}`);
} else {
  initializeApp({ credential: cert(JSON.parse(fs.readFileSync(cfg.serviceAccountPath, 'utf8'))) });
}
const store = new FirestoreStore(getFirestore(), getAuth());

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

store.on('employees', () => sync.schedule());
store.on('devices', () => {
  monitor.checkAll().catch((e) => console.error(e));
  sync.schedule();
});
store.start();

const app = createServer({ store, cfg, telegram });
app.listen(cfg.port, async () => {
  const ips = lanAddresses();
  console.log(`🚀 Ko'prik ishga tushdi (v${pkg.version})`);
  console.log(`   Web app: http://localhost:${cfg.port}`);
  for (const ip of ips) console.log(`   Tarmoqdagi manzil: http://${ip}:${cfg.port}`);
  if (!fs.existsSync(cfg.webConfigPath)) console.warn(`⚠️  ${cfg.webConfigPath} yo'q — web app Firebase'ga ulana olmaydi.`);

  await store.ready;
  console.log(`🔥 Firebase ulandi: ${store.employees.size} xodim, ${store.devices.size} terminal`);
  await store.ensureAdmins(cfg.adminEmails);

  const heartbeat = () => store.setBridgeStatus({ ips, port: cfg.port, version: pkg.version, startedAt: startedAt })
    .catch((e) => console.error('Firestore:', e.message));
  const startedAt = Date.now();
  heartbeat();
  setInterval(heartbeat, 5 * 60 * 1000).unref();

  setInterval(() => {
    monitor.checkAll().then(() => sync.schedule()).catch((e) => console.error(e));
  }, cfg.deviceCheckSeconds * 1000).unref();

  const prune = () => store.pruneEvents(60).catch((e) => console.error('Eventlarni tozalash:', e.message));
  prune();
  setInterval(prune, 24 * 3600 * 1000).unref();

  if (telegram.enabled) {
    console.log('🤖 Telegram bot yoqilgan');
    telegram.startPolling();
  }
});
