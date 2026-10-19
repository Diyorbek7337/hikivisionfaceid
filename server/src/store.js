'use strict';
/**
 * Data access for the whole app (SQLite). Keeps in-memory copies of employees and devices so that
 * recognising a face needs no query, and emits 'employees' / 'devices' when they change
 * (the sync engine listens to push changes to the terminals).
 */
const { EventEmitter } = require('node:events');
const { newDeviceId } = require('./db');
const { punchesOf, summarizeDay, serializePunches } = require('./sessions');

const DEFAULT_SETTINGS = {
  lateGraceMinutes: 5,
  debounceSeconds: 60,
  autoTimeSync: true,
  dailyReportTime: '09:30',
  dailyReportEnabled: true,
  organizationName: '',
  dailyReportSentFor: '',
  telegramViewers: [], // [{ id, name }] who may open the Telegram mini app (read-only)
  accessPlansVersion: 0, // bumped when door entry schedules change; terminals store the version they have
};

/** Template / week plan numbers used for door entry schedules (1 is the terminal's built-in "all day"). */
const ACCESS_SLOTS = { min: 2, max: 32 };

const bool = (v) => !!Number(v);
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const PAY_TYPES = new Set(['hourly', 'daily', 'session']);
const payTypeOf = (v) => (PAY_TYPES.has(v) ? v : 'hourly');
const toDate = (v) => (v ? new Date(v) : null);
const iso = (v) => (v ? new Date(v).toISOString() : null);

