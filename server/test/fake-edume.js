'use strict';
/**
 * Minimal stand-in for Firebase Auth + Firestore REST as used by src/edume.js.
 * Documents are kept decoded: state.docs = Map('centers/c1/students/s1' -> { ...fields }).
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { encodeFields, decodeFields } = require('../src/edume');

function startFakeEdume({ email = 'faceid@edume.test', password = 'pw-123456', uid = 'dev1', apiKey = 'KEY', projectId = 'edume-test' } = {}) {
  const state = { docs: new Map(), deny: false, requests: [], signIns: 0 };
  const prefix = `/v1/projects/${projectId}/databases/(default)/documents/`;
  const json = (res, code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
  const docOut = (path) => ({ name: `projects/${projectId}/databases/(default)/documents/${path}`, fields: encodeFields(state.docs.get(path)) });
  const tokens = new Set();

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      state.requests.push(`${req.method} ${decodeURIComponent(url.pathname)}`);
      if (url.pathname === '/v1/accounts:signInWithPassword') {
        const b = JSON.parse(body);
        if (url.searchParams.get('key') !== apiKey || b.email !== email || b.password !== password) {
          return json(res, 400, { error: { code: 400, message: 'INVALID_LOGIN_CREDENTIALS' } });
        }
        state.signIns += 1;
        const t = crypto.randomUUID();
        tokens.add(t);
        return json(res, 200, { idToken: t, refreshToken: `r-${t}`, expiresIn: '3600', localId: uid });
      }
      if (url.pathname === '/v1/token') {
        const t = crypto.randomUUID();
        tokens.add(t);
        return json(res, 200, { id_token: t, refresh_token: `r-${t}`, expires_in: '3600', user_id: uid });
      }
      const auth = String(req.headers.authorization || '').replace('Bearer ', '');
      if (!tokens.has(auth)) return json(res, 401, { error: { code: 401, message: 'UNAUTHENTICATED' } });
      if (state.deny) return json(res, 403, { error: { code: 403, message: 'Missing or insufficient permissions.', status: 'PERMISSION_DENIED' } });
      const path = decodeURIComponent(url.pathname).slice(prefix.length);

      if (req.method === 'POST' && path.endsWith(':runQuery')) {
        const parent = path.slice(0, -':runQuery'.length);
        const q = JSON.parse(body).structuredQuery;
        const coll = `${parent}/${q.from[0].collectionId}/`;
        const w = q.where ? (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where]) : [];
        const conds = w.map((f) => [f.fieldFilter.field.fieldPath, decodeFields({ v: f.fieldFilter.value }).v]);
        const out = [...state.docs.keys()]
          .filter((k) => k.startsWith(coll) && !k.slice(coll.length).includes('/'))
          .filter((k) => conds.every(([f, v]) => state.docs.get(k)[f] === v))
          .map((k) => ({ document: docOut(k) }));
        return json(res, 200, out.length ? out : [{ readTime: new Date().toISOString() }]);
      }
      const segs = path.split('/');
      if (req.method === 'GET' && segs.length % 2 === 0) {
        if (!state.docs.has(path)) return json(res, 404, { error: { code: 404, message: 'not found', status: 'NOT_FOUND' } });
        return json(res, 200, docOut(path));
      }
      if (req.method === 'GET') {
        const coll = `${path}/`;
        const keys = [...state.docs.keys()].filter((k) => k.startsWith(coll) && !k.slice(coll.length).includes('/'));
        return json(res, 200, keys.length ? { documents: keys.map(docOut) } : {});
      }
      if (req.method === 'POST') {
        const id = crypto.randomBytes(6).toString('hex');
        state.docs.set(`${path}/${id}`, decodeFields(JSON.parse(body).fields));
        return json(res, 200, docOut(`${path}/${id}`));
      }
      if (req.method === 'PATCH') {
        if (!state.docs.has(path)) return json(res, 404, { error: { code: 404, message: 'not found' } });
        const mask = url.searchParams.getAll('updateMask.fieldPaths');
        const patch = decodeFields(JSON.parse(body).fields);
        const cur = state.docs.get(path);
        for (const k of mask) cur[k] = patch[k];
        return json(res, 200, docOut(path));
      }
      return json(res, 404, { error: { message: 'unknown' } });
    });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const code = Buffer.from(JSON.stringify({ apiKey, projectId, email, password })).toString('base64');
    resolve({ server, state, base, bases: { auth: base, token: base, firestore: base }, code, close: () => new Promise((r) => server.close(r)) });
  }));
}

module.exports = { startFakeEdume };
