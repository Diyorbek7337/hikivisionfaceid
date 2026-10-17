'use strict';
const path = require('node:path');

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const ROOT = path.join(__dirname, '..');
const resolve = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    timezone: env.TIMEZONE || 'Asia/Tashkent',
    serviceAccountPath: resolve(env.FIREBASE_SERVICE_ACCOUNT || './serviceAccountKey.json'),
    webConfigPath: resolve(env.FIREBASE_WEB_CONFIG || './firebase-web-config.json'),
    webDir: resolve(env.WEB_DIR || '../web/out'),
    adminEmails: list(env.ADMIN_EMAILS).map((e) => e.toLowerCase()),
    botToken: env.BOT_TOKEN || '',
    adminTelegramIds: list(env.ADMIN_TELEGRAM_IDS),
    // How often terminals are checked (online status, clock) and failed syncs retried.
    deviceCheckSeconds: Number(env.DEVICE_CHECK_SECONDS) || 60,
  };
}

/** Defaults for the settings/general document that admins edit in the web app. */
const DEFAULT_SETTINGS = {
  lateGraceMinutes: 5,
  debounceSeconds: 60,
  autoTimeSync: true,
};

module.exports = { loadConfig, DEFAULT_SETTINGS, ROOT };
