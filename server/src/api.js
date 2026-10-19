'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { isLocalRequest } = require('./auth');
const { localDate, localTime, parseHHMM, tzOffsetMinutes } = require('./time');
const { computeStats, salaryFor } = require('./attendance');
const { daySummary, periodSummary } = require('./summary');
const { lanAddresses } = require('./net');
const { explainError } = require('./isapi');

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

/** Name key for duplicate checks: case, spaces and the many Uzbek apostrophe forms do not matter. */
function nameKey(name) {
  return String(name || '').toLowerCase().replace(/[‘’ʻʼ`´'‛ʹ′]/g, "'").replace(/\s+/g, ' ').trim();
}

/** Duplicate check key: same name is fine for two students of different classes. */
const personKey = (e) => `${nameKey(e.name)}|${e.kind === 'student' ? e.className : ''}`;

/** Whole number within [min, max]; anything else (NaN, Infinity, '1e400') becomes min. */
function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/**
 * Class name in one form: "9 a", "9a", "9-а" (Cyrillic) -> "9-A"; anything else is kept, trimmed and upper-cased.
 */
function normClass(v) {
  let t = String(v || '').trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 20);
  const CYR = { А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ж: 'J', З: 'Z', С: 'S' };
  const m = /^(\d{1,2})\s*[-–—]?\s*["'«]?([A-ZА-ЯЁЎҚҒҲ]{1,2})["'»]?\s*(SINF|КЛАСС|КЛ\.?)?$/u.exec(t);
  if (m) t = `${m[1]}-${[...m[2]].map((c) => CYR[c] || c).join('')}`;
  return t;
}

function cleanEmployee(b) {
  const student = b.kind === 'student';
  const e = {
    kind: student ? 'student' : 'staff',
    className: student ? normClass(b.className) : '',
    name: String(b.name || '').trim().replace(/\s+/g, ' '),
    position: String(b.position || '').trim().slice(0, 100),
    phone: String(b.phone || '').trim().slice(0, 30),
    telegramChatId: String(b.telegramChatId || '').trim().slice(0, 20),
    scheduleId: b.scheduleId ? Number(b.scheduleId) : null,
    personalSchedule: b.personalSchedule ? cleanScheduleBody(b.personalSchedule) : null,
    accessProfileId: b.accessProfileId ? Number(b.accessProfileId) : null,
    payType: ['hourly', 'daily', 'session'].includes(b.payType) ? b.payType : 'hourly',
    payRate: clampInt(b.payRate ?? b.hourlyRate, 0, 100000000), // hourlyRate: older clients
    active: b.active !== false,
  };
  if (!e.name) throw bad('Ismni kiriting');
  if (student) {
    if (!e.className) throw bad('Sinfni kiriting (masalan 9-A)');
    // pay and personal Telegram are for staff; parents are connected through their child's code
    Object.assign(e, { payType: 'hourly', payRate: 0, telegramChatId: '', position: '' });
  }
  if (e.name.length > 100) throw bad('Ism juda uzun');
  if (e.telegramChatId && !/^-?\d+$/.test(e.telegramChatId)) throw bad('Telegram chat ID faqat raqam bo\'ladi');
  return e;
}

function cleanSchedule(b) {
  const name = String(b.name || '').trim().slice(0, 60);
  if (!name) throw bad('Jadval nomini kiriting');
  return { name, ...cleanScheduleBody(b) };
}

/** Type + week. A flexible schedule keeps its days only so that switching back restores them. */
function cleanScheduleBody(b) {
  const type = b.type === 'flexible' ? 'flexible' : 'fixed';
  return { type, days: cleanDays(b.days, type === 'flexible') };
}

/** Week of work hours: {"0": null | {start, end}, ...}, 0 = Sunday. */
function cleanDays(src, lenient = false) {
  const days = {};
  for (let i = 0; i < 7; i += 1) {
    const d = src && src[String(i)];
    if (d && d.start && d.end) {
      const start = normHHMM(d.start);
      const end = normHHMM(d.end);
      if (lenient && (!start || !end || end <= start)) { days[String(i)] = null; continue; }
      if (!start || !end) throw bad('Vaqt noto\'g\'ri');
      if (end <= start) {
        throw bad('Ish tugash vaqti boshlanishidan keyin bo\'lishi kerak (tungi smena — yarim tundan o\'tadigan jadval hozircha qo\'llanmaydi)');
      }
      days[String(i)] = { start, end };
    } else days[String(i)] = null;
  }
  return days;
}

function decodeImage(b64) {
  if (!b64) return null;
  const buf = Buffer.from(String(b64).replace(/^data:image\/\w+;base64,/, ''), 'base64');
  if (buf.length < 1000 || buf[0] !== 0xff || buf[1] !== 0xd8) throw bad('Rasm JPEG formatida bo\'lishi kerak');
  if (buf.length > 200 * 1024) throw bad('Rasm juda katta (200 KB dan oshmasin) — sahifani yangilab, qayta yuklang');
  return buf;
}

function createApi({ store, auth, cfg, sync, backup, clientFor, version }) {
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
    if (password.trim().length < 6) throw bad('Parol kamida 6 belgi bo\'lsin (bo\'sh joylardan iborat bo\'lmasin)');
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
      publicUrl: cfg.publicUrl || '', adminTelegramIds: cfg.adminTelegramIds || [],
    });
  });

  api.put('/settings', (req, res) => {
    const b = req.body || {};
    const patch = {};
    const given = (v) => v !== undefined && v !== null && String(v).trim() !== '';
    if (given(b.lateGraceMinutes)) patch.lateGraceMinutes = clampInt(b.lateGraceMinutes, 0, 240);
    // at least 10 s: one scan delivered twice (push + terminal log) must never count as in + out
    if (given(b.debounceSeconds)) patch.debounceSeconds = clampInt(b.debounceSeconds, 10, 3600);
    if (b.autoTimeSync !== undefined) patch.autoTimeSync = !!b.autoTimeSync;
    if (b.dailyReportEnabled !== undefined) patch.dailyReportEnabled = !!b.dailyReportEnabled;
    if (b.dailyReportTime !== undefined) {
      if (parseHHMM(b.dailyReportTime) == null) throw bad('Vaqt noto\'g\'ri');
      patch.dailyReportTime = b.dailyReportTime;
    }
    if (b.organizationName !== undefined) patch.organizationName = String(b.organizationName).trim().slice(0, 100);
    if (b.telegramViewers !== undefined) {
      if (!Array.isArray(b.telegramViewers) || b.telegramViewers.length > 50) throw bad('Ro\'yxat noto\'g\'ri');
      const seen = new Set();
      patch.telegramViewers = b.telegramViewers.map((v) => {
        const id = String((v && v.id) || '').trim();
        if (!/^\d{3,15}$/.test(id)) throw bad(`Telegram ID faqat raqam bo'ladi: "${id}"`);
        if (seen.has(id)) throw bad(`Bu ID ikki marta yozilgan: ${id}`);
        seen.add(id);
        return { id, name: String((v && v.name) || '').trim().slice(0, 60) };
      });
    }
    res.json(store.saveSettings(patch));
  });

  // ---------- dashboard ----------
  api.get('/today', (req, res) => {
    const date = isDate(req.query.date) ? req.query.date : localDate(new Date(), tz);
    const rows = daySummary(store, date, tz).map((r) => ({ ...r, attendance: publicRecord(r.attendance) }));
    res.json({ date, rows, devices: [...store.devices.values()].map(publicDevice) });
  });

  // ---------- schedules ----------
  api.get('/schedules', (req, res) => {
    const counts = new Map();
    for (const e of store.employees.values()) if (!e.deleted && !e.personalSchedule) counts.set(e.scheduleId, (counts.get(e.scheduleId) || 0) + 1);
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

  // ---------- door entry schedules ----------
  api.get('/access-profiles', (req, res) => {
    const counts = new Map();
    for (const e of store.employees.values()) if (!e.deleted && e.accessProfileId) counts.set(e.accessProfileId, (counts.get(e.accessProfileId) || 0) + 1);
    res.json(store.listAccessProfiles().map((p) => ({ ...p, employees: counts.get(p.id) || 0 })));
  });
  function cleanAccessProfile(b) {
    const name = String(b.name || '').trim().slice(0, 60);
    if (!name) throw bad('Nomini kiriting');
    const days = cleanDays(b.days);
    if (!Object.values(days).some(Boolean)) throw bad('Kamida bitta kunni belgilang');
    return { name, days };
  }
  api.post('/access-profiles', (req, res) => {
    const id = store.saveAccessProfile(cleanAccessProfile(req.body));
    sync.schedule();
    res.json({ id });
  });
  api.put('/access-profiles/:id', (req, res) => {
    if (!store.getAccessProfile(req.params.id)) throw new HttpError(404, 'Ruxsat jadvali topilmadi');
    store.saveAccessProfile({ ...cleanAccessProfile(req.body), id: Number(req.params.id) });
    sync.schedule();
    res.json({ ok: true });
  });
  api.delete('/access-profiles/:id', (req, res) => {
    store.deleteAccessProfile(Number(req.params.id));
    sync.schedule();
    res.json({ ok: true });
  });
  const checkAccessProfile = (e) => {
    if (e.accessProfileId && !store.getAccessProfile(e.accessProfileId)) throw bad('Kirish ruxsati jadvali topilmadi');
    return e;
  };

  // ---------- employees ----------
  api.get('/employees', (req, res) => {
    res.json([...store.employees.values()].filter((e) => !e.deleted));
  });

  api.post('/employees', (req, res) => {
    const e = checkAccessProfile(cleanEmployee(req.body));
    if (!req.body.allowDuplicate && [...store.employees.values()].some((x) => !x.deleted && personKey(x) === personKey(e))) {
      return res.status(409).json({ error: `"${e.name}"${e.kind === 'student' ? ` (${e.className})` : ''} allaqachon bor`, duplicate: true });
    }
    const id = store.createEmployee(e);
    if (req.body.image) store.setFace(id, decodeImage(req.body.image));
    res.json(store.getEmployee(id));
  });

  api.post('/employees/import', (req, res) => {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (!rows.length) throw bad('Ro\'yxat bo\'sh');
    if (rows.length > 2000) throw bad('Bir martada 2000 tadan ko\'p emas');
    const existing = new Set([...store.employees.values()].filter((e) => !e.deleted).map(personKey));
    const toAdd = [];
    let skipped = 0;
    for (const r of rows) {
      let e;
      try {
        e = cleanEmployee({
          ...r, kind: req.body.kind, className: r.className || req.body.className, scheduleId: r.scheduleId || req.body.scheduleId,
        });
      } catch { skipped += 1; continue; }
      const key = personKey(e);
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
    store.updateEmployee(id, checkAccessProfile(cleanEmployee(req.body)));
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

  function assertUniqueAddress(d, id) {
    const other = [...store.devices.values()].find((x) => x.id !== id && x.ip === d.ip && Number(x.port) === Number(d.port));
    if (other) throw bad(`Bu manzil (${d.ip}) allaqachon "${other.name}" terminaliga berilgan`);
  }
  api.post('/devices', (req, res) => {
    const d = cleanDevice(req.body);
    assertUniqueAddress(d, null);
    res.json({ id: store.saveDevice(d) });
  });
  api.put('/devices/:id', (req, res) => {
    const existing = store.getDevice(req.params.id);
    if (!existing) throw new HttpError(404, 'Terminal topilmadi');
    const d = cleanDevice(req.body, existing);
    assertUniqueAddress(d, existing.id);
    store.saveDevice({ ...d, id: existing.id });
    // entry schedules apply to entrance terminals only: a changed direction means re-sending everyone
    if (d.direction !== existing.direction && store.listAccessProfiles().length) store.requestResync(existing.id);
    res.json({ ok: true });
  });

  /** Door control from the web app: open once, keep open, back to normal. Logged in "Eventlar". */
  const DOOR = { open: 'door_open', alwaysOpen: 'door_always_open', close: 'door_normal' };
  api.post('/devices/:id/door', wrap(async (req, res) => {
    const dev = store.getDevice(req.params.id);
    if (!dev) throw new HttpError(404, 'Terminal topilmadi');
    const cmd = req.body.cmd;
    if (!DOOR[cmd]) throw bad('Noma\'lum buyruq');
    try {
      await clientFor(dev).remoteDoor(cmd);
    } catch (err) {
      throw new HttpError(502, `Terminal buyruqni bajarmadi: ${explainError(err)}`);
    }
    await store.updateDevice(dev.id, { doorMode: cmd === 'alwaysOpen' ? 'alwaysOpen' : 'normal' });
    const who = req.user.name || req.user.username;
    await store.saveEvent(`door_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, {
      deviceId: dev.id, deviceName: dev.name, time: new Date(), personName: who, action: DOOR[cmd],
    });
    console.log(`🚪 ${dev.name}: ${cmd === 'open' ? 'eshik ochildi' : cmd === 'alwaysOpen' ? 'eshik doimiy ochiq' : 'eshik odatiy holatda'} (${who})`);
    res.json({ ok: true });
  }));
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
    const { records, summary } = periodSummary(store, from, to, tz);
    res.json({ from, to, records: records.map(publicRecord), summary });
  });

  /**
   * Manual add / edit of a day's record.
   *   { employeeId, date, sessions: [{ in: "HH:MM"|"", out: "HH:MM"|"" }, ...], replace }
   *   replace: true  — the day becomes exactly these sessions (editing a shown record)
   *   replace: false — the times are added to what the terminals recorded ("Qo'lda qo'shish": a forgotten scan)
   * Older clients send { checkIn, checkOut } instead of `sessions`: one session.
   */
  api.put('/attendance', wrap(async (req, res) => {
    const { employeeId, date } = req.body;
    const emp = store.getEmployee(Number(employeeId));
    if (!emp || emp.deleted) throw bad('Xodimni tanlang');
    if (!isDate(date)) throw bad('Sana noto\'g\'ri');
    if (date > localDate(new Date(), tz)) throw bad('Kelajakdagi sana uchun davomat kiritib bo\'lmaydi');
    const replace = !!req.body.replace;
    const given = Array.isArray(req.body.sessions) ? req.body.sessions : [{ in: req.body.checkIn, out: req.body.checkOut }];
    if (given.length > 30) throw bad('Juda ko\'p qator');
    const rows = given.map((r) => {
      const row = { in: r && r.in ? normHHMM(r.in) : '', out: r && r.out ? normHHMM(r.out) : '' };
      if (row.in === null || row.out === null) throw bad('Vaqt noto\'g\'ri');
      if (row.in && row.out && row.out <= row.in) throw bad(`Ketish vaqti kelishdan keyin bo'lishi kerak (${row.in} – ${row.out})`);
      return row;
    }).filter((r) => r.in || r.out);
    if (!rows.length) throw bad(replace ? 'Kamida bitta vaqtni kiriting (yozuvni butunlay olib tashlash uchun "O\'chirish" ni bosing)' : 'Kamida bitta vaqtni kiriting');

    const existing = await store.getAttendance(emp.id, date);
    const old = existing ? existing.punches : [];
    const sameMinute = (p, hhmm) => localTime(p.time, tz) === hhmm;
    const manualPunch = (hhmm, dir) => ({ time: dateFromLocal(date, hhmm, tz), dir, deviceId: null, deviceName: null, manual: true });
    let punches;
    if (replace) {
      rows.sort((a, b) => (a.in || a.out).localeCompare(b.in || b.out));
      for (let i = 1; i < rows.length; i += 1) {
        const prevEnd = rows[i - 1].out || rows[i - 1].in;
        const nextStart = rows[i].in || rows[i].out;
        if (nextStart <= prevEnd) throw bad(`Vaqtlar ustma-ust tushmoqda (${prevEnd} va ${nextStart}) — har bir kelib-ketish oldingisidan keyin bo'lsin`);
      }
      // An unchanged time keeps the terminal's original scan (exact seconds, terminal name).
      const keep = (hhmm, dir) => {
        const o = old.find((p) => sameMinute(p, hhmm) && (p.dir === dir || p.dir === 'auto'));
        return o ? { ...o, dir } : manualPunch(hhmm, dir);
      };
      punches = rows.flatMap((r) => [r.in && keep(r.in, 'in'), r.out && keep(r.out, 'out')].filter(Boolean));
    } else {
      const added = rows.flatMap((r) => [r.in && manualPunch(r.in, 'in'), r.out && manualPunch(r.out, 'out')].filter(Boolean))
        .filter((p) => !old.some((o) => sameMinute(o, localTime(p.time, tz))));
      if (!added.length) throw bad('Bu vaqtlar allaqachon yozilgan');
      punches = [...old, ...added];
    }

    const hours = existing ? { start: existing.workStart, end: existing.workEnd } : store.getWorkHoursSync(emp, date);
    const rec = computeStats({
      ...(existing || {}),
      employeeId: emp.id, date, employeeNo: emp.employeeNo, employeeName: emp.name,
      workStart: hours ? hours.start : null, workEnd: hours ? hours.end : null,
      payType: existing ? existing.payType : emp.payType,
      payRate: existing ? existing.payRate : emp.payRate,
      punches,
      manual: true,
    }, store.settings, tz);
    // "08:00–" followed by "–12:00" would silently become one session: ask for one row instead.
    if (replace && rec.sessions.length !== rows.length) {
      throw bad('Faqat "keldi" yozilgan qatordan keyin faqat "ketdi" yozilgan qator kelmasin — ularni bitta qatorga yozing');
    }
    res.json(publicRecord(await store.saveAttendance(rec)));
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
    const ours = err instanceof HttpError; // messages written for the user (e.g. "terminal did not respond")
    if (status >= 500 && !ours) console.error('API xato:', err);
    let message = err.message;
    if (status === 413) message = 'Yuborilgan ma\'lumot juda katta';
    else if (status === 400 && err.type === 'entity.parse.failed') message = 'Noto\'g\'ri so\'rov';
    else if (status >= 500 && !ours) message = 'Serverda xato yuz berdi. Qora oynadagi xabarni tekshiring.';
    res.status(status).json({ error: message });
  });

  return api;
}

/** Attendance record without the raw scan list (sessions carry the same information), with the day's pay. */
function publicRecord(r) {
  if (!r) return r;
  const { punches, ...rest } = r;
  return { ...rest, pay: salaryFor(r) };
}

function publicDevice(d) {
  const { password, ...rest } = d;
  return { ...rest, hasPassword: !!password };
}

module.exports = { createApi, dateFromLocal, nameKey, normClass };
