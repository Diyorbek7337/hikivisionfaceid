'use strict';
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function loadConfig(env = process.env) {
  const dataDir = resolve(env.DATA_DIR || './data');
  return {
    port: Number(env.PORT) || 3000,
    timezone: env.TIMEZONE || 'Asia/Tashkent',
    dataDir,
    dbPath: path.join(dataDir, 'davomat.db'),
    backupDir: path.join(dataDir, 'backups'),
    webDir: resolve(env.WEB_DIR || '../web/out'),
    botToken: env.BOT_TOKEN || '',
    adminTelegramIds: list(env.ADMIN_TELEGRAM_IDS),
    // How often terminals are checked (online status, clock) and failed syncs retried.
    deviceCheckSeconds: Number(env.DEVICE_CHECK_SECONDS) || 60,
  };
}

module.exports = { loadConfig, ROOT };
