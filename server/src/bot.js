'use strict';
/**
 * Bot commands for the director / HR (people on the viewers list):
 *   /start         — button that opens the mini app (and sets it as the chat's menu button)
 *   /bugun         — today's summary
 *   /kelmaganlar   — who has not come today
 *   /kechikkanlar  — who was late today
 * Anyone else gets the usual reply with their chat ID.
 */
const { viewers } = require('./tgapp');
const { buildDailyReport, studentsLine } = require('./report');
const { daySummary } = require('./summary');
const { localDate, localTime, formatDuration } = require('./time');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function createBotHandler({ store, cfg, telegram }) {
  const tz = cfg.timezone;
  const appUrl = /^https:\/\//.test(cfg.publicUrl || '') ? `${cfg.publicUrl}/tg/` : '';
  const list = (rows, fmt, empty) => (rows.length ? rows.slice(0, 60).map(fmt).join('\n') + (rows.length > 60 ? `\n… va yana ${rows.length - 60}` : '') : empty);

  return async function handle(msg) {
    if (msg.chat.type !== 'private' || !msg.from) return null;
    if (!viewers(store, cfg).has(String(msg.from.id))) return null;
    const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
    const today = localDate(new Date(), tz);

    if (cmd === '/start' || cmd === '/menu') {
      if (!appUrl) {
        return { text: 'Assalomu alaykum! Mini ilova hali sozlanmagan (serverda PUBLIC_URL).\n\nBuyruqlar: /bugun, /kelmaganlar, /kechikkanlar' };
      }
      await telegram.call('setChatMenuButton', {
        chat_id: msg.chat.id, menu_button: { type: 'web_app', text: 'Davomat', web_app: { url: appUrl } },
      }).catch((e) => console.error('Telegram menyu tugmasi:', e.message));
      return {
        text: 'Assalomu alaykum! Davomatni ko\'rish uchun pastdagi tugmani bosing (yoki chap pastdagi "Davomat" menyusini).\n\nTez buyruqlar: /bugun, /kelmaganlar, /kechikkanlar',
        extra: { reply_markup: { inline_keyboard: [[{ text: '📊 Davomatni ochish', web_app: { url: appUrl } }]] } },
      };
    }
    if (cmd === '/bugun') {
      return { text: buildDailyReport(store, today, tz) || `📊 ${today}: bugun ishda bo'lishi kerak bo'lgan xodim yo'q (dam olish kuni).` };
    }
    if (cmd === '/kelmaganlar' || cmd === '/kechikkanlar') {
      const all = daySummary(store, today, tz);
      const staff = all.filter((r) => r.employee.kind !== 'student');
      const students = studentsLine(all.filter((r) => r.employee.kind === 'student'));
      const more = students ? `\n${students}(o'quvchilar ro'yxati — mini ilovada, sinflar bo'yicha)` : '';
      if (cmd === '/kelmaganlar') {
        const rows = staff.filter((r) => r.status === 'absent');
        return { text: `❌ <b>Kelmagan xodimlar — ${today}</b> (${rows.length})\n\n${list(rows, (r) => `• ${esc(r.employee.name)}${r.hours ? ` (${r.hours.start} dan)` : ''}`, 'Hamma kelgan 👍')}${more}` };
      }
      const rows = staff.filter((r) => r.status === 'late');
      return { text: `⏰ <b>Kechikkan xodimlar — ${today}</b> (${rows.length})\n\n${list(rows,
        (r) => `• ${esc(r.employee.name)} — ${localTime(r.attendance.checkIn, tz)} (${formatDuration(r.attendance.lateMinutes)})`, 'Kechikkan yo\'q 👍')}${more}` };
    }
    return null;
  };
}

module.exports = { createBotHandler };
