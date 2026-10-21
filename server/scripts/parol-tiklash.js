'use strict';
/**
 * Forgotten password: sets a new password for a web-app user. Runs only on the server PC (needs the database file),
 * so whoever can run it already has the data. Usage: node scripts/parol-tiklash.js [login] [new password]
 */
const path = require('node:path');
const readline = require('node:readline/promises');
const { loadEnvFile } = require('../src/env');

loadEnvFile();
const { loadConfig } = require('../src/config');
const { openDatabase } = require('../src/db');
const { LocalStore } = require('../src/store');
const { hashPassword } = require('../src/auth');

async function main() {
  const cfg = loadConfig();
  const store = new LocalStore(openDatabase(cfg.dbPath));
  const users = store.listUsers();
  if (!users.length) {
    console.log('Hali foydalanuvchi yo\'q — tizimni ochib, administrator yarating.');
    return;
  }
  console.log(`Baza: ${path.resolve(cfg.dbPath)}\nFoydalanuvchilar:`);
  for (const u of users) console.log(`  - ${u.username}${u.name ? ` (${u.name})` : ''} — ${u.role === 'teacher' ? 'sinf rahbari' : 'administrator'}`);
  const rl = readline.createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); return r.done ? '' : r.value; };
  let username = process.argv[2];
  let password = process.argv[3];
  if (!username) username = (await ask('\nQaysi login uchun yangi parol (Enter = birinchisi)? ')).trim() || users[0].username;
  const user = store.getUserByName(username);
  if (!user) { rl.close(); console.log(`"${username}" topilmadi.`); process.exitCode = 1; return; }
  if (!password) password = await ask('Yangi parol (kamida 6 belgi): ');
  rl.close();
  if (String(password).length < 6) { console.log('Parol kamida 6 belgi bo\'lsin.'); process.exitCode = 1; return; }
  store.setUserPassword(user.id, hashPassword(password));
  console.log(`\n✅ "${user.username}" uchun yangi parol o'rnatildi. Endi shu login va yangi parol bilan kiring.`);
}

main().catch((err) => { console.error('Xato:', err.message); process.exitCode = 1; });
