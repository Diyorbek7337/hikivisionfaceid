'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { createAuth } = require('../src/auth');
const { createApi } = require('../src/api');
const { createServer } = require('../src/server');
const { createTgApi, checkInitData } = require('../src/tgapp');
const { createBotHandler } = require('../src/bot');

const BOT = '123456:TEST-token';
const quiet = { log() {}, warn() {}, error() {} };

/** initData exactly as Telegram builds it for a mini app */
function initData(user, { token = BOT, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAH', user: JSON.stringify(user) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

test('initData signature and age are checked', () => {
  const u = { id: 555, first_name: 'Direktor' };
  assert.equal(checkInitData(initData(u), BOT).id, 555);
  assert.equal(checkInitData(initData(u, { token: '999:other' }), BOT), null, 'signed for another bot');
  assert.equal(checkInitData(initData(u, { authDate: Math.floor(Date.now() / 1000) - 3 * 86400 }), BOT), null, 'too old');
  const forged = initData(u).replace(encodeURIComponent('"id":555'), encodeURIComponent('"id":777'));
  assert.equal(checkInitData(forged, BOT), null, 'changed user');
  assert.equal(checkInitData('', BOT), null);
  assert.equal(checkInitData('hash=zz', BOT), null);
});

async function setup() {
  const store = new LocalStore(openDatabase(':memory:'));
  const cfg = { timezone: 'Asia/Tashkent', port: 3000, webDir: '/nonexistent', botToken: BOT, adminTelegramIds: ['111'], publicUrl: 'https://maktab.example.ts.net' };
  const auth = createAuth({ store, secret: 's' });
  const api = createApi({ store, auth, cfg, sync: { schedule() {} }, backup: {}, clientFor: () => null, version: 't' });
  const tgApi = createTgApi({ store, cfg, secret: 's' });
  const app = createServer({ store, cfg, api, tgApi, telegram: null, log: quiet });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = server.address().port;
  // node:http, because fetch does not let a test set the Host header
  const http = require('node:http');
  const call = (method, path, { body, token, host } = {}) => new Promise((resolve, reject) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (host) headers.host = host;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        const json = (res.headers['content-type'] || '').includes('json');
        resolve({ status: res.statusCode, body: json ? JSON.parse(text) : text });
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
  return { store, server, call };
}

test('mini app: only listed Telegram users, read-only data, removal works at once', async (t) => {
  const { store, server, call } = await setup();
  t.after(() => server.close());
  store.createEmployee({ name: 'Aziz' });

  const stranger = await call('POST', '/api/tg/login', { body: { initData: initData({ id: 999, first_name: 'X' }) } });
  assert.equal(stranger.status, 403);
  assert.match(stranger.body.error, /999/);
  assert.equal((await call('POST', '/api/tg/login', { body: { initData: 'user=1&hash=00' } })).status, 401);

  // admin from ADMIN_TELEGRAM_IDS
  const admin = await call('POST', '/api/tg/login', { body: { initData: initData({ id: 111, first_name: 'Admin' }) } });
  assert.equal(admin.status, 200);
  const today = await call('GET', '/api/tg/today', { token: admin.body.token });
  assert.equal(today.status, 200);
  assert.equal(today.body.rows[0].name, 'Aziz');
  const rep = await call('GET', '/api/tg/report', { token: admin.body.token });
  assert.ok(Array.isArray(rep.body.summary[0].absentDates));
  assert.equal((await call('GET', '/api/tg/report?from=2026-01-01&to=2026-12-31', { token: admin.body.token })).status, 400);
  assert.equal((await call('GET', '/api/tg/today')).status, 401);
  assert.equal((await call('GET', '/api/tg/today', { token: 'bad.token' })).status, 401);

  // HR added in Sozlamalar, then removed
  store.saveSettings({ telegramViewers: [{ id: '222', name: 'HR' }] });
  const hr = await call('POST', '/api/tg/login', { body: { initData: initData({ id: 222, first_name: 'HR' }) } });
  assert.equal(hr.status, 200);
  store.saveSettings({ telegramViewers: [] });
  assert.equal((await call('GET', '/api/tg/today', { token: hr.body.token })).status, 401);
  // the mini app token is not an admin session
  assert.equal((await call('GET', '/api/employees', { token: admin.body.token })).status, 401);
});

test('through the public address only the mini app is reachable', async (t) => {
  const { server, call } = await setup();
  t.after(() => server.close());
  const host = 'maktab.example.ts.net';
  for (const p of ['/api/session', '/api/employees', '/', '/employees/', '/health', '/api/setup']) {
    assert.equal((await call(p === '/api/setup' ? 'POST' : 'GET', p, { host })).status, 404, p);
  }
  assert.equal((await call('POST', '/hik/x/event', { host })).status, 404, 'terminal pushes are local only');
  assert.notEqual((await call('POST', '/api/tg/login', { host, body: {} })).status, 404);
  // a tunnel that forwards with another Host is recognised by its headers
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/session`, { headers: { 'cf-connecting-ip': '1.2.3.4' } });
  assert.equal(r.status, 404);
  // local network: admin panel works as before
  assert.equal((await call('GET', '/api/session')).status, 200);
});

test('bot: viewers get the mini app button and quick summaries, others are ignored', async () => {
  const store = new LocalStore(openDatabase(':memory:'));
  const calls = [];
  const cfg = { timezone: 'Asia/Tashkent', adminTelegramIds: ['111'], publicUrl: 'https://maktab.example.ts.net' };
  const handle = createBotHandler({ store, cfg, telegram: { call: async (m, b) => calls.push([m, b]) } });
  const msg = (id, text) => ({ chat: { id, type: 'private' }, from: { id }, text });
  const start = await handle(msg(111, '/start'));
  assert.equal(start.extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://maktab.example.ts.net/tg/');
  assert.equal(calls[0][0], 'setChatMenuButton');
  assert.equal(await handle(msg(999, '/start')), null, 'stranger: default chat-ID reply');
  store.createEmployee({ name: 'Aziz' });
  assert.match((await handle(msg(111, '/kelmaganlar'))).text, /Kelmaganlar/);
  assert.match((await handle(msg(111, '/kechikkanlar'))).text, /Kechikkan yo'q/);
  assert.ok((await handle(msg(111, '/bugun'))).text);
});
