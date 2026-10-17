'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  telegram_chat_id TEXT,
  work_start TEXT NOT NULL DEFAULT '09:00',
  work_end TEXT NOT NULL DEFAULT '18:00',
  hourly_rate INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL DEFAULT 'auto' CHECK (direction IN ('in','out','auto')),
  last_seen_at TEXT,
  last_ip TEXT,
  last_mac TEXT,
  last_skew_sec INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  check_in_at TEXT,
  check_in_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  check_out_at TEXT,
  check_out_device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_minutes INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER,
  UNIQUE (employee_id, date)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  event_time TEXT,
  event_type TEXT,
  employee_no TEXT,
  person_name TEXT,
  major INTEGER,
  minor INTEGER,
  serial_no INTEGER,
  action TEXT NOT NULL,
  raw TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS events_device_serial_time
  ON events (device_id, serial_no, event_time) WHERE serial_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_received ON events (received_at);
CREATE INDEX IF NOT EXISTS attendance_date ON attendance (date);
`;

function plain(row) {
  return row ? { ...row } : row;
}
function plainAll(rows) {
  return rows.map((r) => ({ ...r }));
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return createRepo(db);
}

function createRepo(db) {
  const q = (sql) => db.prepare(sql);

  return {
    raw: db,

    // ---------- employees ----------
    listEmployees({ includeInactive = false } = {}) {
      return plainAll(q(`SELECT * FROM employees ${includeInactive ? '' : 'WHERE active = 1'}
        ORDER BY active DESC, name COLLATE NOCASE`).all());
    },
    getEmployee(id) {
      return plain(q('SELECT * FROM employees WHERE id = ?').get(id));
    },
    getEmployeeByNo(no) {
      return plain(q('SELECT * FROM employees WHERE employee_no = ?').get(String(no)));
    },
    saveEmployee(e) {
      const p = {
        employee_no: e.employee_no, name: e.name, position: e.position || null,
        phone: e.phone || null, telegram_chat_id: e.telegram_chat_id || null,
        work_start: e.work_start, work_end: e.work_end,
        hourly_rate: Number(e.hourly_rate) || 0, active: e.active ? 1 : 0,
      };
      if (e.id) {
        q(`UPDATE employees SET employee_no=:employee_no, name=:name, position=:position, phone=:phone,
           telegram_chat_id=:telegram_chat_id, work_start=:work_start, work_end=:work_end,
           hourly_rate=:hourly_rate, active=:active WHERE id=:id`).run({ ...p, id: Number(e.id) });
        return Number(e.id);
      }
      const r = q(`INSERT INTO employees (employee_no, name, position, phone, telegram_chat_id, work_start,
        work_end, hourly_rate, active) VALUES (:employee_no, :name, :position, :phone, :telegram_chat_id,
        :work_start, :work_end, :hourly_rate, :active)`).run(p);
      return Number(r.lastInsertRowid);
    },
    deleteEmployee(id) {
      q('DELETE FROM employees WHERE id = ?').run(id);
    },

    // ---------- devices ----------
    listDevices() {
      return plainAll(q('SELECT * FROM devices ORDER BY id').all());
    },
    getDevice(id) {
      return plain(q('SELECT * FROM devices WHERE id = ?').get(id));
    },
    getDeviceByToken(token) {
      return plain(q('SELECT * FROM devices WHERE token = ?').get(String(token)));
    },
    saveDevice(d) {
      if (d.id) {
        q('UPDATE devices SET name = ?, direction = ? WHERE id = ?').run(d.name, d.direction, Number(d.id));
        return Number(d.id);
      }
      const token = crypto.randomBytes(12).toString('hex');
      const r = q('INSERT INTO devices (name, direction, token) VALUES (?, ?, ?)').run(d.name, d.direction, token);
      return Number(r.lastInsertRowid);
    },
    regenerateDeviceToken(id) {
      q('UPDATE devices SET token = ? WHERE id = ?').run(crypto.randomBytes(12).toString('hex'), id);
    },
    deleteDevice(id) {
      q('DELETE FROM devices WHERE id = ?').run(id);
    },
    touchDevice(id, { ip, mac, skewSec }) {
      q(`UPDATE devices SET last_seen_at = ?, last_ip = COALESCE(?, last_ip), last_mac = COALESCE(?, last_mac),
         last_skew_sec = COALESCE(?, last_skew_sec) WHERE id = ?`)
        .run(new Date().toISOString(), ip || null, mac || null, skewSec ?? null, id);
    },

    // ---------- events ----------
    /** Returns false when this (device, serial) pair was already stored (device re-sent the event). */
    insertEvent(ev) {
      const r = q(`INSERT OR IGNORE INTO events (received_at, device_id, event_time, event_type, employee_no,
        person_name, major, minor, serial_no, action, raw) VALUES (:received_at, :device_id, :event_time,
        :event_type, :employee_no, :person_name, :major, :minor, :serial_no, :action, :raw)`).run({
        received_at: new Date().toISOString(),
        device_id: ev.device_id ?? null,
        event_time: ev.event_time ?? null,
        event_type: ev.event_type ?? null,
        employee_no: ev.employee_no ?? null,
        person_name: ev.person_name ?? null,
        major: ev.major ?? null,
        minor: ev.minor ?? null,
        serial_no: ev.serial_no ?? null,
        action: ev.action,
        raw: ev.raw ?? null,
      });
      return r.changes > 0 ? Number(r.lastInsertRowid) : false;
    },
    setEventAction(id, action) {
      q('UPDATE events SET action = ? WHERE id = ?').run(action, id);
    },
    listEvents(limit = 200) {
      return plainAll(q(`SELECT e.*, d.name AS device_name FROM events e
        LEFT JOIN devices d ON d.id = e.device_id ORDER BY e.id DESC LIMIT ?`).all(limit));
    },
    pruneEvents(olderThanIso) {
      q('DELETE FROM events WHERE received_at < ?').run(olderThanIso);
    },

    // ---------- attendance ----------
    getAttendance(employeeId, date) {
      return plain(q('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, date));
    },
    upsertAttendance(a) {
      const p = {
        employee_id: a.employee_id, date: a.date,
        check_in_at: a.check_in_at ?? null, check_in_device_id: a.check_in_device_id ?? null,
        check_out_at: a.check_out_at ?? null, check_out_device_id: a.check_out_device_id ?? null,
        late_minutes: a.late_minutes || 0, early_minutes: a.early_minutes || 0,
        worked_minutes: a.worked_minutes ?? null,
      };
      q(`INSERT INTO attendance (employee_id, date, check_in_at, check_in_device_id, check_out_at,
          check_out_device_id, late_minutes, early_minutes, worked_minutes)
        VALUES (:employee_id, :date, :check_in_at, :check_in_device_id, :check_out_at, :check_out_device_id,
          :late_minutes, :early_minutes, :worked_minutes)
        ON CONFLICT (employee_id, date) DO UPDATE SET
          check_in_at = excluded.check_in_at, check_in_device_id = excluded.check_in_device_id,
          check_out_at = excluded.check_out_at, check_out_device_id = excluded.check_out_device_id,
          late_minutes = excluded.late_minutes, early_minutes = excluded.early_minutes,
          worked_minutes = excluded.worked_minutes`).run(p);
      return this.getAttendance(a.employee_id, a.date);
    },
    deleteAttendance(id) {
      q('DELETE FROM attendance WHERE id = ?').run(id);
    },
    getAttendanceById(id) {
      return plain(q('SELECT * FROM attendance WHERE id = ?').get(id));
    },
    listAttendance({ from, to, employeeId }) {
      return plainAll(q(`SELECT a.*, e.name AS employee_name, e.employee_no, e.hourly_rate,
          di.name AS in_device, dout.name AS out_device
        FROM attendance a JOIN employees e ON e.id = a.employee_id
        LEFT JOIN devices di ON di.id = a.check_in_device_id
        LEFT JOIN devices dout ON dout.id = a.check_out_device_id
        WHERE a.date BETWEEN :from AND :to AND (:employee_id IS NULL OR a.employee_id = :employee_id)
        ORDER BY a.date DESC, e.name COLLATE NOCASE`).all({ from, to, employee_id: employeeId ?? null }));
    },
  };
}

module.exports = { openDb };
