'use strict';
const crypto = require('node:crypto');

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function loadConfig(env = process.env) {
  const cfg = {
    port: Number(env.PORT) || 3000,
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    adminUsername: env.ADMIN_USERNAME || 'admin',
    adminPassword: env.ADMIN_PASSWORD || '',
    sessionSecret: env.SESSION_SECRET || '',
    dbPath: env.DB_PATH || './data/davomat.db',
    timezone: env.TIMEZONE || 'Asia/Tashkent',
    lateGraceMinutes: env.LATE_GRACE_MINUTES !== undefined && env.LATE_GRACE_MINUTES !== ''
      ? Number(env.LATE_GRACE_MINUTES) : 5,
    debounceSeconds: env.DEBOUNCE_SECONDS !== undefined && env.DEBOUNCE_SECONDS !== ''
      ? Number(env.DEBOUNCE_SECONDS) : 60,
    botToken: env.BOT_TOKEN || '',
    adminTelegramIds: list(env.ADMIN_TELEGRAM_IDS),
  };
  if (!cfg.sessionSecret) {
    cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
    cfg.sessionSecretGenerated = true;
  }
  return cfg;
}

module.exports = { loadConfig };
