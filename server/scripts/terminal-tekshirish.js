'use strict';
/* Terminal bilan aloqani tekshirish: node scripts/terminal-tekshirish.js IP LOGIN PAROL */
const { IsapiClient } = require('../src/isapi');

async function main() {
  const [ip, username = 'admin', password = ''] = process.argv.slice(2);
  if (!ip) {
    console.log('Ishlatish: node scripts/terminal-tekshirish.js 192.168.31.68 admin PAROL');
    process.exit(1);
  }
  console.log(`\n== ${ip} ==`);
  try {
    const raw = await fetch(`http://${ip}/ISAPI/System/deviceInfo`, { signal: AbortSignal.timeout(8000) });
    console.log(`Loginsiz so'rov: HTTP ${raw.status}; WWW-Authenticate: ${raw.headers.get('www-authenticate') || '(yo\'q)'}`);
    await raw.arrayBuffer();
  } catch (e) {
    console.log(`❌ Terminalga ulanib bo'lmadi: ${(e.cause && e.cause.code) || e.message}`);
    process.exit(1);
  }
  const c = new IsapiClient({ host: ip, username, password });
  const step = async (name, fn) => {
    try {
      const r = await fn();
      console.log(`✅ ${name}: ${typeof r === 'object' ? JSON.stringify(r) : r}`);
    } catch (e) {
      console.log(`❌ ${name}: ${e.message}${e.detail ? `\n   ${e.detail}` : ''}`);
    }
  };
  await step('Qurilma', () => c.deviceInfo());
  await step('Soat', async () => (await c.getTime()).localTime);
  await step('Xodimlar soni', () => c.countUsers());
  await step('Parallel so\'rovlar', async () => (await Promise.all([c.deviceInfo(), c.getTime(), c.deviceInfo(), c.getTime()])).length + ' ta OK');
}
main();
