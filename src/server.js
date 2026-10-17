'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Load .env if present (simple KEY=VALUE format, no extra dependency).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createTelegram } = require('./telegram');
const { createApp } = require('./app');

const cfg = loadConfig();
const repo = openDb(cfg.dbPath);
const telegram = createTelegram({ token: cfg.botToken, adminIds: cfg.adminTelegramIds });
const app = createApp({ repo, cfg, telegram });

if (!cfg.adminPassword) console.warn('⚠️  ADMIN_PASSWORD sozlanmagan — admin panelga kirib bo\'lmaydi.');
if (cfg.sessionSecretGenerated) console.warn('⚠️  SESSION_SECRET sozlanmagan — server qayta ishga tushganda qayta login talab qilinadi.');

// Keep the raw event log for 60 days.
const prune = () => repo.pruneEvents(new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString());
prune();
setInterval(prune, 24 * 3600 * 1000).unref();

app.listen(cfg.port, () => {
  console.log(`🚀 Davomat server ishga tushdi: http://localhost:${cfg.port}/admin`);
  if (telegram.enabled) {
    console.log('🤖 Telegram bot yoqilgan');
    telegram.startPolling();
  }
});
