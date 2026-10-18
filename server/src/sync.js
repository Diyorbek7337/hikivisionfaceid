'use strict';
/**
 * Pushes employees (and their face photos) from Firestore to every terminal.
 *
 * Each employee has a `version` that the web app increments on every change. For every terminal the
 * bridge stores the version it last applied in employees/{id}.deviceSync.{deviceId}. Whenever they
 * differ, or the last attempt failed, the employee is pushed again.
 */
const { explainError, isPermanentFaceError } = require('./isapi');

const RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 30 * 60 * 1000;

function deviceUsable(d) {
  return d && d.ip && !d.disabled;
}

/** Should this employee be present on terminals? */
function wanted(emp) {
  return !!emp.active && !emp.deleted;
}

class SyncEngine {
  /**
   * @param {object} opts
   * @param {object} opts.store     employees/devices Maps + getFace, setEmployeeSync, updateDevice
   * @param {function} opts.clientFor  device -> IsapiClient
   */
  constructor({ store, clientFor, log = console, now = () => Date.now() }) {
    this.store = store;
    this.clientFor = clientFor;
    this.log = log;
    this.now = now;
    this.running = null;
    this.again = false;
    this.forced = new Set(); // `${deviceId}:${employeeId}` pairs to push regardless of version
    this.handledResync = new Map(); // deviceId -> resyncRequestedAt millis already handled
  }

  needsSync(emp, dev) {
    if (this.forced.has(`${dev.id}:${emp.id}`)) return true;
    const s = emp.deviceSync && emp.deviceSync[dev.id];
    if (!s) return wanted(emp); // never pushed: only needed if the employee should be there
    if (s.version !== emp.version) return true;
    if (s.status === 'error') {
      // A photo the terminal rejected will be rejected again: wait until the employee is edited.
      if (s.permanent) return false;
      // Other errors: retry after 1, 2, 4 … 30 minutes.
      const wait = Math.min(RETRY_MS * 2 ** Math.max(0, (Number(s.attempts) || 1) - 1), MAX_RETRY_MS);
      return this.now() - (Number(s.at) || 0) > wait;
    }
    return false;
  }

  /** Picks up "Qayta sinxronlash" requests from the web app. */
  checkResyncRequests() {
    for (const dev of this.store.devices.values()) {
      const req = dev.resyncRequestedAt;
      const ms = req ? (typeof req.toMillis === 'function' ? req.toMillis() : new Date(req).getTime()) : 0;
      if (!ms || this.handledResync.get(dev.id) === ms) continue;
      if (dev.resyncDoneFor === ms) { this.handledResync.set(dev.id, ms); continue; }
      this.handledResync.set(dev.id, ms);
      for (const emp of this.store.employees.values()) {
        if (wanted(emp) || (emp.deviceSync && emp.deviceSync[dev.id])) this.forced.add(`${dev.id}:${emp.id}`);
      }
      this.pendingResyncDone = { ...(this.pendingResyncDone || {}), [dev.id]: ms };
      this.forcedPlans = new Set([...(this.forcedPlans || []), dev.id]);
    }
  }

  /** Requests a sync run; runs are serialized. */
  schedule() {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.runOnce();
        } while (this.again);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  async runOnce() {
    this.checkResyncRequests();
    for (const dev of [...this.store.devices.values()]) {
      if (!deviceUsable(dev)) continue;
      if (dev.online === false) {
        // Do not hammer an offline (or login-rejecting) terminal; the monitor schedules a run when it comes back.
        continue;
      }
      let failedConnection = false;
      // Entry schedules first: people refer to them.
      const plans = await this.syncAccessPlans(dev);
      if (plans && plans.connection) continue;
      for (const emp of [...this.store.employees.values()]) {
        if (failedConnection) break;
        if (!this.store.devices.has(dev.id)) break; // terminal deleted meanwhile
        if (!this.needsSync(emp, dev)) continue;
        const res = await this.syncOne(emp, dev);
        if (res && res.connection) failedConnection = true;
      }
      const resyncDone = this.pendingResyncDone && this.pendingResyncDone[dev.id];
      if (!failedConnection && this.store.devices.has(dev.id) && (resyncDone || !dev.reconciledAt)) {
        await this.reconcile(dev);
      }
      if (!failedConnection && resyncDone) {
        await this.store.updateDevice(dev.id, { resyncDoneFor: resyncDone }).catch(() => {});
        delete this.pendingResyncDone[dev.id];
      }
    }
  }

