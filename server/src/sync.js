'use strict';
/**
 * Pushes employees (and their face photos) from Firestore to every terminal.
 *
 * Each employee has a `version` that the web app increments on every change. For every terminal the
 * bridge stores the version it last applied in employees/{id}.deviceSync.{deviceId}. Whenever they
 * differ, or the last attempt failed, the employee is pushed again.
 */
const { explainError } = require('./isapi');

const RETRY_MS = 60 * 1000;

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
    if (s.status === 'error' && this.now() - (Number(s.at) || 0) > RETRY_MS) return true;
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
      for (const emp of [...this.store.employees.values()]) {
        if (failedConnection) break;
        if (!this.needsSync(emp, dev)) continue;
        const res = await this.syncOne(emp, dev);
        if (res && res.connection) failedConnection = true;
      }
      if (!failedConnection && this.pendingResyncDone && this.pendingResyncDone[dev.id]) {
        await this.store.updateDevice(dev.id, { resyncDoneFor: this.pendingResyncDone[dev.id] }).catch(() => {});
        delete this.pendingResyncDone[dev.id];
      }
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
        await client.upsertUser(emp);
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
      this.log.warn(`⚠️  ${emp.name} (${emp.employeeNo}) → ${dev.name}: ${message}`);
      await this.store.setEmployeeSync(emp.id, dev.id, { version, status: 'error', message, at: this.now() })
        .catch((e) => this.log.error('Firestore:', e.message));
      return { ok: false, connection: !!(err.connection || err.status === 401) };
    }
  }
}

module.exports = { SyncEngine, wanted };
