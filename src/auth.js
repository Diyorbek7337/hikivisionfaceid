'use strict';
const crypto = require('node:crypto');

const COOKIE = 'hik_session';
const MAX_AGE_SEC = 7 * 24 * 3600;

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [data, mac] = token.split('.');
  if (!data || !mac) return null;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function createAuth(cfg) {
  const failures = new Map(); // ip -> { count, until }

  function isBlocked(ip) {
    const f = failures.get(ip);
    return f && f.count >= 10 && f.until > Date.now();
  }
  function recordFailure(ip) {
    const f = failures.get(ip);
    if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60 * 1000 });
    else f.count += 1;
  }

  return {
    login(req, res, username, password) {
      const ip = req.ip;
      if (isBlocked(ip)) return 'blocked';
      if (!cfg.adminPassword || !safeEqual(username, cfg.adminUsername) || !safeEqual(password, cfg.adminPassword)) {
        recordFailure(ip);
        return 'invalid';
      }
      failures.delete(ip);
      const token = sign({ u: username, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC }, cfg.sessionSecret);
      const secure = req.secure ? '; Secure' : '';
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SEC}${secure}`);
      return 'ok';
    },
    logout(res) {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    },
    middleware(req, res, next) {
      const session = verify(readCookie(req, COOKIE), cfg.sessionSecret);
      if (!session) return res.redirect('/admin/login');
      req.user = session.u;
      return next();
    },
  };
}

module.exports = { createAuth, sign, verify };
