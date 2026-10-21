'use strict';
/**
 * Edume CRM integration.
 *   - every 10 min: the centre's students and groups come from Edume (students here are kept in step:
 *     name, group as "class", the group's lesson days/times as the personal schedule, archived -> inactive)
 *   - a face scan during a lesson -> Edume attendance for that group and day: present / late
 *   - after a lesson ends (+N min): students with a face here and no mark -> absent
 *   - arrival / departure messages to the parent through the centre's own Edume Telegram bot
 * Teachers can still change any mark in Edume; a scan never overwrites "present"/"late" already there.
 */
const { EdumeClient, parseConnectionCode } = require('./edume');
const { createTelegram } = require('./telegram');
const { parentMessage } = require('./parents');
const { localDate, localMinutes, parseHHMM } = require('./time');
const { weekdayOf } = require('./store');

const SYNC_MS = 10 * 60 * 1000;
const ABSENT_CHECK_MS = 2 * 60 * 1000;
const NOTIFY_MAX_AGE_MS = 15 * 60 * 1000;
const EARLY_ARRIVAL_MIN = 90; // a scan up to 1.5 h before the lesson counts for it

function hhmm(v) {
  const m = parseHHMM(v);
  return m == null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Edume group -> { id, name, days: Set<0..6>, start, end } (start/end "HH:MM" or null) */
function mapGroup(g) {
  const s = g.schedule || {};
  const days = new Set((Array.isArray(s.scheduleDays) ? s.scheduleDays : []).map(Number).filter((d) => d >= 0 && d <= 6));
  let start = hhmm(s.startTime);
  let end = hhmm(s.endTime);
  if (!start || !end || end <= start) { start = null; end = null; }
  return { id: g.id, name: String(g.name || '').trim() || 'Guruh', days, start, end, active: g.status !== 'archived' };
}

class CrmIntegration {
  constructor({ store, tz, log = console, clientFactory, telegramFactory, now = () => new Date() }) {
    this.store = store;
    this.tz = tz;
    this.log = log;
    this.clientFactory = clientFactory || ((cfg) => new EdumeClient(cfg));
    this.telegramFactory = telegramFactory || ((token) => createTelegram({ token }));
    this.now = now;
    this.groups = new Map();
    this.students = new Map(); // Edume student id -> { id, fullName, groupId, parentTelegramChatId }
    this.botToken = '';
    this.state = { lastSync: null, lastError: '', syncing: false };
    this.queue = Promise.resolve();
    this.clientKey = '';
    this.timers = [];
  }

  config() { return this.store.settings.crm || null; }

  client() {
    const c = this.config();
    if (!c) return null;
    const key = [c.apiKey, c.projectId, c.email, c.password].join('|');
    if (key !== this.clientKey) { this._client = this.clientFactory(c); this.clientKey = key; }
    return this._client;
  }

  /** Runs CRM writes one at a time (scans and the absent check never race for the same mark). */
  serial(fn) {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }

  // ---------- connect ----------
  async connect(code) {
    const cfg = parseConnectionCode(code);
    const client = this.clientFactory(cfg);
    const session = await client.signIn();
    const me = await client.getDoc(`users/${session.uid}`);
    if (!me || me.role !== 'device') throw Object.assign(new Error('Bu akkaunt Edume qurilma akkaunti emas — Edume sozlamalarida "Face ID qurilmasi" yarating'), { status: 400 });
    if (!me.centerId) throw Object.assign(new Error('Qurilma akkauntida markaz ko\'rsatilmagan'), { status: 400 });
    const center = await client.getDoc(`centers/${me.centerId}`).catch(() => null);
    const old = this.config();
    // another centre: people linked to the old one become ordinary local students
    if (old && old.centerId && old.centerId !== me.centerId) this.store.q('UPDATE employees SET external_id = NULL').run();
    this.store.saveSettings({
      crm: {
        apiKey: cfg.apiKey, projectId: cfg.projectId, email: cfg.email, password: cfg.password,
        centerId: me.centerId, centerName: (center && center.name) || cfg.centerName || '',
        autoAbsent: old ? old.autoAbsent !== false : true,
        parentMessages: old ? old.parentMessages !== false : true,
        absentAfterMinutes: old ? Number(old.absentAfterMinutes) || 15 : 15,
      },
      crmAbsentDone: {},
    });
    this.clientKey = '';
    await this.sync();
    return this.status();
  }

  disconnect() {
    this.store.saveSettings({ crm: null, crmAbsentDone: {} });
    this.groups.clear();
    this.students.clear();
    this.botToken = '';
    this.state = { lastSync: null, lastError: '', syncing: false };
  }

  setOptions(o) {
    const c = this.config();
    if (!c) return;
    const next = { ...c };
    if (o.autoAbsent !== undefined) next.autoAbsent = !!o.autoAbsent;
    if (o.parentMessages !== undefined) next.parentMessages = !!o.parentMessages;
    if (o.absentAfterMinutes !== undefined) next.absentAfterMinutes = Math.min(240, Math.max(0, Math.round(Number(o.absentAfterMinutes) || 0)));
    this.store.saveSettings({ crm: next });
  }

  status() {
    const c = this.config();
    if (!c) return { connected: false };
    const linked = [...this.store.employees.values()].filter((e) => e.externalId && !e.deleted && e.active);
    return {
      connected: true, centerName: c.centerName, centerId: c.centerId, email: c.email,
      autoAbsent: c.autoAbsent !== false, parentMessages: c.parentMessages !== false, absentAfterMinutes: Number(c.absentAfterMinutes) || 15,
      lastSync: this.state.lastSync, lastError: this.state.lastError, syncing: this.state.syncing,
      groups: this.groups.size, students: linked.length, withFace: linked.filter((e) => e.hasFace).length,
      parentBot: !!this.botToken,
    };
  }

  // ---------- sync ----------
  async sync() {
    const c = this.config();
    const client = this.client();
    if (!c || !client) return null;
    this.state.syncing = true;
    try {
      const base = `centers/${c.centerId}`;
      const [groups, students, settings] = await Promise.all([
        client.listAll(`${base}/groups`), client.listAll(`${base}/students`), client.getDoc(`${base}/settings/main`).catch(() => null),
      ]);
      this.groups = new Map(groups.map((g) => [g.id, mapGroup(g)]));
      this.botToken = (settings && settings.telegramBotToken) || '';
      const active = students.filter((s) => (s.status || 'active') === 'active' && String(s.fullName || '').trim());
      this.students = new Map(active.map((s) => [s.id, {
        id: s.id, fullName: String(s.fullName).trim().replace(/\s+/g, ' ').slice(0, 100), groupId: s.groupId || '',
        parentTelegramChatId: s.parentTelegramChatId ? String(s.parentTelegramChatId) : '',
      }]));
      const changes = this.applyStudents();
      this.state.lastSync = new Date().toISOString();
      if (this.state.lastError) this.log.log('✅ Edume bilan aloqa tiklandi');
      this.state.lastError = '';
      if (changes.added || changes.updated || changes.removed) {
        this.log.log(`🔄 Edume: ${changes.added} yangi, ${changes.updated} o'zgargan, ${changes.removed} chiqarilgan o'quvchi`);
      }
      return changes;
    } catch (err) {
      if (err.message !== this.state.lastError) this.log.warn(`⚠️  Edume: ${err.message}`);
      this.state.lastError = err.message;
      throw err;
    } finally {
      this.state.syncing = false;
    }
  }

  /** Brings the local students in line with Edume. */
  applyStudents() {
    const { store } = this;
    const res = { added: 0, updated: 0, removed: 0 };
    const wantedFor = (s) => {
      const g = this.groups.get(s.groupId);
      let personalSchedule = { type: 'flexible', days: {} };
      if (g && g.start && g.days.size) {
        const days = {};
        for (let d = 0; d < 7; d += 1) days[String(d)] = g.days.has(d) ? { start: g.start, end: g.end } : null;
        personalSchedule = { type: 'fixed', days };
      }
      return { kind: 'student', name: s.fullName, className: g ? g.name.slice(0, 20) : 'Guruhsiz', personalSchedule };
    };
    const toAdd = [];
    for (const s of this.students.values()) {
      const want = wantedFor(s);
      const local = store.findByExternalId(s.id);
      if (!local) { toAdd.push({ s, want }); continue; }
      const same = local.name === want.name && local.className === want.className && local.active
        && JSON.stringify(local.personalSchedule) === JSON.stringify(want.personalSchedule);
      if (!same) {
        store.updateEmployee(local.id, { ...local, ...want, scheduleId: null, active: true });
        res.updated += 1;
      }
    }
    if (toAdd.length) {
      const ids = store.importEmployees(toAdd.map(({ want }) => ({ ...want, active: true })));
      ids.forEach((id, i) => store.setExternalId(id, toAdd[i].s.id));
      store.reloadEmployees();
      res.added = toAdd.length;
    }
    for (const e of [...store.employees.values()]) {
      if (e.externalId && !e.deleted && e.active && !this.students.has(e.externalId)) {
        store.updateEmployee(e.id, { ...e, active: false }); // removed from the terminals, history kept
        res.removed += 1;
      }
    }
    return res;
  }

  /** The lesson of this student's group on this local date, or null. */
  lessonFor(externalId, date) {
    const s = this.students.get(externalId);
    const g = s && this.groups.get(s.groupId);
    if (!g || !g.start || !g.days.has(weekdayOf(date))) return null;
    return { group: g, student: s, start: parseHHMM(g.start), end: parseHHMM(g.end) };
  }

  // ---------- scans ----------
  /** Called for every processed scan. Never throws. */
  async onScan(result) {
    try {
      const c = this.config();
      const emp = result && result.employee;
      if (!c || !emp || !emp.externalId || !this.students.size) return;
      if (result.action === 'checkin') await this.serial(() => this.markArrival(emp, result.time, result));
      if ((result.action === 'checkin' || result.action === 'checkout') && c.parentMessages !== false) await this.notifyParent(emp, result);
    } catch (err) {
      this.log.warn(`⚠️  Edume davomat: ${err.message}`);
    }
  }

  async markArrival(emp, time, result) {
    const c = this.config();
    const date = localDate(time, this.tz);
    const lesson = this.lessonFor(emp.externalId, date);
    if (!lesson) return null;
    const m = localMinutes(time, this.tz);
    if (m < lesson.start - EARLY_ARRIVAL_MIN || m > lesson.end) return null; // not this lesson
    const grace = Number(this.store.settings.lateGraceMinutes) || 0;
    const status = m > lesson.start + grace ? 'late' : 'present';
    const checkInTime = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const base = `centers/${c.centerId}`;
    const client = this.client();
    const found = await client.query(base, 'attendance', { groupId: lesson.group.id, date, studentId: emp.externalId });
    const existing = found[0];
    if (existing && (existing.status === 'present' || existing.status === 'late')) return existing.status; // already marked
    if (existing) {
      await client.update(`${base}/attendance/${existing.id}`, { status, checkInTime, source: 'faceid', updatedAt: new Date() });
    } else {
      await client.create(`${base}/attendance`, {
        groupId: lesson.group.id, date, studentId: emp.externalId, studentName: lesson.student.fullName,
        status, checkInTime, source: 'faceid', createdAt: new Date(),
      });
    }
    if (result) result.crmStatus = status;
    return status;
  }

  async notifyParent(emp, result) {
    const s = this.students.get(emp.externalId);
    if (!s || !s.parentTelegramChatId || !this.botToken) return;
    if (!result.time || Math.abs(this.now().getTime() - result.time.getTime()) > NOTIFY_MAX_AGE_MS) return;
    if (!this.telegram || this.telegramToken !== this.botToken) {
      this.telegram = this.telegramFactory(this.botToken);
      this.telegramToken = this.botToken;
    }
    await this.telegram.send(s.parentTelegramChatId, parentMessage({ name: s.fullName, className: emp.className }, result, this.tz))
      .catch((err) => this.log.warn(`⚠️  Edume bot (ota-ona): ${err.message}`));
  }

  // ---------- absent ----------
  /** Marks absentees of today's finished lessons. Returns how many were marked. */
  async checkAbsent() {
    const c = this.config();
    if (!c || c.autoAbsent === false || !this.students.size) return 0;
    const now = this.now();
    const today = localDate(now, this.tz);
    const nowMin = localMinutes(now, this.tz);
    const after = Number(c.absentAfterMinutes) || 15;
    const prev = this.store.settings.crmAbsentDone || {};
    const done = new Set(prev.date === today ? prev.groups || [] : []);

    // If nobody linked to Edume was scanned today the terminals (or this PC) were not working:
    // marking everybody absent would be wrong.
    const scannedToday = this.store.listAttendance(today, today)
      .some((r) => { const e = this.store.employees.get(r.employeeId); return e && e.externalId; });
    if (!scannedToday) return 0;

    let marked = 0;
    for (const g of this.groups.values()) {
      if (done.has(g.id) || !g.start || !g.days.has(weekdayOf(today))) continue;
      if (nowMin < parseHHMM(g.end) + after) continue;
      // eslint-disable-next-line no-await-in-loop
      marked += await this.serial(() => this.markGroupAbsent(g, today));
      done.add(g.id);
      this.store.saveSettings({ crmAbsentDone: { date: today, groups: [...done] } });
    }
    if (marked) this.log.log(`📝 Edume: ${marked} o'quvchiga "kelmadi" belgisi qo'yildi`);
    return marked;
  }

  async markGroupAbsent(g, date) {
    const c = this.config();
    const base = `centers/${c.centerId}`;
    const client = this.client();
    const members = [...this.students.values()].filter((s) => s.groupId === g.id);
    // only students who can be recognised: no face here = the teacher marks them
    const withFace = members.filter((s) => { const e = this.store.findByExternalId(s.id); return e && e.active && e.hasFace; });
    if (!withFace.length) return 0;
    const marks = await client.query(base, 'attendance', { groupId: g.id, date });
    const markedIds = new Set(marks.map((a) => a.studentId));
    let n = 0;
    for (const s of withFace) {
      if (markedIds.has(s.id)) continue;
      // eslint-disable-next-line no-await-in-loop
      await client.create(`${base}/attendance`, {
        groupId: g.id, date, studentId: s.id, studentName: s.fullName, status: 'absent', source: 'faceid', createdAt: new Date(),
      });
      n += 1;
    }
    return n;
  }

  // ---------- timers ----------
  start() {
    const run = () => {
      if (!this.config()) return;
      this.sync().then(() => this.checkAbsent()).catch(() => {});
    };
    run();
    this.timers.push(setInterval(run, SYNC_MS));
    this.timers.push(setInterval(() => {
      if (this.config() && this.state.lastSync) this.checkAbsent().catch((err) => this.log.warn(`⚠️  Edume (kelmaganlar): ${err.message}`));
    }, ABSENT_CHECK_MS));
    for (const t of this.timers) t.unref();
  }

  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }
}

module.exports = { CrmIntegration, mapGroup };
