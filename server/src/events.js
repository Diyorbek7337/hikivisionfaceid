'use strict';
/**
 * Turns one normalized terminal event into attendance. Shared by the HTTP push receiver (server.js)
 * and the event poller (poller.js); the same event from both sources is stored once (eventKey).
 * Events are processed one at a time so two quick scans cannot overwrite each other's attendance.
 */
const { processScan, notifyScan } = require('./attendance');

function eventKey(deviceId, ev) {
  if (ev.serialNo != null && ev.time) return `${deviceId}_${ev.serialNo}_${ev.time.getTime()}`;
  if (ev.time && ev.employeeNo) return `${deviceId}_t${ev.time.getTime()}_${ev.employeeNo}_${ev.minor}`;
  return `${deviceId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createEventProcessor({ store, tz, telegram, log = console }) {
  let queue = Promise.resolve();
  const lastWarn = new Map(); // same warning at most once per 10 minutes
  const warnOnce = (key, text) => {
    const now = Date.now();
    if (now - (lastWarn.get(key) || 0) < 10 * 60 * 1000) return;
    lastWarn.set(key, now);
    if (lastWarn.size > 5000) lastWarn.clear();
    log.log(text);
  };

  async function handle(device, ev) {
    // Hikvision major types: 1 alarm, 2 exception, 3 operation (e.g. our own status checks: 3/1028), 5 access event.
    // Only 5 is about people passing; the rest is the terminal's own log and is ignored quietly.
    if (ev.major != null && ev.major !== 5) return 'ignored';
    if (!ev.employeeNo && ev.minor !== 76) return 'ignored'; // door opened/closed etc. come with every scan

    const key = eventKey(device.id, ev);
    if (await store.eventExists(key)) return 'known';
    // Push and polling may number the same scan differently: match it by person and time as well.
    if (store.similarEventExists && await store.similarEventExists(device.id, ev.employeeNo, ev.time)) return 'known';

    const base = {
      deviceId: device.id, deviceName: device.name || '', time: ev.time || new Date(),
      employeeNo: ev.employeeNo || null, personName: ev.name || null, major: ev.major, minor: ev.minor,
    };
    if (!ev.employeeNo) {
      await store.saveEvent(key, { ...base, action: 'not_recognized' });
      warnOnce(`nr:${device.id}`, `ℹ️  ${device.name}: yuz tanilmadi`);
      return 'not_recognized';
    }
    const result = await processScan(store, store.settings, tz, device, ev);
    await store.saveEvent(key, { ...base, action: result.action, employeeId: result.employee ? result.employee.id : null });
    if (result.action === 'checkin' || result.action === 'checkout') {
      log.log(`✅ ${result.employee.name}: ${result.action === 'checkin' ? 'keldi' : 'ketdi'} (${device.name})`);
    } else if (result.action === 'unknown_employee') {
      warnOnce(`ue:${device.id}:${ev.employeeNo}`,
        `ℹ️  ${device.name}: terminalda ${ev.employeeNo}-raqamli odam bor, tizimda yo'q (Terminallar → "Qayta yuborish" uni terminaldan o'chiradi)`);
    } else if (result.action === 'too_many') {
      warnOnce(`tm:${result.employee.id}`, `⚠️  ${result.employee.name}: bugun juda ko'p skanerlash — qolganlari hisobga olinmaydi (${device.name})`);
    } else if (result.action === 'before_registration') {
      // old event from the terminal's memory: ignore quietly
    } else if (result.action !== 'duplicate') {
      log.log(`ℹ️  ${ev.employeeNo} ${ev.name || ''}: ${result.action} (${device.name})`);
    }
    notifyScan(telegram, tz, result);
    return result.action;
  }

  const processor = {
    /** Queues an event; resolves with what happened to it. Never rejects. */
    process(device, ev) {
      const job = queue.then(() => handle(device, ev)).catch((err) => {
        log.error('❌ Event ishlovida xato:', err);
        return 'error';
      });
      queue = job;
      processor.idle = job;
      return job;
    },
    idle: queue,
  };
  return processor;
}

module.exports = { createEventProcessor, eventKey };
