'use strict';
/** Daily Telegram summary for the director / admins: who came, who is late, who is absent. */
const { localDate, localTime, formatDuration, parseHHMM, localMinutes } = require('./time');
const { daySummary } = require('./summary');

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildDailyReport(store, date, tz) {
  const rows = daySummary(store, date, tz);
  const working = rows.filter((r) => r.status !== 'off');
  if (!working.length) return null; // day off for everybody
  const late = rows.filter((r) => r.status === 'late');
  const absent = rows.filter((r) => r.status === 'absent');
  const came = rows.filter((r) => r.status === 'present' || r.status === 'late');
  const org = store.settings.organizationName ? `${esc(store.settings.organizationName)}\n` : '';
  let text = `📊 <b>${org}Davomat — ${date}</b>\n\n✅ Kelgan: ${came.length} / ${working.length}\n⏰ Kechikkan: ${late.length}\n❌ Kelmagan: ${absent.length}\n`;
  const list = (title, items, fmt) => {
    if (!items.length) return '';
    const shown = items.slice(0, 40).map(fmt).join('\n');
    return `\n<b>${title}:</b>\n${shown}${items.length > 40 ? `\n… va yana ${items.length - 40} kishi` : ''}\n`;
  };
  text += list('Kechikkanlar', late, (r) => `• ${esc(r.employee.name)} — ${localTime(r.attendance.checkIn, tz)} (${formatDuration(r.attendance.lateMinutes)})`);
  text += list('Kelmaganlar', absent, (r) => `• ${esc(r.employee.name)}`);
  return text;
}

/** Checks every minute whether it is time to send today's report. */
function startDailyReport({ store, telegram, tz, log = console }) {
  let sentFor = null;
  const tick = async () => {
    const s = store.settings;
    if (!telegram.enabled || !s.dailyReportEnabled) return;
    const now = new Date();
    const date = localDate(now, tz);
    const at = parseHHMM(s.dailyReportTime);
    if (sentFor === date || at == null || localMinutes(now, tz) < at || localMinutes(now, tz) > at + 30) return;
    sentFor = date;
    const text = buildDailyReport(store, date, tz);
    if (!text) return;
    await telegram.notifyAdmins(text);
    log.log(`📨 Kunlik hisobot yuborildi (${date})`);
  };
  const timer = setInterval(() => tick().catch((e) => log.error('Kunlik hisobot:', e.message)), 60 * 1000);
  timer.unref();
  return { tick, stop: () => clearInterval(timer) };
}

module.exports = { buildDailyReport, startDailyReport };