function weekdayOf(date) {
  // date is "YYYY-MM-DD" (local); weekday of that calendar day
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function mapEmployee(r) {
  return {
    id: r.id,
    employeeNo: r.employee_no,
    name: r.name,
    position: r.position || '',
    kind: r.kind === 'student' ? 'student' : 'staff',
    className: r.class_name || '',
    phone: r.phone || '',
    telegramChatId: r.telegram_chat_id || '',
    scheduleId: r.schedule_id,
    personalSchedule: json(r.personal_schedule, null),
    accessProfileId: r.access_profile_id || null,
    payType: payTypeOf(r.pay_type),
    payRate: r.hourly_rate,
    active: bool(r.active),
    deleted: bool(r.deleted),
    hasFace: bool(r.has_face),
    version: r.version,
    deviceSync: json(r.device_sync, {}),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapDevice(r) {
  return {
    ...json(r.status, {}),
    id: r.id,
    name: r.name,
    ip: r.ip || '',
    port: r.port,
    username: r.username,
    password: r.password,
    direction: r.direction,
    disabled: bool(r.disabled),
    resyncRequestedAt: r.resync_requested_at || null,
    resyncDoneFor: r.resync_done_for || null,
    createdAt: r.created_at,
  };
}

function mapAttendance(r) {
  if (!r) return null;
  const rec = {
    id: r.id,
    employeeId: r.employee_id,
    date: r.date,
    employeeNo: r.employee_no,
    employeeName: r.employee_name,
    checkIn: toDate(r.check_in),
    checkInDeviceId: r.check_in_device_id,
    checkInDeviceName: r.check_in_device_name,
    checkOut: toDate(r.check_out),
    checkOutDeviceId: r.check_out_device_id,
    checkOutDeviceName: r.check_out_device_name,
    workStart: r.work_start,
    workEnd: r.work_end,
    payType: payTypeOf(r.pay_type),
    payRate: r.hourly_rate,
    lateMinutes: r.late_minutes,
    earlyMinutes: r.early_minutes,
    workedMinutes: r.worked_minutes,
    manual: bool(r.manual),
  };
  rec.punches = punchesOf({ ...rec, punches: r.punches ? json(r.punches, null) : null });
  const day = summarizeDay(rec.punches);
  rec.sessions = day.sessions;
  rec.openSessions = day.openSessions;
  return rec;
}

function mapUser(r) {
  const { classes, ...rest } = r;
  return { ...rest, role: r.role === 'teacher' ? 'teacher' : 'admin', classes: json(classes, []) };
}

function mapSchedule(r) {
  return { id: r.id, name: r.name, type: r.type === 'flexible' ? 'flexible' : 'fixed', days: json(r.days, {}) };
}

class LocalStore extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.ready = Promise.resolve();
    this.employees = new Map();
    this.devices = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.reloadSettings();
    this.reloadEmployees(false);
    this.reloadDevices(false);
  }

  q(sql) { return this.db.prepare(sql); }

  // ---------- caches ----------
  reloadEmployees(emit = true) {
    this.employees = new Map(this.q('SELECT * FROM employees').all().map((r) => [r.id, mapEmployee(r)]));
    if (emit) this.emit('employees');
  }

  reloadDevices(emit = true) {
    this.devices = new Map(this.q('SELECT * FROM devices').all().map((r) => [r.id, mapDevice(r)]));
    if (emit) this.emit('devices');
  }

  reloadSettings() {
    const s = { ...DEFAULT_SETTINGS };
    for (const r of this.q('SELECT key, value FROM settings').all()) s[r.key] = json(r.value, null);
    this.settings = s;
  }

  // ---------- settings ----------
  saveSettings(patch) {
    const stmt = this.q('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
    this.reloadSettings();
    this.emit('settings');
    return this.settings;
  }

  // ---------- schedules ----------
  listSchedules() { return this.q('SELECT * FROM schedules ORDER BY id').all().map(mapSchedule); }

  getSchedule(id) {
    const r = this.q('SELECT * FROM schedules WHERE id = ?').get(id);
    return r ? mapSchedule(r) : null;
  }

  saveSchedule({ id, name, type, days }) {
    const t = type === 'flexible' ? 'flexible' : 'fixed';
    if (id) {
      this.q('UPDATE schedules SET name = ?, type = ?, days = ? WHERE id = ?').run(name, t, JSON.stringify(days), id);
      return id;
    }
    return Number(this.q('INSERT INTO schedules (name, type, days) VALUES (?, ?, ?)').run(name, t, JSON.stringify(days)).lastInsertRowid);
  }

  deleteSchedule(id) {
    const first = this.listSchedules()[0];
    // Employees without an explicit schedule use the first one.
    // Employees with a personal schedule do not use any shared one.
    const implicit = first && first.id === id
      ? this.q('SELECT COUNT(*) AS n FROM employees WHERE schedule_id IS NULL AND personal_schedule IS NULL AND deleted = 0').get().n : 0;
    const used = this.q('SELECT COUNT(*) AS n FROM employees WHERE schedule_id = ? AND personal_schedule IS NULL AND deleted = 0').get(id).n + implicit;
    if (used) throw Object.assign(new Error(`Bu jadval ${used} ta xodimga biriktirilgan`), { status: 400 });
    if (this.q('SELECT COUNT(*) AS n FROM schedules').get().n <= 1) {
      throw Object.assign(new Error('Kamida bitta jadval qolishi kerak'), { status: 400 });
    }
    this.q('DELETE FROM schedules WHERE id = ?').run(id);
  }

  /** The schedule an employee follows: their personal one, the chosen shared one, or the first (default) one. */
  scheduleFor(employee) {
    const own = employee.personalSchedule;
    if (own) return { id: null, name: 'Shaxsiy jadval', personal: true, type: own.type === 'flexible' ? 'flexible' : 'fixed', days: own.days || {} };
    let sched = employee.scheduleId ? this.getSchedule(employee.scheduleId) : null;
    if (!sched) sched = this.listSchedules()[0];
    return sched || null;
  }

  /** Flexible schedule: the employee comes when needed — no lateness, no absence, only presence and hours. */
  isFlexible(employee) {
    const sched = this.scheduleFor(employee);
    return !!sched && sched.type === 'flexible';
  }

  /** Work hours of an employee on a date: { start, end } or null for a day off (and always null on a flexible schedule). */
  getWorkHoursSync(employee, date) {
    const sched = this.scheduleFor(employee);
    if (!sched || sched.type === 'flexible') return null;
    const d = sched.days[String(weekdayOf(date))];
    return d && d.start && d.end ? { start: d.start, end: d.end } : null;
  }

  async getWorkHours(employee, date) { return this.getWorkHoursSync(employee, date); }

  // ---------- door entry schedules ----------
  listAccessProfiles() {
    return this.q('SELECT * FROM access_profiles ORDER BY id').all().map((r) => ({ id: r.id, name: r.name, slot: r.slot, days: json(r.days, {}) }));
  }

  getAccessProfile(id) { return this.listAccessProfiles().find((p) => p.id === Number(id)) || null; }

  saveAccessProfile({ id, name, days }) {
    if (id) {
      this.q('UPDATE access_profiles SET name = ?, days = ? WHERE id = ?').run(name, JSON.stringify(days), id);
    } else {
      const used = new Set(this.listAccessProfiles().map((p) => p.slot));
      let slot = ACCESS_SLOTS.min;
      while (used.has(slot)) slot += 1;
      if (slot > ACCESS_SLOTS.max) throw Object.assign(new Error('Ruxsat jadvallari soni chegarasiga yetdi'), { status: 400 });
      id = Number(this.q('INSERT INTO access_profiles (name, slot, days) VALUES (?, ?, ?)').run(name, slot, JSON.stringify(days)).lastInsertRowid);
    }
    this.saveSettings({ accessPlansVersion: (Number(this.settings.accessPlansVersion) || 0) + 1 });
    return id;
  }

  deleteAccessProfile(id) {
    const used = this.q('SELECT COUNT(*) AS n FROM employees WHERE access_profile_id = ? AND deleted = 0').get(id).n;
    if (used) throw Object.assign(new Error(`Bu ruxsat jadvali ${used} ta xodimga biriktirilgan`), { status: 400 });
    this.q('DELETE FROM access_profiles WHERE id = ?').run(id);
    this.q('UPDATE employees SET access_profile_id = NULL WHERE access_profile_id = ?').run(id); // deleted employees
    this.saveSettings({ accessPlansVersion: (Number(this.settings.accessPlansVersion) || 0) + 1 });
  }

  /**
   * Access template number for this employee on this terminal. Exit terminals always use 1 (any time):
   * nobody must be locked inside after hours.
   */
  accessTemplateFor(employee, device) {
    if (!employee.accessProfileId || (device && device.direction === 'out')) return 1;
    const p = this.getAccessProfile(employee.accessProfileId);
    return p ? p.slot : 1;
  }

  // ---------- employees ----------
  async findEmployeeByNo(no) {
    for (const e of this.employees.values()) if (!e.deleted && String(e.employeeNo) === String(no)) return e;
    return null;
  }

  getEmployee(id) {
    const r = this.q('SELECT * FROM employees WHERE id = ?').get(id);
    return r ? mapEmployee(r) : null;
  }

  nextEmployeeNo() {
    const r = this.q('SELECT MAX(CAST(employee_no AS INTEGER)) AS m FROM employees').get();
    return String((r.m || 0) + 1);
  }

  createEmployee(e, { emit = true } = {}) {
    const r = this.q(`INSERT INTO employees (employee_no, name, position, phone, telegram_chat_id, schedule_id, personal_schedule, access_profile_id,
      pay_type, hourly_rate, active, kind, class_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      this.nextEmployeeNo(), e.name, e.position || null, e.phone || null, e.telegramChatId || null,
      e.scheduleId || null, e.personalSchedule ? JSON.stringify(e.personalSchedule) : null, e.accessProfileId || null,
      payTypeOf(e.payType), Number(e.payRate) || 0, e.active === false ? 0 : 1,
      e.kind === 'student' ? 'student' : 'staff', e.className || null,
    );
    if (emit) this.reloadEmployees();
    return Number(r.lastInsertRowid);
  }

  updateEmployee(id, e) {
    this.q(`UPDATE employees SET name = ?, position = ?, phone = ?, telegram_chat_id = ?, schedule_id = ?, personal_schedule = ?,
      access_profile_id = ?, pay_type = ?, hourly_rate = ?, active = ?, kind = ?, class_name = ?,
      version = version + 1, updated_at = ? WHERE id = ?`).run(
      e.name, e.position || null, e.phone || null, e.telegramChatId || null, e.scheduleId || null,
      e.personalSchedule ? JSON.stringify(e.personalSchedule) : null, e.accessProfileId || null, payTypeOf(e.payType), Number(e.payRate) || 0,
      e.active ? 1 : 0, e.kind === 'student' ? 'student' : 'staff', e.className || null, nowIso(), id,
    );
    this.reloadEmployees();
  }

  deleteEmployee(id) {
    this.db.exec('BEGIN');
    try {
      this.q('UPDATE employees SET deleted = 1, active = 0, has_face = 0, version = version + 1, updated_at = ? WHERE id = ?').run(nowIso(), id);
      this.q('DELETE FROM employee_faces WHERE employee_id = ?').run(id);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.reloadEmployees();
  }

  /** Imports many employees at once (one transaction, one sync run). */
  importEmployees(rows) {
    const ids = [];
    this.db.exec('BEGIN');
    try {
      for (const row of rows) ids.push(this.createEmployee(row, { emit: false }));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.reloadEmployees();
    return ids;
  }

  setFace(id, jpegBuffer) {
    if (jpegBuffer) {
      this.q(`INSERT INTO employee_faces (employee_id, image, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(employee_id) DO UPDATE SET image = excluded.image, updated_at = excluded.updated_at`).run(id, jpegBuffer, nowIso());
    } else {
      this.q('DELETE FROM employee_faces WHERE employee_id = ?').run(id);
    }
    this.q('UPDATE employees SET has_face = ?, version = version + 1, updated_at = ? WHERE id = ?').run(jpegBuffer ? 1 : 0, nowIso(), id);
    this.reloadEmployees();
  }

  async getFace(id) {
    const r = this.q('SELECT image FROM employee_faces WHERE employee_id = ?').get(id);
    return r ? Buffer.from(r.image) : null;
  }

  async setEmployeeSync(employeeId, deviceId, data) {
    if (!this.devices.has(deviceId)) return; // terminal deleted while it was being synced
    const emp = this.employees.get(employeeId);
    const current = emp ? emp.deviceSync : json((this.q('SELECT device_sync FROM employees WHERE id = ?').get(employeeId) || {}).device_sync, {});
    const next = { ...current, [deviceId]: data };
    this.q('UPDATE employees SET device_sync = ? WHERE id = ?').run(JSON.stringify(next), employeeId);
    if (emp) emp.deviceSync = next;
  }

  // ---------- devices ----------
  getDevice(id) { return this.devices.get(id) || null; }

  saveDevice(d) {
    if (d.id) {
      // Keep the status (event cursor, serial number…) but make the monitor check the terminal again.
      const old = this.devices.get(d.id);
      const { online: _o, lastError: _e, ...keep } = old ? json(this.q('SELECT status FROM devices WHERE id = ?').get(d.id).status, {}) : {};
      this.q('UPDATE devices SET name = ?, ip = ?, port = ?, username = ?, password = ?, direction = ?, status = ? WHERE id = ?')
        .run(d.name, d.ip, Number(d.port) || 80, d.username || 'admin', d.password ?? '', d.direction, JSON.stringify(keep), d.id);
      this.reloadDevices();
      return d.id;
    }
    const id = newDeviceId();
    this.q('INSERT INTO devices (id, name, ip, port, username, password, direction) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, d.name, d.ip, Number(d.port) || 80, d.username || 'admin', d.password ?? '', d.direction);
    this.reloadDevices();
    return id;
  }

  deleteDevice(id) {
    this.q('DELETE FROM devices WHERE id = ?').run(id);
    // forget this terminal's sync state in every employee row
    for (const e of this.employees.values()) {
      if (e.deviceSync && e.deviceSync[id]) {
        delete e.deviceSync[id];
        this.q('UPDATE employees SET device_sync = ? WHERE id = ?').run(JSON.stringify(e.deviceSync), e.id);
      }
    }
    this.reloadDevices();
  }

  requestResync(id) {
    this.q('UPDATE devices SET resync_requested_at = ? WHERE id = ?').run(Date.now(), id);
    this.reloadDevices();
  }

  /** Used by the monitor and the sync engine. Status fields are stored as JSON. */
  async updateDevice(id, data) {
    const dev = this.devices.get(id);
    if (!dev) return;
    const { resyncDoneFor, ...status } = data;
    if (resyncDoneFor !== undefined) {
      this.q('UPDATE devices SET resync_done_for = ? WHERE id = ?').run(resyncDoneFor, id);
      dev.resyncDoneFor = resyncDoneFor;
    }
    if (Object.keys(status).length) {
      const row = this.q('SELECT status FROM devices WHERE id = ?').get(id);
      const merged = { ...json(row && row.status, {}), ...status };
      this.q('UPDATE devices SET status = ? WHERE id = ?').run(JSON.stringify(merged), id);
      Object.assign(dev, status);
    }
  }

  // ---------- attendance ----------
  async getAttendance(employeeId, date) {
    return mapAttendance(this.q('SELECT * FROM attendance WHERE employee_id = ? AND date = ?').get(employeeId, date));
  }

  async saveAttendance(rec) {
    this.q(`INSERT INTO attendance (employee_id, date, employee_no, employee_name, check_in, check_in_device_id, check_in_device_name,
        check_out, check_out_device_id, check_out_device_name, work_start, work_end, pay_type, hourly_rate, late_minutes, early_minutes,
        worked_minutes, manual, punches, updated_at)
      VALUES (:employee_id, :date, :employee_no, :employee_name, :check_in, :check_in_device_id, :check_in_device_name,
        :check_out, :check_out_device_id, :check_out_device_name, :work_start, :work_end, :pay_type, :hourly_rate, :late_minutes,
        :early_minutes, :worked_minutes, :manual, :punches, :updated_at)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        employee_no = excluded.employee_no, employee_name = excluded.employee_name,
        check_in = excluded.check_in, check_in_device_id = excluded.check_in_device_id, check_in_device_name = excluded.check_in_device_name,
        check_out = excluded.check_out, check_out_device_id = excluded.check_out_device_id, check_out_device_name = excluded.check_out_device_name,
        work_start = excluded.work_start, work_end = excluded.work_end, pay_type = excluded.pay_type, hourly_rate = excluded.hourly_rate,
        late_minutes = excluded.late_minutes, early_minutes = excluded.early_minutes, worked_minutes = excluded.worked_minutes,
        manual = excluded.manual, punches = excluded.punches, updated_at = excluded.updated_at`).run({
      employee_id: rec.employeeId,
      date: rec.date,
      employee_no: rec.employeeNo ?? null,
      employee_name: rec.employeeName ?? null,
      check_in: iso(rec.checkIn),
      check_in_device_id: rec.checkInDeviceId ?? null,
      check_in_device_name: rec.checkInDeviceName ?? null,
      check_out: iso(rec.checkOut),
      check_out_device_id: rec.checkOutDeviceId ?? null,
      check_out_device_name: rec.checkOutDeviceName ?? null,
      work_start: rec.workStart ?? null,
      work_end: rec.workEnd ?? null,
      pay_type: payTypeOf(rec.payType),
      hourly_rate: Number(rec.payRate) || 0,
      late_minutes: rec.lateMinutes || 0,
      early_minutes: rec.earlyMinutes || 0,
      worked_minutes: rec.workedMinutes ?? null,
      manual: rec.manual ? 1 : 0,
      punches: serializePunches(punchesOf(rec)),
      updated_at: nowIso(),
    });
    return this.getAttendance(rec.employeeId, rec.date);
  }

  listAttendance(from, to) {
    return this.q('SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC, employee_name COLLATE NOCASE')
      .all(from, to).map(mapAttendance);
  }

  getAttendanceById(id) { return mapAttendance(this.q('SELECT * FROM attendance WHERE id = ?').get(id)); }

  deleteAttendance(id) { this.q('DELETE FROM attendance WHERE id = ?').run(id); }

  // ---------- events ----------
  async eventExists(key) { return !!this.q('SELECT 1 FROM events WHERE id = ?').get(key); }

  /** Same person on the same terminal within a few seconds (one scan delivered by push and by polling). */
  async similarEventExists(deviceId, employeeNo, time, windowMs = 3000) {
    if (!employeeNo || !time) return false;
    const t = new Date(time).getTime();
    return !!this.q('SELECT 1 FROM events WHERE device_id = ? AND employee_no = ? AND time BETWEEN ? AND ? LIMIT 1')
      .get(deviceId, String(employeeNo), new Date(t - windowMs).toISOString(), new Date(t + windowMs).toISOString());
  }

  async saveEvent(key, d) {
    this.q(`INSERT OR IGNORE INTO events (id, received_at, device_id, device_name, time, employee_no, employee_id, person_name, major, minor, action)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      key, nowIso(), d.deviceId ?? null, d.deviceName ?? null, iso(d.time), d.employeeNo ?? null, d.employeeId ?? null,
      d.personName ?? null, d.major ?? null, d.minor ?? null, d.action,
    );
  }

  listEvents(limit = 150) {
    return this.q('SELECT * FROM events ORDER BY received_at DESC LIMIT ?').all(limit).map((r) => ({
      id: r.id, receivedAt: r.received_at, deviceId: r.device_id, deviceName: r.device_name, time: r.time,
      employeeNo: r.employee_no, employeeId: r.employee_id, personName: r.person_name, major: r.major, minor: r.minor, action: r.action,
    }));
  }

  /** Removes events a terminal reported from before it was added here (its earlier memory). Returns the count. */
  pruneEventsBeforeDevices(boundAtOf) {
    let n = 0;
    for (const dev of this.devices.values()) {
      const bound = boundAtOf(dev);
      if (!bound) continue;
      const floor = new Date(bound - 5 * 60 * 1000).toISOString();
      n += Number(this.q('DELETE FROM events WHERE device_id = ? AND time < ?').run(dev.id, floor).changes);
    }
    return n;
  }

  async pruneEvents(days = 90) {
    this.q('DELETE FROM events WHERE received_at < ?').run(new Date(Date.now() - days * 86400000).toISOString());
  }

  // ---------- users ----------
  countUsers() { return this.q('SELECT COUNT(*) AS n FROM users').get().n; }
  countAdmins() { return this.q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n; }
  listUsers() {
    return this.q('SELECT id, username, name, role, classes, created_at FROM users ORDER BY id').all().map(mapUser);
  }
  getUserByName(username) { const r = this.q('SELECT * FROM users WHERE username = ?').get(username); return r ? mapUser(r) : null; }
  getUser(id) { const r = this.q('SELECT id, username, name, role, classes, session_version FROM users WHERE id = ?').get(id); return r ? mapUser(r) : null; }
  /** Invalidates all existing sessions of the user (logout, password change). */
  bumpSessionVersion(id) { this.q('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run(id); }
  createUser({ username, name, passwordHash, role = 'admin', classes = [] }) {
    return Number(this.q('INSERT INTO users (username, name, password_hash, role, classes) VALUES (?, ?, ?, ?, ?)')
      .run(username, name || null, passwordHash, role === 'teacher' ? 'teacher' : 'admin', JSON.stringify(classes)).lastInsertRowid);
  }
  /** Role or classes changed: existing sessions end so the new rights apply at once. */
  updateUser(id, { name, role, classes }) {
    const u = this.getUser(id);
    if (!u) throw Object.assign(new Error('Foydalanuvchi topilmadi'), { status: 404 });
    if (u.role === 'admin' && role !== 'admin' && this.countAdmins() <= 1) {
      throw Object.assign(new Error('Kamida bitta administrator qolishi kerak'), { status: 400 });
    }
    this.q('UPDATE users SET name = ?, role = ?, classes = ?, session_version = session_version + 1 WHERE id = ?')
      .run(name || null, role === 'teacher' ? 'teacher' : 'admin', JSON.stringify(classes || []), id);
  }
  setUserPassword(id, passwordHash) {
    this.q('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, id);
  }
  deleteUser(id) {
    if (this.countUsers() <= 1) throw Object.assign(new Error('Oxirgi foydalanuvchini o\'chirib bo\'lmaydi'), { status: 400 });
    const u = this.getUser(id);
    if (u && u.role === 'admin' && this.countAdmins() <= 1) throw Object.assign(new Error('Oxirgi administratorni o\'chirib bo\'lmaydi'), { status: 400 });
    this.q('DELETE FROM users WHERE id = ?').run(id);
  }

  // ---------- system ----------
  async setBridgeStatus() { /* local mode: status is served directly by the API */ }
}

module.exports = { LocalStore, DEFAULT_SETTINGS, weekdayOf, mapAttendance };
