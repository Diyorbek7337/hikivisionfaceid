'use strict';
const crypto = require('node:crypto');

const COOKIE = 'davomat_session';
const MAX_AGE_SEC = 30 * 24 * 3600;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${mac}`;
}

function verify(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [data, mac] = token.split('.');
  if (!data || !mac) return null;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(data).digest('base64url'));
  const got = Buffer.from(mac);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString());
    return p.exp && p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isLocalRequest(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1';
}

function createAuth({ store, secret }) {
  const failures = new Map(); // ip -> { count, until }

  return {
    hashPassword,

    currentUser(req) {
      const s = verify(readCookie(req, COOKIE), secret);
      return s ? store.getUser(s.uid) : null;
    },

    startSession(res, user) {
      const token = sign({ uid: user.id, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC }, secret);
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SEC}`);
    },

    endSession(res) {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    },

    /** Returns the user, or an error string. Locks an IP for 15 minutes after 10 failures. */
    login(req, username, password) {
      const ip = req.socket.remoteAddress;
      const f = failures.get(ip);
      if (f && f.count >= 10 && f.until > Date.now()) return 'Juda ko\'p noto\'g\'ri urinish. 15 daqiqadan keyin urinib ko\'ring';
      const user = store.getUserByName(String(username || '').trim());
      if (!user || !verifyPassword(password, user.password_hash)) {
        if (!f || f.until < Date.now()) failures.set(ip, { count: 1, until: Date.now() + 15 * 60000 });
        else f.count += 1;
        return 'Login yoki parol noto\'g\'ri';
      }
      failures.delete(ip);
      return { id: user.id, username: user.username, name: user.name };
    },

    require(req, res, next) {
      const user = this.currentUser(req);
      if (!user) return res.status(401).json({ error: 'Avval tizimga kiring' });
      req.user = user;
      return next();
    },
  };
}

module.exports = { createAuth, hashPassword, verifyPassword, isLocalRequest, sign, verify };
