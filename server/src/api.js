'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { isLocalRequest } = require('./auth');
const { localDate, localTime, parseHHMM, tzOffsetMinutes } = require('./time');
const { computeStats } = require('./attendance');
const { daySummary, periodSummary } = require('./summary');
const { lanAddresses } = require('./net');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
/** "8:05" -> "08:05"; null when invalid */
function normHHMM(v) {
  const m = parseHHMM(v);
  return m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "2026-01-15" + "09:05" in the configured time zone -> Date */
function dateFromLocal(date, hhmm, tz) {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  return new Date(guess.getTime() - tzOffsetMinutes(guess, tz) * 60000);
}

/** Express 4 does not catch rejected promises: pass them to the error handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Whole number within [min, max]; anything else (NaN, Infinity, '1e400') becomes min. */
function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

function cleanEmployee(b) {
  const e = {
    name: String(b.name || '').trim().replace(/\s+/g, ' '),
    position: String(b.position || '').trim().slice(0, 100),
    phone: String(b.phone || '').trim().slice(0, 30),
    telegramChatId: String(b.telegramChatId || '').trim().slice(0, 20),
    scheduleId: b.scheduleId ? Number(b.scheduleId) : null,
    hourlyRate: clampInt(b.hourlyRate, 0, 100000000),
    active: b.active !== false,
  };
  if (!e.name) throw bad('Ismni kiriting');
  if (e.name.length > 100) throw bad('Ism juda uzun');
  if (e.telegramChatId && !/^-?\d+$/.test(e.telegramChatId)) throw bad('Telegram chat ID faqat raqam bo\'ladi');
  return e;
}

function cleanSchedule(b) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw bad('Jadval nomini kiriting');
  const days = {};
  for (let i = 0; i < 7; i += 1) {
    const d = b.days && b.days[String(i)];
    if (d && d.start && d.end) {
      const start = normHHMM(d.start);
      const end = normHHMM(d.end);
      if (!start || !end) throw bad('Vaqt noto\'g\'ri');
      if (end <= start) {
        throw bad('Ish tugash vaqti boshlanishidan keyin bo\'lishi kerak (tungi smena — yarim tundan o\'tadigan jadval hozircha qo\'llanmaydi)');
      }
      days[String(i)] = { start, end };
    } else days[String(i)] = null;
  }
  return { name, days };
}

function decodeImage(b64) {
  if (!b64) return null;
  const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw bad('Rasm JPEG formatida bo\'lishi kerak');
  if (buf.length > 400 * 1024) throw bad('Rasm juda katta (400 KB dan oshmasin)');
  return buf;
}

