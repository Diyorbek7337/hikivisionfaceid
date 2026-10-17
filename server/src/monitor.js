'use strict';
/**
 * Periodically checks every terminal: is it reachable, what model is it, is its clock right.
 * Results are written to devices/{id} so the web app can show them.
 */
const { localIsoNoOffset, tzOffsetMinutes, hikTimeZone } = require('./time');
const { explainError } = require('./isapi');

const WRITE_EVERY_MS = 10 * 60 * 1000; // refresh lastCheckAt at most this often when nothing changed
const CLOCK_TOLERANCE_SEC = 60;

class DeviceMonitor {
  constructor({ store, clientFor, tz, onOnline = () => {}, log = console }) {
    this.store = store;
    this.clientFor = clientFor;
    this.tz = tz;
    this.onOnline = onOnline;
    this.log = log;
    this.lastWrite = new Map();
    this.lastClockFix = new Map();
    this.busy = false;
  }

  async checkAll() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const dev of [...this.store.devices.values()]) {
        if (!dev.ip || dev.disabled) continue;
        await this.checkOne(dev);
      }
    } finally {
      this.busy = false;
    }
  }

  async checkOne(dev) {
    const client = this.clientFor(dev);
    const update = {};
    try {
      const info = await client.deviceInfo();
      Object.assign(update, {
        online: true, lastError: '', model: info.model, serialNumber: info.serialNumber, firmware: info.firmware,
      });
      try {
        const t = await client.getTime();
        if (t.date && !Number.isNaN(t.date.getTime())) {
          const skew = Math.round((t.date.getTime() - Date.now()) / 1000);
          update.clockSkewSec = skew;
          const recentlyFixed = Date.now() - (this.lastClockFix.get(dev.id) || 0) < 30 * 60 * 1000;
          const usesNtp = /ntp/i.test(t.timeMode || '');
          if (Math.abs(skew) > CLOCK_TOLERANCE_SEC && this.store.settings.autoTimeSync !== false && !usesNtp && !recentlyFixed) {
            this.lastClockFix.set(dev.id, Date.now());
            const now = new Date();
            await client.setTime(localIsoNoOffset(now, this.tz), hikTimeZone(tzOffsetMinutes(now, this.tz)));
            update.clockSkewSec = 0;
            update.clockFixedAt = Date.now();
            this.log.log(`🕐 ${dev.name}: soat ${skew} soniya farq qilardi — to'g'rilandi`);
          }
        }
      } catch (err) {
        this.log.warn(`⚠️  ${dev.name}: soatni tekshirib bo'lmadi: ${err.message}`);
      }
    } catch (err) {
      Object.assign(update, { online: false, lastError: explainError(err) });
    }

    const changed = update.online !== dev.online
      || (update.lastError || '') !== (dev.lastError || '')
      || (update.model && update.model !== dev.model)
      || (update.clockSkewSec !== undefined && Math.abs((update.clockSkewSec || 0) - (dev.clockSkewSec || 0)) > CLOCK_TOLERANCE_SEC)
      || update.clockFixedAt;
    const last = this.lastWrite.get(dev.id) || 0;
    if (changed || Date.now() - last > WRITE_EVERY_MS) {
      update.lastCheckAt = Date.now();
      this.lastWrite.set(dev.id, Date.now());
      await this.store.updateDevice(dev.id, update).catch((e) => this.log.error('Firestore:', e.message));
      if (update.online && dev.online !== true) {
        this.log.log(`🟢 ${dev.name} (${dev.ip}) ulandi: ${update.model || ''}`);
        this.onOnline(dev);
      } else if (!update.online && dev.online !== false) {
        this.log.warn(`🔴 ${dev.name} (${dev.ip}): ${update.lastError}`);
      }
    }
  }
}

module.exports = { DeviceMonitor };
