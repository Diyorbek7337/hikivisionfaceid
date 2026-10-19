'use strict';
/**
 * Telegram mini app: read-only attendance for the director / HR, opened from the bot.
 *
 * Who is it? Telegram signs the data it hands to the mini app (initData) with the bot token; we check
 * that signature, then give a short-lived token. Only Telegram users listed by the admin
 * (ADMIN_TELEGRAM_IDS + Sozlamalar → "Telefondan ko'ruvchilar") get in, and only these read-only
 * routes exist here — nothing can be changed through them.
 */
const crypto = require('node:crypto');
const express = require('express');
const { sign, verify } = require('./auth');
const { daySummary, periodSummary, addDays } = require('./summary');
const { localDate } = require('./time');

const TOKEN_HOURS = 12;
const INIT_DATA_MAX_AGE_SEC = 24 * 3600;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** Returns the Telegram user from a valid, fresh initData string; otherwise null. */
function checkInitData(initData, botToken, { maxAgeSec = INIT_DATA_MAX_AGE_SEC, now = Date.now() } = {}) {
  if (!initData || !botToken || typeof initData !== 'string' || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

/** Telegram users allowed to look: id -> name */
function viewers(store, cfg) {
  const out = new Map();
  for (const id of cfg.adminTelegramIds || []) out.set(String(id), 'Administrator');
  for (const v of store.settings.telegramViewers || []) if (v && v.id) out.set(String(v.id), v.name || '');
  return out;
}

function createTgApi({ store, cfg, secret }) {
  const r = express.Router();
  r.use(express.json({ limit: '16kb' }));
  const tz = cfg.timezone;
  const allowed = (id) => viewers(store, cfg).has(String(id));

  r.post('/login', (req, res) => {
    if (!cfg.botToken) return res.status(503).json({ error: 'Telegram bot sozlanmagan (BOT_TOKEN)' });
    const user = checkInitData(req.body && req.body.initData, cfg.botToken);
    if (!user) return res.status(401).json({ error: 'Telegram tasdiqlamadi. Ilovani botdagi tugma orqali qayta oching.' });
    if (!allowed(user.id)) {
      return res.status(403).json({ error: `Sizga ruxsat berilmagan. Administratorga Telegram ID raqamingizni yuboring: ${user.id}`, id: user.id });
    }
    const token = sign({ tg: String(user.id), exp: Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600 }, secret);
    res.json({
      token, name: [user.first_name, user.last_name].filter(Boolean).join(' '),
      organizationName: store.settings.organizationName || '', today: localDate(new Date(), tz), timezone: tz,
    });
  });

  // Everything below: a valid token of a user who is still on the list (removing someone works at once).
  r.use((req, res, next) => {
    const p = verify(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), secret);
    if (!p || !p.tg || !allowed(p.tg)) return res.status(401).json({ error: 'Qayta kiring' });
    return next();
  });

  r.get('/today', (req, res) => {
    const today = localDate(new Date(), tz);
    const date = isDate(req.query.date) && req.query.date <= today ? req.query.date : today;
    const rows = daySummary(store, date, tz).map((x) => ({
      id: x.employee.id, name: x.employee.name, position: x.employee.position || '',
      kind: x.employee.kind || 'staff', className: x.employee.className || '',
      status: x.status, inside: x.inside, flexible: x.flexible, hours: x.hours,
      checkIn: x.attendance ? x.attendance.checkIn : null,
      checkOut: x.attendance ? x.attendance.checkOut : null,
      lateMinutes: x.attendance ? x.attendance.lateMinutes : 0,
      earlyMinutes: x.attendance ? x.attendance.earlyMinutes : 0,
      workedMinutes: x.attendance ? x.attendance.workedMinutes : null,
      visits: x.attendance ? x.attendance.sessions.length : 0,
    }));
    res.json({ date, today, rows });
  });

  r.get('/report', (req, res) => {
    const today = localDate(new Date(), tz);
    const from = isDate(req.query.from) ? req.query.from : `${today.slice(0, 8)}01`;
    const to = isDate(req.query.to) ? req.query.to : today;
    if (from > to) return res.status(400).json({ error: 'Sana oralig\'i noto\'g\'ri' });
    if (addDays(from, 92) < to) return res.status(400).json({ error: 'Ko\'pi bilan 3 oylik oraliq' });
    const { summary } = periodSummary(store, from, to, tz);
    res.json({
      from, to,
      summary: summary.map((s) => ({
        id: s.employeeId, name: s.name, position: s.position || '', flexible: s.flexible,
        kind: s.kind, className: s.className,
        workDays: s.workDays, presentDays: s.presentDays, absentDays: s.absentDays, absentDates: s.absentDates,
        lateCount: s.lateCount, lateMinutes: s.lateMinutes, lateDates: s.lateDates,
        earlyCount: s.earlyCount, workedMinutes: s.workedMinutes,
      })),
    });
  });

  return r;
}

/**
 * Requests arriving through the public tunnel (Tailscale Funnel / Cloudflare Tunnel) or any reverse
 * proxy. They may only reach the mini app; the admin panel is for the local network.
 */
function isPublicRequest(req, cfg) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  let publicHost = '';
  try { publicHost = cfg.publicUrl ? new URL(cfg.publicUrl).hostname.toLowerCase() : ''; } catch { /* bad PUBLIC_URL */ }
  if (publicHost && host === publicHost) return true;
  return !!(req.headers['cf-connecting-ip'] || req.headers['tailscale-funnel-request'] || req.headers['x-forwarded-for']
    || req.headers.forwarded);
}

const PUBLIC_PATHS = [/^\/tg(\/|\.html)?$/, /^\/tg\//, /^\/_next\//, /^\/api\/tg\//, /^\/icon\.svg/, /^\/favicon\.ico$/];

function publicGate(cfg) {
  return (req, res, next) => {
    if (!isPublicRequest(req, cfg)) return next();
    if (PUBLIC_PATHS.some((re) => re.test(req.path))) return next();
    return res.status(404).send('Not found');
  };
}

module.exports = { createTgApi, checkInitData, publicGate, isPublicRequest, viewers };
