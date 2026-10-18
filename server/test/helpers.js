'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { DEFAULT_SETTINGS } = require('../src/store');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/** In-memory replacement for FirestoreStore. */
class MemoryStore extends EventEmitter {
  constructor() {
    super();
    this.employees = new Map();
    this.devices = new Map();
    this.settings = { ...DEFAULT_SETTINGS };
    this.attendance = new Map();
    this.events = new Map();
    this.faces = new Map();
    this.ready = Promise.resolve();
  }
  addEmployee(e) { this.employees.set(e.id, { active: true, version: 1, ...e }); }
  async getWorkHours() { return { start: '09:00', end: '18:00' }; }
  addDevice(d) { this.devices.set(d.id, { ...d }); }
  async findEmployeeByNo(no) {
    for (const e of this.employees.values()) if (!e.deleted && String(e.employeeNo) === String(no)) return e;
    return null;
  }
  async getAttendance(id, date) { const r = this.attendance.get(`${id}_${date}`); return r ? { ...r } : null; }
  async saveAttendance(rec) { this.attendance.set(`${rec.employeeId}_${rec.date}`, { ...rec }); }
  async eventExists(k) { return this.events.has(k); }
  async saveEvent(k, d) { this.events.set(k, d); }
  async getFace(id) { return this.faces.get(id) || null; }
  async setEmployeeSync(empId, devId, data) {
    const e = this.employees.get(empId);
    if (e) e.deviceSync = { ...(e.deviceSync || {}), [devId]: data };
  }
  async updateDevice(id, data) { this.devices.set(id, { ...this.devices.get(id), ...data }); }
}

/** Minimal fake Hikvision terminal with digest auth. */
/**
 * Options imitate firmware quirks:
 *   singleUseNonce — every nonce is valid for one request; a re-used one gets a bare 401 (no WWW-Authenticate)
 *   lockAfter      — after this many failed logins answer 401 with a lock body and no challenge
 */
function startFakeTerminal({ username = 'admin', password = 'secret', faceError = null, port = 0, singleUseNonce = false, lockAfter = 0 } = {}) {
  const realm = 'DS-K1T331W';
  let nonce = crypto.randomBytes(8).toString('hex');
  const usedNonces = new Set();
  let failures = 0;
  const state = { users: new Map(), faces: new Map(), requests: [], time: '2020-01-01T00:00:00+05:00', setTimeBody: null };

  function authorized(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Digest ')) return false;
    const p = {};
    h.replace(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g, (_, k, a, b) => { p[k] = a !== undefined ? a : b; });
    const ha1 = md5(`${username}:${realm}:${password}`);
    const ha2 = md5(`${req.method}:${p.uri}`);
    const expected = md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
    if (singleUseNonce) {
      if (p.nonce !== nonce || usedNonces.has(p.nonce)) return 'stale';
      usedNonces.add(p.nonce);
    }
    return p.response === expected && p.uri === req.url;
  }

  const ok = (res) => res.end(JSON.stringify({ statusCode: 1, statusString: 'OK', subStatusCode: 'ok' }));
  const fail = (res, sub, code = 400) => { res.statusCode = code; res.end(JSON.stringify({ statusCode: 6, statusString: 'Invalid Content', subStatusCode: sub, errorMsg: sub })); };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (lockAfter && failures >= lockAfter) {
        res.statusCode = 401;
        return res.end('{"statusCode":4,"statusString":"Invalid Operation","subStatusCode":"userLocked","lockStatus":"lock","unlockTime":1800}');
      }
      const auth = authorized(req);
      if (auth !== true) {
        res.statusCode = 401;
        if (auth === 'stale') return res.end(); // bare 401, no challenge
        if (req.headers.authorization) failures += 1;
        if (singleUseNonce) nonce = crypto.randomBytes(8).toString('hex');
        res.setHeader('WWW-Authenticate', `Digest qop="auth", realm="${realm}", nonce="${nonce}", stale="FALSE"`);
        return res.end();
      }
      state.requests.push('auth-ok');
      state.requests.pop();
      const url = req.url;
      state.requests.push(`${req.method} ${url.split('?')[0]}`);
      if (url === '/ISAPI/System/deviceInfo') {
        return res.end(`<?xml version="1.0"?><DeviceInfo><deviceName>Access Controller</deviceName><model>DS-K1T331W</model><serialNumber>DS-K1T331W2022</serialNumber><firmwareVersion>V3.2.30</firmwareVersion><macAddress>aa:bb</macAddress></DeviceInfo>`);
      }
      if (url === '/ISAPI/System/time') {
        if (req.method === 'PUT') { state.setTimeBody = body.toString(); return res.end('<ResponseStatus><statusCode>1</statusCode></ResponseStatus>'); }
        return res.end(`<Time><timeMode>manual</timeMode><localTime>${state.time}</localTime><timeZone>CST-5:00:00</timeZone></Time>`);
      }
      if (url.startsWith('/ISAPI/AccessControl/UserInfo/Record')) {
        const u = JSON.parse(body).UserInfo;
        if (state.users.has(u.employeeNo)) return fail(res, 'employeeNoAlreadyExist');
        state.users.set(u.employeeNo, u);
        return ok(res);
      }
      if (url.startsWith('/ISAPI/AccessControl/UserInfo/Modify')) {
        const u = JSON.parse(body).UserInfo;
        if (!state.users.has(u.employeeNo)) return fail(res, 'employeeNoNotExist');
        state.users.set(u.employeeNo, u);
        return ok(res);
      }
      if (url.startsWith('/ISAPI/AccessControl/UserInfo/Delete')) {
        for (const x of JSON.parse(body).UserInfoDelCond.EmployeeNoList) { state.users.delete(x.employeeNo); state.faces.delete(x.employeeNo); }
        return ok(res);
      }
      if (url.startsWith('/ISAPI/Intelligent/FDLib/FDSetUp')) {
        if (faceError) return fail(res, faceError);
        const text = body.toString('latin1');
        const meta = JSON.parse(/\{[^}]*FPID[^}]*\}/.exec(text)[0]);
        if (!/name="img"; filename="face.jpg"/.test(text)) return fail(res, 'badImage');
        if (!state.users.has(meta.FPID)) return fail(res, 'employeeNoNotExist');
        state.faces.set(meta.FPID, text.length);
        return ok(res);
      }
      if (url.startsWith('/ISAPI/Intelligent/FDLib/FDSearch/Delete')) {
        for (const x of JSON.parse(body).FPID) state.faces.delete(x.value);
        return ok(res);
      }
      res.statusCode = 404;
      return res.end('{"statusCode":4,"subStatusCode":"notSupport"}');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    resolve({ server, state, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
  }));
}

module.exports = { MemoryStore, startFakeTerminal };