function createApi({ store, auth, cfg, sync, backup, version }) {
  const api = express.Router();
  // Small bodies before login; larger ones (face photos, Excel import) only for logged-in users.
  const smallJson = express.json({ limit: '32kb' });
  const bigJson = express.json({ limit: '5mb' });
  const tz = cfg.timezone;

  // ---------- session ----------
  api.get('/session', (req, res) => {
    res.json({ user: auth.currentUser(req), needsSetup: store.countUsers() === 0, setupAllowed: isLocalRequest(req) });
  });

  api.post('/setup', smallJson, (req, res) => {
    if (store.countUsers() > 0) throw new HttpError(409, 'Administrator allaqachon yaratilgan');
    if (!isLocalRequest(req)) throw new HttpError(403, 'Birinchi sozlash faqat server kompyuterining o\'zidan (localhost) qilinadi');
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[\w.@-]{3,40}$/.test(username)) throw bad('Login 3–40 belgi: harf, raqam, . _ - @');
    if (password.length < 6) throw bad('Parol kamida 6 belgi bo\'lsin');
    if (req.body.organizationName) store.saveSettings({ organizationName: String(req.body.organizationName).trim() });
    const id = store.createUser({ username, name: req.body.name || '', passwordHash: auth.hashPassword(password) });
    auth.startSession(res, { id });
    res.json({ ok: true });
  });

  api.post('/login', smallJson, wrap(async (req, res) => {
    const result = await auth.login(req, req.body.username, req.body.password);
    if (typeof result === 'string') throw new HttpError(401, result);
    auth.startSession(res, result);
    res.json({ user: result });
  }));

  api.post('/logout', (req, res) => {
    const user = auth.currentUser(req);
    if (user) store.bumpSessionVersion(user.id); // the old cookie stops working everywhere
    auth.endSession(res);
    res.json({ ok: true });
  });

  // Everything below needs a logged-in user.
  api.use((req, res, next) => auth.require(req, res, next));
  api.use(bigJson);

  // ---------- status & settings ----------
  api.get('/status', (req, res) => {
    res.json({
      version, ips: lanAddresses(), port: cfg.port, hostname: os.hostname(), timezone: tz,
      today: localDate(new Date(), tz), settings: store.settings, telegram: !!cfg.botToken,
    });
  });

  api.put('/settings', (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (b.lateGraceMinutes !== undefined) patch.lateGraceMinutes = clampInt(b.lateGraceMinutes, 0, 240);
    if (b.debounceSeconds !== undefined) patch.debounceSeconds = clampInt(b.debounceSeconds, 0, 3600);
    if (b.autoTimeSync !== undefined) patch.autoTimeSync = !!b.autoTimeSync;
    if (b.dailyReportEnabled !== undefined) patch.dailyReportEnabled = !!b.dailyReportEnabled;
    if (b.dailyReportTime !== undefined) {
      if (parseHHMM(b.dailyReportTime) == null) throw bad('Vaqt noto\'g\'ri');
      patch.dailyReportTime = b.dailyReportTime;
    }
    if (b.organizationName !== undefined) patch.organizationName = String(b.organizationName).trim().slice(0, 100);
    res.json(store.saveSettings(patch));
  });

  // ---------- dashboard ----------
  api.get('/today', (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : localDate(new Date(), tz);
    res.json({ date, rows: daySummary(store, date, tz), devices: [...store.devices.values()].map(publicDevice) });
  });

  // ---------- schedules ----------
  api.get('/schedules', (req, res) => {
    const counts = new Map();
    for (const e of store.employees.values()) if (!e.deleted) counts.set(e.scheduleId, (counts.get(e.scheduleId) || 0) + 1);
    const list = store.listSchedules();
    const firstId = list[0] && list[0].id;
    res.json(list.map((s) => ({ ...s, employees: (counts.get(s.id) || 0) + (s.id === firstId ? (counts.get(null) || 0) : 0) })));
  });
  api.post('/schedules', (req, res) => res.json({ id: store.saveSchedule(cleanSchedule(req.body)) }));
  api.put('/schedules/:id', (req, res) => {
    if (!store.getSchedule(Number(req.params.id))) throw new HttpError(404, 'Jadval topilmadi');
    store.saveSchedule({ ...cleanSchedule(req.body), id: Number(req.params.id) });
    res.json({ ok: true });
  });
  api.delete('/schedules/:id', (req, res) => { store.deleteSchedule(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- employees ----------
  api.get('/employees', (req, res) => {
    res.json([...store.employees.values()].filter((e) => !e.deleted));
  });

  api.post('/employees', (req, res) => {
    const id = store.createEmployee(cleanEmployee(req.body));
    if (req.body.image) store.setFace(id, decodeImage(req.body.image));
    res.json(store.getEmployee(id));
  });

  api.post('/employees/import', (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad('Ro\'yxat bo\'sh');
    if (rows.length > 2000) throw bad('Bir martada 2000 tadan ko\'p emas');
    const existing = new Set([...store.employees.values()].filter((e) => !e.deleted).map((e) => e.name.toLowerCase().replace(/\s+/g, ' ')));
    const toAdd = [];
    let skipped = 0;
    for (const r of rows) {
      let e;
      try { e = cleanEmployee({ ...r, scheduleId: r.scheduleId || req.body.scheduleId }); } catch { skipped += 1; continue; }
      const key = e.name.toLowerCase().replace(/\s+/g, ' ');
      if (existing.has(key)) { skipped += 1; continue; }
      existing.add(key);
      toAdd.push(e);
    }
    const ids = store.importEmployees(toAdd);
    res.json({ added: ids.length, skipped });
  });

  api.get('/employees/:id', (req, res) => {
    const e = store.getEmployee(Number(req.params.id));
    if (!e || e.deleted) throw new HttpError(404, 'Xodim topilmadi');
    res.json(e);
  });

  api.put('/employees/:id', (req, res) => {
    const id = Number(req.params.id);
    const e = store.getEmployee(id);
    if (!e || e.deleted) throw new HttpError(404, 'Xodim topilmadi');
    store.updateEmployee(id, cleanEmployee(req.body));
    res.json(store.getEmployee(id));
  });

  api.delete('/employees/:id', (req, res) => {
    store.deleteEmployee(Number(req.params.id));
    res.json({ ok: true });
  });

  api.get('/employees/:id/face.jpg', wrap(async (req, res) => {
    const img = await store.getFace(Number(req.params.id));
    if (!img) throw new HttpError(404, 'Rasm yo\'q');
    res.set('Cache-Control', 'no-cache').type('image/jpeg').send(img);
  }));

  api.put('/employees/:id/face', (req, res) => {
    const id = Number(req.params.id);
    const e = store.getEmployee(id);
    if (!e || e.deleted) throw new HttpError(404, 'Xodim topilmadi');
    store.setFace(id, decodeImage(req.body.image));
    res.json(store.getEmployee(id));
  });

  // ---------- devices ----------
  api.get('/devices', (req, res) => res.json([...store.devices.values()].map(publicDevice)));

  function cleanDevice(b, existing) {
    const d = {
      name: String(b.name || '').trim().slice(0, 60) || 'Terminal',
      ip: String(b.ip || '').trim(),
      port: Number(b.port) || 80,
      username: String(b.username || '').trim().slice(0, 32) || 'admin',
      password: b.password === undefined || b.password === '' ? null : String(b.password).slice(0, 64),
      direction: ['in', 'out', 'auto'].includes(b.direction) ? b.direction : 'in',
    };
    const parts = d.ip.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) {
      throw bad('IP manzil noto\'g\'ri (masalan 192.168.31.68)');
    }
    if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535) throw bad('Port noto\'g\'ri');
    if (d.password === null) {
      // Keep the saved password only for the same terminal address: never send it to a new address unasked.
      if (existing && existing.ip === d.ip && Number(existing.port) === d.port && existing.username === d.username) {
        d.password = existing.password;
      } else if (existing) {
        throw bad('Terminal manzili yoki logini o\'zgardi — parolni qayta kiriting');
      } else {
        d.password = '';
      }
    }
    return d;
  }

  api.post('/devices', (req, res) => res.json({ id: store.saveDevice(cleanDevice(req.body)) }));
  api.put('/devices/:id', (req, res) => {
    const existing = store.getDevice(req.params.id);
    if (!existing) throw new HttpError(404, 'Terminal topilmadi');
    store.saveDevice({ ...cleanDevice(req.body, existing), id: existing.id });
    res.json({ ok: true });
  });
  api.delete('/devices/:id', (req, res) => { store.deleteDevice(req.params.id); res.json({ ok: true }); });
  api.post('/devices/:id/resync', (req, res) => {
    if (!store.getDevice(req.params.id)) throw new HttpError(404, 'Terminal topilmadi');
    store.requestResync(req.params.id);
    sync.schedule();
    res.json({ ok: true });
  });

  // ---------- attendance ----------
  api.get('/report', (req, res) => {
    const today = localDate(new Date(), tz);
    const from = isDate(req.query.from) ? req.query.from : `${today.slice(0, 8)}01`;
    const to = isDate(req.query.to) ? req.query.to : today;
    if (from > to) throw bad('Sana oralig\'i noto\'g\'ri');
    res.json({ from, to, ...periodSummary(store, from, to, tz) });
  });

  /** Manual add / edit of a day's record ({ employeeId, date, checkIn: "HH:MM"|"" , checkOut }). */
  api.put('/attendance', wrap(async (req, res) => {
    const { employeeId, date } = req.body;
    const emp = store.getEmployee(Number(employeeId));
    if (!emp || emp.deleted) throw bad('Xodimni tanlang');
    if (!isDate(date)) throw bad('Sana noto\'g\'ri');
    if (date > localDate(new Date(), tz)) throw bad('Kelajakdagi sana uchun davomat kiritib bo\'lmaydi');
    const inT = req.body.checkIn ? normHHMM(req.body.checkIn) : '';
    const outT = req.body.checkOut ? normHHMM(req.body.checkOut) : '';
    if (inT === null || outT === null) throw bad('Vaqt noto\'g\'ri');
    if (!inT && !outT) throw bad('Kamida bitta vaqtni kiriting');
    const existing = await store.getAttendance(emp.id, date);
    const hours = existing ? { start: existing.workStart, end: existing.workEnd } : store.getWorkHoursSync(emp, date);
    const rec = computeStats({
      ...(existing || {}),
      employeeId: emp.id, date, employeeNo: emp.employeeNo, employeeName: emp.name,
      workStart: hours ? hours.start : null, workEnd: hours ? hours.end : null,
      hourlyRate: existing ? existing.hourlyRate : emp.hourlyRate,
      checkIn: inT ? dateFromLocal(date, inT, tz) : null,
      checkOut: outT ? dateFromLocal(date, outT, tz) : null,
      ...(inT ? {} : { checkInDeviceId: null, checkInDeviceName: null }),
      ...(outT ? {} : { checkOutDeviceId: null, checkOutDeviceName: null }),
      manual: true,
    }, store.settings, tz);
    if (rec.checkIn && rec.checkOut && rec.checkOut <= rec.checkIn) throw bad('Ketish vaqti kelishdan keyin bo\'lishi kerak');
    res.json(await store.saveAttendance(rec));
  }));

  api.delete('/attendance/:id', (req, res) => { store.deleteAttendance(Number(req.params.id)); res.json({ ok: true }); });

  // ---------- events ----------
  api.get('/events', (req, res) => res.json(store.listEvents(Math.min(500, Number(req.query.limit) || 150))));

  // ---------- users ----------
  api.get('/users', (req, res) => res.json(store.listUsers()));
  api.post('/users', (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!/^[\w.@-]{3,40}$/.test(username)) throw bad('Login 3–40 belgi: harf, raqam, . _ - @');
    if (password.length < 6) throw bad('Parol kamida 6 belgi bo\'lsin');
    if (store.getUserByName(username)) throw bad('Bunday login bor');
    res.json({ id: store.createUser({ username, name: req.body.name || '', passwordHash: auth.hashPassword(password) }) });
  });
  api.put('/users/:id/password', (req, res) => {
    const password = String(req.body.password || '');
    if (password.length < 6) throw bad('Parol kamida 6 belgi bo\'lsin');
    store.setUserPassword(Number(req.params.id), auth.hashPassword(password));
    res.json({ ok: true });
  });
  api.delete('/users/:id', (req, res) => {
    if (Number(req.params.id) === req.user.id) throw bad('O\'zingizni o\'chira olmaysiz');
    store.deleteUser(Number(req.params.id));
    res.json({ ok: true });
  });

  // ---------- backup ----------
  api.get('/backup', (req, res) => {
    const file = backup.snapshot(path.join(os.tmpdir(), `davomat-${Date.now()}.db`));
    res.download(file, `davomat-${localDate(new Date(), tz)}-${localTime(new Date(), tz).replace(':', '')}.db`, () => {
      fs.rm(file, () => {});
    });
  });

  // ---------- errors ----------
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error('API xato:', err);
    let message = err.message;
    if (status === 413) message = 'Yuborilgan ma\'lumot juda katta';
    else if (status === 400 && err.type === 'entity.parse.failed') message = 'Noto\'g\'ri so\'rov';
    else if (status >= 500) message = 'Serverda xato yuz berdi. Qora oynadagi xabarni tekshiring.';
    res.status(status).json({ error: message });
  });

  return api;
}

function publicDevice(d) {
  const { password, ...rest } = d;
  return { ...rest, hasPassword: !!password };
}

module.exports = { createApi, dateFromLocal };
