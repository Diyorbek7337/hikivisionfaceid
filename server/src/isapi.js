'use strict';
/**
 * Small Hikvision ISAPI client (HTTP Digest auth) for access-control terminals
 * (DS-K1T331 / DS-K1T342 / DS-K1T671 ... "MinMoe" series).
 */
const crypto = require('node:crypto');
const { XMLParser } = require('fast-xml-parser');

const xml = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

class IsapiError extends Error {
  constructor(message, { status, subStatusCode, errorMsg } = {}) {
    super(message);
    this.status = status;
    this.subStatusCode = subStatusCode;
    this.errorMsg = errorMsg;
  }
}

function parseChallenge(header) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,\s]+))/g;
  let m;
  while ((m = re.exec(header || ''))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out;
}

class IsapiClient {
  constructor({ host, port = 80, username, password, timeoutMs = 15000 }) {
    this.base = `http://${host}${Number(port) && Number(port) !== 80 ? `:${port}` : ''}`;
    this.username = username || 'admin';
    this.password = password || '';
    this.timeoutMs = timeoutMs;
    this.challenge = null;
    this.nc = 0;
    this.queue = Promise.resolve();
  }

  authHeader(method, uri) {
    const c = this.challenge;
    if (!c) return null;
    if (c.scheme === 'basic') {
      return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    }
    this.nc += 1;
    const nc = this.nc.toString(16).padStart(8, '0');
    const cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(`${this.username}:${c.realm}:${this.password}`);
    const ha2 = md5(`${method}:${uri}`);
    const qop = c.qop ? c.qop.split(',').map((s) => s.trim()).find((q) => q === 'auth') || 'auth' : null;
    const response = qop
      ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${c.nonce}:${ha2}`);
    let h = `Digest username="${this.username}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", algorithm=MD5, response="${response}"`;
    if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    if (c.opaque) h += `, opaque="${c.opaque}"`;
    return h;
  }

  async send(method, uri, body, headers) {
    const h = { ...headers };
    const auth = this.authHeader(method, uri);
    if (auth) h.Authorization = auth;
    return fetch(this.base + uri, { method, headers: h, body, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  /** Remembers the auth scheme from a 401 response. Returns false when the response has none. */
  learnChallenge(res) {
    const www = res.headers.get('www-authenticate') || '';
    // Several WWW-Authenticate headers are joined with ", " — prefer Digest wherever it is.
    const i = www.search(/digest\s/i);
    if (i !== -1) {
      this.challenge = { scheme: 'digest', ...parseChallenge(www.slice(i + 7)) };
    } else if (/basic/i.test(www)) {
      this.challenge = { scheme: 'basic' };
    } else {
      return false;
    }
    this.nc = 0;
    return true;
  }

  /**
   * Raw request with HTTP Digest (or Basic) auth; returns { status, text, contentType }.
   * Some firmwares answer a re-used nonce with a bare 401 (no WWW-Authenticate), so we then ask for a
   * fresh challenge with an unauthenticated request. Basic auth is used only when the terminal asks for it.
   */
  request(method, uri, opts = {}) {
    // After the terminal rejected our login, stop trying for a while: Hikvision locks the computer out
    // after a few failures. The breaker is per client; changing the login/password creates a new client.
    if (this.authBlockedUntil && Date.now() < this.authBlockedUntil) {
      return Promise.reject(Object.assign(new IsapiError(this.authBlockedMessage, { status: 401 }), { blocked: true }));
    }
    // One request at a time per terminal: digest nonce counters must arrive in order.
    const run = this.queue.then(() => this.requestNow(method, uri, opts));
    this.queue = run.catch(() => {});
    return run;
  }

  async requestNow(method, uri, { body, contentType } = {}) {
    const headers = contentType ? { 'Content-Type': contentType } : {};
    let res;
    let consumedText = '';
    const consume = async (r) => { consumedText = await r.text().catch(() => ''); };
    try {
      res = await this.send(method, uri, body, headers);
      if (res.status === 401) {
        await consume(res);
        let learned = this.learnChallenge(res);
        if (!learned && this.challenge) {
          this.challenge = null; // stale cached nonce: start over without credentials
          res = await this.send(method, uri, body, headers);
          if (res.status === 401) {
            await consume(res);
            learned = this.learnChallenge(res);
          }
        }
        if (res.status === 401 && learned) {
          res = await this.send(method, uri, body, headers);
        }
        // Never fall back to Basic on our own: it would send the password in clear text to whatever
        // answers at that address (e.g. another device that got the terminal's IP).
      }
    } catch (err) {
      if (err instanceof IsapiError) throw err;
      const reason = err.name === 'TimeoutError' ? 'javob bermadi (timeout)' : (err.cause && err.cause.code) || err.message;
      const e = new IsapiError(`Terminalga ulanib bo'lmadi: ${reason}`);
      e.connection = true;
      throw e;
    }
    const text = res.bodyUsed ? consumedText : await res.text();
    if (res.status === 401) {
      this.challenge = null;
      const e = IsapiClient.authError(res, text);
      this.authBlockedUntil = Date.now() + Math.max(5 * 60, e.unlockSeconds || 0) * 1000;
      this.authBlockedMessage = e.message;
      throw e;
    }
    return { status: res.status, text, contentType: res.headers.get('content-type') || '' };
  }

  /** Explains a final 401: wrong password, or the terminal locked this computer out after failed logins. */
  static authError(res, text) {
    const data = IsapiClient.parse(text) || {};
    const flat = JSON.stringify(data) + text;
    const unlock = Number(data.unlockTime || data.retryLoginTime || (/unlockTime\D*(\d+)/i.exec(flat) || [])[1] || 0);
    let msg;
    if (/lock/i.test(flat)) {
      const mins = unlock ? Math.ceil(unlock / 60) : 30;
      msg = `Terminal ko'p noto'g'ri urinish sababli bu kompyuterni vaqtincha blokladi (~${mins} daqiqa). Parolni tekshiring va kuting`;
    } else {
      msg = 'Login yoki parol noto\'g\'ri (401)';
    }
    const e = new IsapiError(msg, { status: 401 });
    e.unlockSeconds = /lock/i.test(flat) ? (unlock || 1800) : 0;
    e.detail = `WWW-Authenticate: ${res.headers.get('www-authenticate') || '(yo\'q)'}; javob: ${String(text).slice(0, 300)}`;
    return e;
  }

  /** Parses a JSON or XML ISAPI response into an object. */
  static parse(text) {
    const t = (text || '').trim();
    if (t.startsWith('{')) {
      try { return JSON.parse(t); } catch { return null; }
    }
    if (t.startsWith('<')) {
      try {
        const o = xml.parse(t);
        const k = Object.keys(o).find((x) => x !== '?xml');
        return k ? o[k] : null;
      } catch { return null; }
    }
    return null;
  }

  static check(res) {
    const data = IsapiClient.parse(res.text) || {};
    const statusCode = Number(data.statusCode ?? (res.status < 300 ? 1 : 0));
    if (res.status >= 300 || (statusCode && statusCode !== 1)) {
      const sub = data.subStatusCode || '';
      const msg = data.errorMsg || data.statusString || `HTTP ${res.status}`;
      throw new IsapiError(`${msg}${sub ? ` (${sub})` : ''}`, { status: res.status, subStatusCode: sub, errorMsg: data.errorMsg });
    }
    return data;
  }

  async json(method, uri, obj) {
    const res = await this.request(method, uri, obj === undefined ? {} : {
      body: JSON.stringify(obj), contentType: 'application/json',
    });
    return IsapiClient.check(res);
  }

  // ---------- device ----------

  async deviceInfo() {
    const res = await this.request('GET', '/ISAPI/System/deviceInfo');
    const d = IsapiClient.check(res);
    return {
      name: d.deviceName || '', model: d.model || '', serialNumber: d.serialNumber || '',
      firmware: [d.firmwareVersion, d.firmwareReleasedDate].filter(Boolean).join(' '), mac: d.macAddress || '',
    };
  }

  /** Returns the terminal clock as a Date (its localTime carries the offset). */
  async getTime() {
    const res = await this.request('GET', '/ISAPI/System/time');
    const d = IsapiClient.check(res);
    return { localTime: d.localTime, timeZone: d.timeZone, timeMode: d.timeMode, date: d.localTime ? new Date(d.localTime) : null };
  }

  async setTime(localIsoNoOffset, hikTimeZone) {
    const body = `<?xml version="1.0" encoding="UTF-8"?><Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">`
      + `<timeMode>manual</timeMode><localTime>${localIsoNoOffset}</localTime><timeZone>${hikTimeZone}</timeZone></Time>`;
    const res = await this.request('PUT', '/ISAPI/System/time', { body, contentType: 'application/xml' });
    return IsapiClient.check(res);
  }

  // ---------- events ----------

  /**
   * Searches the terminal's event log (major 5 = access events). `startTime`/`endTime` are ISO strings
   * with offset. Returns { status: 'OK'|'MORE'|'NO MATCH', total, list }.
   */
  async searchAcsEvents({ startTime, endTime, position = 0, max = 30, minor = 0 }) {
    const d = await this.json('POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
      AcsEventCond: {
        searchID: crypto.randomUUID(), searchResultPosition: position, maxResults: max,
        major: 5, minor, startTime, endTime,
      },
    });
    const r = d.AcsEvent || {};
    const list = Array.isArray(r.InfoList) ? r.InfoList : (r.InfoList ? [r.InfoList] : []);
    return { status: String(r.responseStatusStrg || 'OK').toUpperCase(), total: Number(r.totalMatches) || list.length, list };
  }

  // ---------- persons ----------

  /** templateNo: access schedule on this terminal (1 = the built-in "all day, every day"). */
  static userInfo(employee, templateNo = 1) {
    return {
      employeeNo: String(employee.employeeNo),
      name: String(employee.name || '').slice(0, 32),
      userType: 'normal',
      Valid: { enable: true, beginTime: '2020-01-01T00:00:00', endTime: '2037-12-31T23:59:59', timeType: 'local' },
      doorRight: '1',
      RightPlan: [{ doorNo: 1, planTemplateNo: String(templateNo) }],
    };
  }

  /** Adds the person, or updates it when the employee number already exists. */
  async upsertUser(employee, templateNo = 1) {
    const UserInfo = IsapiClient.userInfo(employee, templateNo);
    try {
      await this.json('POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', { UserInfo });
      return 'added';
    } catch (err) {
      if (!/exist/i.test(`${err.subStatusCode} ${err.message}`)) throw err;
    }
    await this.json('PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', { UserInfo });
    return 'updated';
  }

  // ---------- door access ----------

  /**
   * Writes a weekly access schedule (week plan `planNo`) and the template `templateNo` that uses it.
   * days: {"0": null | {start: "HH:MM", end: "HH:MM"}, ...}, 0 = Sunday. A null day = no entry that day.
   */
  async setAccessPlan(templateNo, planNo, name, days) {
    const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const WeekPlanCfg = [];
    for (let i = 0; i < 7; i += 1) {
      const d = days && days[String(i)];
      WeekPlanCfg.push({
        week: WEEK[i], id: 1, enable: !!d,
        TimeSegment: d ? { beginTime: `${d.start}:00`, endTime: `${d.end}:00` } : { beginTime: '00:00:00', endTime: '00:00:00' },
      });
    }
    await this.json('PUT', `/ISAPI/AccessControl/UserRightWeekPlanCfg/${planNo}?format=json`, {
      UserRightWeekPlanCfg: { enable: true, WeekPlanCfg },
    });
    await this.json('PUT', `/ISAPI/AccessControl/UserRightPlanTemplate/${templateNo}?format=json`, {
      UserRightPlanTemplate: { enable: true, templateName: String(name).slice(0, 32), weekPlanNo: planNo, holidayGroupNo: '' },
    });
  }

  /** Door command from the web app: open (once) | alwaysOpen | close (back to normal / closed). */
  async remoteDoor(cmd, doorNo = 1) {
    if (!['open', 'alwaysOpen', 'close'].includes(cmd)) throw new IsapiError(`Noma'lum buyruq: ${cmd}`, { status: 400 });
    const body = `<?xml version="1.0" encoding="UTF-8"?><RemoteControlDoor version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">`
      + `<cmd>${cmd}</cmd></RemoteControlDoor>`;
    const res = await this.request('PUT', `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`, { body, contentType: 'application/xml' });
    return IsapiClient.check(res);
  }

  /** Deletes the person (and its face). Missing person is not an error. */
  async deleteUser(employeeNo) {
    try {
      await this.json('PUT', '/ISAPI/AccessControl/UserInfo/Delete?format=json', {
        UserInfoDelCond: { EmployeeNoList: [{ employeeNo: String(employeeNo) }] },
      });
    } catch (err) {
      if (/not\s*exist|notExist|noExist/i.test(`${err.subStatusCode} ${err.message}`)) return;
      throw err;
    }
  }

  /** All employee numbers stored on the terminal (paged UserInfo search). */
  async listUserNumbers() {
    const out = [];
    const searchID = crypto.randomUUID();
    for (let position = 0, page = 0; page < 200; page += 1) {
      const d = await this.json('POST', '/ISAPI/AccessControl/UserInfo/Search?format=json', {
        UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults: 30 },
      });
      const r = d.UserInfoSearch || {};
      const list = Array.isArray(r.UserInfo) ? r.UserInfo : (r.UserInfo ? [r.UserInfo] : []);
      for (const u of list) if (u.employeeNo != null) out.push(String(u.employeeNo));
      position += list.length;
      if (String(r.responseStatusStrg || '').toUpperCase() !== 'MORE' || !list.length) break;
    }
    return out;
  }

  async countUsers() {
    const d = await this.json('GET', '/ISAPI/AccessControl/UserInfo/Count?format=json');
    return Number(d.UserInfoCount && d.UserInfoCount.userNumber) || 0;
  }

  // ---------- faces ----------

  static multipart(fields, file) {
    const boundary = `----HikBridge${crypto.randomBytes(8).toString('hex')}`;
    const chunks = [];
    for (const [name, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n`
        + `Content-Type: application/json\r\n\r\n${value}\r\n`));
    }
    if (file) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`
        + `Content-Type: ${file.contentType}\r\nContent-Length: ${file.data.length}\r\n\r\n`));
      chunks.push(file.data, Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  /** Uploads (or replaces) the face photo of a person. `jpeg` is a Buffer. */
  async setFace(employeeNo, jpeg) {
    const meta = JSON.stringify({ faceLibType: 'blackFD', FDID: '1', FPID: String(employeeNo) });
    const file = { name: 'img', filename: 'face.jpg', contentType: 'image/jpeg', data: jpeg };
    // FDSetUp adds or replaces; some firmware only accepts FaceDataRecord for new faces.
    let firstErr;
    try {
      IsapiClient.check(await this.request('PUT', '/ISAPI/Intelligent/FDLib/FDSetUp?format=json',
        IsapiClient.multipart({ FaceDataRecord: meta }, file)));
      return;
    } catch (err) {
      if (err.status === 401 || err.connection) throw err;
      firstErr = err;
    }
    try {
      IsapiClient.check(await this.request('POST', '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
        IsapiClient.multipart({ FaceDataRecord: meta }, file)));
    } catch (err) {
      // The fallback is not supported, or the face exists: the first error explains the problem better.
      if (err.status === 404 || /exist|notSupport/i.test(`${err.subStatusCode} ${err.message}`)) throw firstErr;
      throw err;
    }
  }

  async deleteFace(employeeNo) {
    try {
      await this.json('PUT', '/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD', {
        FPID: [{ value: String(employeeNo) }],
      });
    } catch (err) {
      if (err.status === 401 || err.connection) throw err;
      // no face stored -> fine
    }
  }
}

/** Human readable explanation for common terminal error codes. */
/** Face photo problems that retrying the same photo will not fix. */
function isPermanentFaceError(err) {
  const s = `${err && err.subStatusCode} ${err && err.message}`;
  return /faceQuality|lowScore|noFace|FaceImage|face.*(fail|invalid)|modelingFailed|picture|pictureSize|tooLarge|badImage|imageFormat/i.test(s);
}

/** Human readable explanation for common terminal error codes. */
function explainError(err) {
  const s = `${err && err.subStatusCode} ${err && err.message}`;
  if (/pictureSize|tooLarge|over.*size/i.test(s)) return 'Rasm hajmi terminal uchun juda katta';
  if (/faceQuality|lowScore|noFace|FaceImage|face.*(fail|invalid)|modelingFailed|picture|badImage/i.test(s)) {
    return 'Rasmda yuz aniq ko\'rinmayapti — yorug\', to\'g\'ridan olingan boshqa rasm yuklang';
  }
  if (/blokladi/i.test(s)) return err.message;
  if (/401|parol/i.test(s)) return 'Terminal login yoki paroli noto\'g\'ri';
  return (err && err.message) || String(err);
}

module.exports = { IsapiClient, IsapiError, explainError, isPermanentFaceError, parseChallenge };
