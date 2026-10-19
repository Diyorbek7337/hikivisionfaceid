'use strict';
/**
 * Reads new access events from every terminal's own event log (ISAPI AcsEvent search) every few
 * seconds. Works even when the terminal's HTTP Listening push does not send face events
 * (some DS-K1T331W firmware), and picks up scans made while this computer was off.
 */
const { isoWithOffset } = require('./time');
const { deviceBoundAt } = require('./events');

const OVERLAP_MS = 2 * 60 * 1000; // re-read the last 2 minutes: late-written events are not missed (duplicates are skipped)

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAcsInfo(item) {
  const t = item.time ? new Date(item.time) : null;
  const employeeNo = String(item.employeeNoString ?? item.employeeNo ?? '').trim();
  return {
    eventType: 'AccessControllerEvent',
    isAccess: true,
    isHeartbeat: false,
    time: t && !Number.isNaN(t.getTime()) ? t : null,
    employeeNo: employeeNo && employeeNo !== '0' ? employeeNo : null,
    name: item.name ? String(item.name) : null,
    major: num(item.major),
    minor: num(item.minor),
    serialNo: num(item.serialNo),
  };
}

class EventPoller {
  constructor({ store, clientFor, processor, tz, intervalMs = 5000, log = console }) {
    Object.assign(this, { store, clientFor, processor, tz, intervalMs, log });
    this.state = new Map(); // deviceId -> { unsupported, minors, lastError }
    this.busy = false;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error('Poller:', e.message)), this.intervalMs);
    this.timer.unref();
  }

  stop() { clearInterval(this.timer); }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const dev of [...this.store.devices.values()]) {
        if (!dev.ip || dev.disabled || dev.online === false) continue;
        await this.pollOne(dev);
      }
    } finally {
      this.busy = false;
    }
  }

  async pollOne(dev) {
    // State is per terminal address/login: changing them in the web app starts fresh.
    const key = [dev.id, dev.ip, dev.port, dev.username, dev.password].join('|');
    let st = this.state.get(dev.id);
    if (!st || st.key !== key) {
      st = { key, minors: [0], badMinor: 0 };
      this.state.set(dev.id, st);
    }
    // "not supported" may have been a wrong device answering: look again every 10 minutes
    if (st.unsupported && Date.now() - st.unsupported < 10 * 60 * 1000) return;
    const client = this.clientFor(dev);
    const now = Date.now();
    // Never read events from before the terminal was added here: its log may hold an earlier owner's
    // events whose employee numbers would match our new employees.
    const floor = Math.max(deviceBoundAt(dev) || now, now - 7 * 24 * 3600 * 1000);
    const cursor = Math.max(Number(dev.pollCursor) || floor, floor);
    const startTime = isoWithOffset(new Date(Math.max(cursor - OVERLAP_MS, floor)), this.tz);
    // A terminal whose clock runs ahead writes "future" times: search a day ahead so they are not missed.
    const endTime = isoWithOffset(new Date(now + 24 * 3600 * 1000), this.tz);
    let newest = cursor;
    let failed = false;
    try {
      for (const minor of st.minors) {
        let position = 0;
        for (let page = 0; page < 50; page += 1) {
          const r = await client.searchAcsEvents({ startTime, endTime, position, minor });
          for (const item of r.list) {
            const ev = normalizeAcsInfo(item);
            const result = await this.processor.process(dev, ev);
            if (result === 'error') failed = true;
            // never move the cursor past "now" (a wrong terminal clock would hide later events),
            // nor past an event we could not store (it is retried on the next poll)
            if (ev.time && !failed) newest = Math.max(newest, Math.min(ev.time.getTime(), now));
          }
          position += r.list.length;
          if (r.status !== 'MORE' || !r.list.length) break;
        }
      }
      st.badMinor = 0;
      st.unsupported = 0;
      if (st.lastError) {
        this.log.log(`📥 ${dev.name}: eventlarni o'qish tiklandi`);
        st.lastError = null;
      }
      if (newest > cursor || now - (st.savedAt || 0) > 60 * 1000) {
        st.savedAt = now;
        await this.store.updateDevice(dev.id, { pollCursor: Math.max(newest, cursor), lastPollAt: now });
      }
    } catch (err) {
      if (err.blocked || err.status === 401) return; // login problem: the monitor reports it, no extra attempts here
      const text = `${err.subStatusCode || ''} ${err.message}`;
      if (st.minors[0] === 0 && /badParameters|minor/i.test(text)) {
        st.badMinor += 1;
        if (st.badMinor >= 2) st.minors = [75, 76]; // firmware wants a concrete minor type
        return;
      }
      if (err.status === 404 || /notSupport/i.test(text)) {
        if (!st.unsupported) this.log.warn(`⚠️  ${dev.name}: terminal eventlar jurnalini o'qishni qo'llamaydi — faqat HTTP Listening ishlatiladi`);
        st.unsupported = Date.now();
        return;
      }
      if (st.lastError !== err.message) {
        st.lastError = err.message;
        this.log.warn(`⚠️  ${dev.name}: eventlarni o'qib bo'lmadi: ${err.message}`);
      }
    }
  }
}

module.exports = { EventPoller, normalizeAcsInfo };
