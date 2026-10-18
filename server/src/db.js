'use strict';
/**
 * SQLite database (built into Node.js 22.13+ as node:sqlite). One file: data/davomat.db
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch {
  console.error(`❌ Node.js versiyasi eski (${process.version}). 22.13 yoki yangiroq kerak: https://nodejs.org (LTS)`);
  process.exit(1);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  days TEXT NOT NULL, -- JSON: {"0": null, "1": {"start":"08:00","end":"17:00"}, ...} 0 = yakshanba
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  telegram_chat_id TEXT,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  has_face INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  device_sync TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS employee_faces (
  employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  image BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip TEXT,
  port INTEGER NOT NULL DEFAULT 80,
  username TEXT NOT NULL DEFAULT 'admin',
  password TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'in',
  disabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '{}', -- JSON written by the monitor: online, model, lastError, ...
  resync_requested_at INTEGER,
  resync_done_for INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  employee_no TEXT,
  employee_name TEXT,
  check_in TEXT,
  check_in_device_id TEXT,
  check_in_device_name TEXT,
  check_out TEXT,
  check_out_device_id TEXT,
  check_out_device_name TEXT,
  work_start TEXT,
  work_end TEXT,
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_minutes INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER,
  manual INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS attendance_date ON attendance (date);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  device_id TEXT,
  device_name TEXT,
  time TEXT,
  employee_no TEXT,
  employee_id INTEGER,
  person_name TEXT,
  major INTEGER,
  minor INTEGER,
  action TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_received ON events (received_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const DEFAULT_SCHEDULE_DAYS = {
  0: null,
  1: { start: '08:00', end: '17:00' },
  2: { start: '08:00', end: '17:00' },
  3: { start: '08:00', end: '17:00' },
  4: { start: '08:00', end: '17:00' },
  5: { start: '08:00', end: '17:00' },
  6: { start: '08:00', end: '17:00' },
};

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  const count = db.prepare('SELECT COUNT(*) AS n FROM schedules').get().n;
  if (!count) {
    db.prepare('INSERT INTO schedules (name, days) VALUES (?, ?)').run('Asosiy jadval', JSON.stringify(DEFAULT_SCHEDULE_DAYS));
  }
  return db;
}

/** Small additive migrations for databases created by earlier versions. */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
}

const newDeviceId = () => crypto.randomBytes(10).toString('hex');

module.exports = { openDatabase, newDeviceId, DEFAULT_SCHEDULE_DAYS };
