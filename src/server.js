'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Load .env if present (simple KEY=VALUE format, no extra dependency).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createTelegram } = require('./telegram');
const { createApp } = require('./app');
const { lanAddresses } = require('./net');

const cfg = loadConfig();
// Relative DB path is taken from the project folder, not from where the command was started.
if (cfg.dbPath !== ':memory:' && !path.isAbsolute(cfg.dbPath)) cfg.dbPath = path.resolve(__dirname, '..', cfg.dbPath);
const repo = openDb(cfg.dbPath);
const telegram = createTelegram({ token: cfg.botToken, adminIds: cfg.adminTelegramIds });
const app = createApp({ repo, cfg, telegram });

if (!cfg.adminPassword) console.warn('⚠️  ADMIN_PASSWORD sozlanmagan — admin panelga kirib bo\'lmaydi.');
if (cfg.sessionSecretGenerated && cfg.dbPath !== ':memory:') {
  // Keep login sessions across restarts: store the generated secret next to the database.
  const secretFile = path.join(path.dirname(cfg.dbPath), '.session_secret');
  try {
    if (fs.existsSync(secretFile)) cfg.sessionSecret = fs.readFileSync(secretFile, 'utf8').trim() || cfg.sessionSecret;
    else fs.writeFileSync(secretFile, cfg.sessionSecret, { mode: 0o600 });
  } catch (err) {
    console.warn('⚠️  SESSION_SECRET saqlab bo\'lmadi:', err.message);
  }
}

// Keep the raw event log for 60 days.
const prune = () => repo.pruneEvents(new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString());
prune();
setInterval(prune, 24 * 3600 * 1000).unref();

app.listen(cfg.port, () => {
  console.log(`🚀 Davomat server ishga tushdi: http://localhost:${cfg.port}/admin`);
  for (const ip of lanAddresses()) console.log(`   Tarmoqdagi manzil: http://${ip}:${cfg.port}/admin`);
  console.log(`   Baza fayli: ${cfg.dbPath}`);
  if (telegram.enabled) {
    console.log('🤖 Telegram bot yoqilgan');
    telegram.startPolling();
  }
});
