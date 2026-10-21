'use strict';
/**
 * Edume CRM (Firebase) client over the public REST APIs — no service-account key on the school PC.
 *
 * The CRM creates a "device" account for its centre (role: 'device' in users/{uid}). Its Firestore rules
 * let that account only read the centre's students / groups / settings and write attendance.
 * We sign in with that account's email + password and act with its ID token.
 */

const DEFAULT_BASES = {
  auth: 'https://identitytoolkit.googleapis.com',
  token: 'https://securetoken.googleapis.com',
  firestore: 'https://firestore.googleapis.com',
};

class EdumeError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------- Firestore value encoding ----------
function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  return { stringValue: String(v) };
}
function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = encode(v);
  return out;
}
function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('nullValue' in v) return null;
  if ('referenceValue' in v) return v.referenceValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decode(v);
  return out;
}
/** Firestore document -> { id, ...fields } */
function fromDoc(doc) {
  return { id: doc.name.split('/').pop(), ...decodeFields(doc.fields) };
}

/** Connection code shown by the CRM: base64 JSON { apiKey, projectId, email, password, centerId?, centerName? } */
function parseConnectionCode(code) {
  let data;
  try {
    data = JSON.parse(Buffer.from(String(code || '').trim(), 'base64').toString('utf8'));
  } catch {
    throw new EdumeError('Ulanish kodi noto\'g\'ri — Edume sozlamalaridan kodni to\'liq nusxalang');
  }
  for (const k of ['apiKey', 'projectId', 'email', 'password']) {
    if (!data || typeof data[k] !== 'string' || !data[k]) throw new EdumeError('Ulanish kodi to\'liq emas — qayta nusxalang');
  }
  return {
    apiKey: data.apiKey, projectId: data.projectId, email: data.email, password: data.password,
    centerId: data.centerId || '', centerName: data.centerName || '',
  };
}

class EdumeClient {
  /**
   * @param {object} cfg { apiKey, projectId, email, password }
   * @param {object} [opts] { bases, fetch } — for tests
   */
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.bases = { ...DEFAULT_BASES, ...(opts.bases || {}) };
    this.fetch = opts.fetch || fetch;
    this.session = null; // { idToken, refreshToken, uid, expiresAt }
  }

  async http(url, init, what) {
    let res;
    try {
      res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
    } catch (err) {
      throw new EdumeError(`Edume bilan aloqa yo'q (internet?): ${err.message}`, { code: 'network' });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error.status)) || `HTTP ${res.status}`;
      if (res.status === 403 || /PERMISSION_DENIED/.test(msg)) {
        throw new EdumeError(`Edume ruxsat bermadi (${what}). Qurilma akkaunti o'chirilgan yoki Edume qoidalari yangilanmagan bo'lishi mumkin`, { status: 403, code: 'denied' });
      }
      if (/INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_LOGIN_CREDENTIALS|USER_DISABLED/.test(msg)) {
        throw new EdumeError('Edume qurilma akkaunti logini yoki paroli noto\'g\'ri (akkaunt o\'chirilgan bo\'lishi mumkin)', { status: res.status, code: 'auth' });
      }
      throw new EdumeError(`Edume xatosi (${what}): ${msg}`, { status: res.status });
    }
    return data;
  }

  async signIn() {
    const d = await this.http(`${this.bases.auth}/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.cfg.apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: this.cfg.email, password: this.cfg.password, returnSecureToken: true }),
    }, 'kirish');
    this.session = { idToken: d.idToken, refreshToken: d.refreshToken, uid: d.localId, expiresAt: Date.now() + (Number(d.expiresIn) || 3600) * 1000 };
    return this.session;
  }

  async token() {
    if (this.session && this.session.expiresAt - Date.now() > 5 * 60 * 1000) return this.session.idToken;
    if (this.session && this.session.refreshToken) {
      try {
        const d = await this.http(`${this.bases.token}/v1/token?key=${encodeURIComponent(this.cfg.apiKey)}`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(this.session.refreshToken)}`,
        }, 'token');
        this.session = { idToken: d.id_token, refreshToken: d.refresh_token, uid: d.user_id, expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
        return this.session.idToken;
      } catch (err) {
        if (err.code === 'network') throw err;
        // refresh token revoked: sign in again below
      }
    }
    await this.signIn();
    return this.session.idToken;
  }

  docsUrl(path) {
    return `${this.bases.firestore}/v1/projects/${encodeURIComponent(this.cfg.projectId)}/databases/(default)/documents${path ? `/${path}` : ''}`;
  }

  async authed(url, init = {}, what = '') {
    const token = await this.token();
    return this.http(url, { ...init, headers: { ...(init.headers || {}), authorization: `Bearer ${token}` } }, what);
  }

  async getDoc(path) {
    try {
      return fromDoc(await this.authed(this.docsUrl(path), {}, path));
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async listAll(collectionPath) {
    const out = [];
    let pageToken = '';
    for (let i = 0; i < 100; i += 1) {
      const d = await this.authed(`${this.docsUrl(collectionPath)}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`, {}, collectionPath);
      for (const doc of (d && d.documents) || []) out.push(fromDoc(doc));
      pageToken = d && d.nextPageToken;
      if (!pageToken) break;
    }
    return out;
  }

  /** Equality query in a sub-collection of `parentPath`: where { field: value, ... } */
  async query(parentPath, collectionId, where) {
    const filters = Object.entries(where).map(([field, value]) => ({
      fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) },
    }));
    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        ...(filters.length ? { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {}),
      },
    };
    const d = await this.authed(`${this.docsUrl(parentPath)}:runQuery`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, collectionId);
    return (d || []).filter((r) => r.document).map((r) => fromDoc(r.document));
  }

  async create(collectionPath, data) {
    return fromDoc(await this.authed(this.docsUrl(collectionPath), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(data) }),
    }, collectionPath));
  }

  /** Updates only the given fields. */
  async update(docPath, data) {
    const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
    return fromDoc(await this.authed(`${this.docsUrl(docPath)}?${mask}&currentDocument.exists=true`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: encodeFields(data) }),
    }, docPath));
  }
}

module.exports = { EdumeClient, EdumeError, parseConnectionCode, encode, decode, encodeFields, decodeFields, fromDoc };
