'use strict';
const express = require('express');
const { extractEvent, normalizeEvent } = require('./hikvision');
const { processScan, notifyScan } = require('./attendance');
const { createAuth } = require('./auth');
const { createAdminRouter } = require('./admin/routes');

function rawSnippet(body) {
  if (!body || !body.length) return null;
  // Keep only printable text so stored samples stay readable even when a JPEG was attached.
  return body.subarray(0, 4000).toString('latin1').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

/**
 * Handles one HTTP push from a terminal. Always answers 200 so the terminal does not retry forever
 * because of a problem on our side; problems are recorded on the Eventlar page instead.
 */
function handleDevicePush({ repo, cfg, telegram }) {
  return (req, res) => {
    const device = repo.getDeviceByToken(req.params.token);
    if (!device) return res.status(404).send('Unknown device');

    try {
      const raw = extractEvent(req.body, req.get('content-type'));
      if (!raw) {
        repo.touchDevice(device.id, {});
        repo.insertEvent({ device_id: device.id, action: 'unparsed', raw: rawSnippet(req.body) });
        return res.send('OK');
      }
      const ev = normalizeEvent(raw);
      repo.touchDevice(device.id, {
        ip: ev.ip,
        mac: ev.mac,
        skewSec: ev.time && !ev.isHeartbeat ? Math.round((ev.time - Date.now()) / 1000) : null,
      });
      if (ev.isHeartbeat) return res.send('OK');

      const base = {
        device_id: device.id,
        event_time: ev.time ? ev.time.toISOString() : null,
        event_type: ev.eventType,
        employee_no: ev.employeeNo,
        person_name: ev.name,
        major: ev.major,
        minor: ev.minor,
        serial_no: ev.serialNo,
        raw: JSON.stringify(raw).slice(0, 4000),
      };

      // Only events that carry an employee number mean "a known person was verified".
      // Failed recognitions, door open/close etc. have no employee number.
      if (!ev.isAccess || !ev.employeeNo) {
        repo.insertEvent({ ...base, action: 'not_recognized' });
        return res.send('OK');
      }

      const eventId = repo.insertEvent({ ...base, action: 'pending' });
      if (eventId === false) return res.send('OK'); // terminal re-sent an event we already have

      const result = processScan(repo, cfg, device, ev);
      repo.setEventAction(eventId, result.action);
      if (result.action === 'checkin' || result.action === 'checkout') {
        console.log(`✅ ${result.employee.name}: ${result.action} (${device.name})`);
      } else {
        console.log(`ℹ️  ${ev.employeeNo} ${ev.name || ''}: ${result.action} (${device.name})`);
      }
      notifyScan(telegram, cfg, result);
    } catch (err) {
      console.error('Event ishlovida xato:', err);
      try { repo.insertEvent({ device_id: device.id, action: 'error', raw: String(err && err.stack).slice(0, 2000) }); } catch { /* ignore */ }
    }
    return res.send('OK');
  };
}

function createApp({ repo, cfg, telegram }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback, uniquelocal');

  app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'Hikvision Face Recognition Bridge', time: new Date().toISOString() });
  });

  const push = handleDevicePush({ repo, cfg, telegram });
  const rawBody = express.raw({ type: () => true, limit: '20mb' });
  app.post('/hik/:token', rawBody, push);
  app.post('/hik/:token/*', rawBody, push);

  const auth = createAuth(cfg);
  app.use('/admin', createAdminRouter({ repo, cfg, auth }));
  app.get('/', (req, res) => res.redirect('/admin'));

  return app;
}

module.exports = { createApp };