  /**
   * Removes people stored on the terminal who are not active employees here (e.g. an earlier owner's
   * staff, or someone deleted while the terminal was replaced). Runs when a terminal is first synced
   * and on every "Qayta yuborish".
   */
  async reconcile(dev) {
    const client = this.clientFor(dev);
    try {
      const keep = new Set([...this.store.employees.values()].filter(wanted).map((e) => String(e.employeeNo)));
      const onTerminal = await client.listUserNumbers();
      const extra = onTerminal.filter((no) => !keep.has(no));
      for (const no of extra) await client.deleteUser(no);
      if (extra.length) this.log.log(`🧹 ${dev.name}: tizimda yo'q ${extra.length} kishi terminaldan o'chirildi`);
      await this.store.updateDevice(dev.id, { reconciledAt: this.now() });
    } catch (err) {
      if (err.status === 404 || /notSupport/i.test(`${err.subStatusCode} ${err.message}`)) {
        await this.store.updateDevice(dev.id, { reconciledAt: this.now() }).catch(() => {});
        return;
      }
      if (!err.blocked) this.log.warn(`⚠️  ${dev.name}: terminaldagi ro'yxatni tekshirib bo'lmadi: ${explainError(err)}`);
    }
  }

  /** Writes the door entry schedules to the terminal when they changed since it last got them. */
  async syncAccessPlans(dev) {
    const store = this.store;
    if (!store.listAccessProfiles) return null;
    const version = Number(store.settings.accessPlansVersion) || 0;
    const forced = this.forcedPlans && this.forcedPlans.has(dev.id);
    if (!forced && (Number(dev.accessPlansVersion) || 0) === version) return null;
    const profiles = store.listAccessProfiles();
    if (!profiles.length && !forced && !dev.accessPlansVersion && !version) return null;
    const client = this.clientFor(dev);
    const hadError = !!dev.accessPlanError;
    // When the terminal starts (or stops) accepting schedules, people with one must be sent again.
    const resendIfChanged = (hasError) => {
      if (hasError === hadError) return;
      for (const e of store.employees.values()) if (e.accessProfileId && wanted(e)) this.forced.add(`${dev.id}:${e.id}`);
    };
    try {
      for (const p of profiles) await client.setAccessPlan(p.slot, p.slot, `davomat-${p.slot}`, p.days);
      await store.updateDevice(dev.id, { accessPlansVersion: version, accessPlanError: '' });
      resendIfChanged(false);
      if (this.forcedPlans) this.forcedPlans.delete(dev.id);
      if (profiles.length) this.log.log(`🚪 ${dev.name}: kirish ruxsati jadvallari yozildi (${profiles.length} ta)`);
      return { ok: true };
    } catch (err) {
      const connection = !!(err.connection || err.status === 401);
      const message = explainError(err);
      if (!connection) {
        // e.g. firmware without access schedules: remember, people are still synced (with "any time" access failing over)
        await store.updateDevice(dev.id, { accessPlansVersion: version, accessPlanError: message }).catch(() => {});
        resendIfChanged(true);
        if (this.forcedPlans) this.forcedPlans.delete(dev.id);
      }
      if (!err.blocked) this.log.warn(`⚠️  ${dev.name}: kirish ruxsati jadvallarini yozib bo'lmadi: ${message}`);
      return { ok: false, connection };
    }
  }

  hasForcedFor(deviceId) {
    for (const k of this.forced) if (k.startsWith(`${deviceId}:`)) return true;
    return false;
  }

  async syncOne(emp, dev) {
    const client = this.clientFor(dev);
    const version = emp.version;
    try {
      if (wanted(emp)) {
        // A terminal that could not store entry schedules gets "any time" so the person can still get in.
        const template = this.store.accessTemplateFor && !dev.accessPlanError ? this.store.accessTemplateFor(emp, dev) : 1;
        await client.upsertUser(emp, template);
        if (emp.hasFace) {
          const jpeg = await this.store.getFace(emp.id);
          if (jpeg) await client.setFace(emp.employeeNo, jpeg);
        } else {
          await client.deleteFace(emp.employeeNo);
        }
      } else {
        await client.deleteUser(emp.employeeNo);
      }
      this.forced.delete(`${dev.id}:${emp.id}`);
      await this.store.setEmployeeSync(emp.id, dev.id, { version, status: 'ok', message: '', at: this.now() });
      this.log.log(`🔄 ${emp.name} (${emp.employeeNo}) → ${dev.name}: ${wanted(emp) ? 'yuborildi' : 'o\'chirildi'}`);
      return { ok: true };
    } catch (err) {
      const message = explainError(err);
      const connection = !!(err.connection || err.status === 401);
      if (!connection) this.forced.delete(`${dev.id}:${emp.id}`); // tried once; normal retry rules apply now
      const prev = emp.deviceSync && emp.deviceSync[dev.id];
      const attempts = prev && prev.status === 'error' && prev.version === version ? (Number(prev.attempts) || 1) + 1 : 1;
      const permanent = !connection && isPermanentFaceError(err);
      if (!err.blocked) this.log.warn(`⚠️  ${emp.name} (${emp.employeeNo}) → ${dev.name}: ${message}`);
      await this.store.setEmployeeSync(emp.id, dev.id, { version, status: 'error', message, at: this.now(), attempts, permanent })
        .catch((e) => this.log.error('Baza:', e.message));
      return { ok: false, connection };
    }
  }
}

module.exports = { SyncEngine, wanted };
