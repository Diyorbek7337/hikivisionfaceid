'use strict';
/**
 * Parents (anyone):
 *   /start CODE or just the code — link to a student (the QR on the slip opens t.me/bot?start=CODE)
 *   /farzandlarim — linked children and whether they are at school now; /uzish — stop all messages
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
const { normCode } = require('./store');

const CODE_TRIES = 10; // wrong codes per chat per hour

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function createBotHandler({ store, cfg, telegram }) {
  const tz = cfg.timezone;
  const appUrl = /^https:\/\//.test(cfg.publicUrl || '') ? `${cfg.publicUrl}/tg/` : '';
  const list = (rows, fmt, empty) => (rows.length ? rows.slice(0, 60).map(fmt).join('\n') + (rows.length > 60 ? `\n… va yana ${rows.length - 60}` : '') : empty);

  const tries = new Map(); // chat -> { n, until }

  function linkByCode(msg, raw) {
    const chat = String(msg.chat.id);
    const t = tries.get(chat);
    if (t && t.n >= CODE_TRIES && t.until > Date.now()) return { text: 'Juda ko\'p noto\'g\'ri kod. Bir soatdan keyin urinib ko\'ring.' };
    const student = store.findStudentByCode(raw);
    if (!student) {
      if (!t || t.until < Date.now()) tries.set(chat, { n: 1, until: Date.now() + 3600 * 1000 });
      else t.n += 1;
      return { text: '❌ Bunday kod topilmadi. Varaqadagi 8 belgili kodni tekshirib, qayta yuboring (masalan: ABCD2345).' };
    }
    const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
    store.linkParent(student.id, chat, name);
    return {
      text: `✅ Ulandingiz: <b>${esc(student.name)}</b>${student.className ? ` (${esc(student.className)})` : ''}.\n\n`
        + 'Farzandingiz maktabga kelganda va chiqqanda shu yerga xabar keladi.\n'
        + 'Yana farzandingiz bo\'lsa — uning kodini ham yuboring.\n\n/farzandlarim — ro\'yxat, /uzish — xabarlarni to\'xtatish',
    };
  }

  function children(msg) {
    const kids = store.childrenOf(msg.chat.id);
    if (!kids.length) return { text: 'Hali hech kimga ulanmagansiz. Farzandingizning kodini yuboring (maktab bergan varaqada).' };
    const today = localDate(new Date(), tz);
    const rows = new Map(daySummary(store, today, tz).map((r) => [r.employee.id, r]));
    const line = (k) => {
      const r = rows.get(k.id);
      let st = '';
      if (r && r.inside) st = `🟢 maktabda (${localTime(r.attendance.checkIn, tz)} dan)`;
      else if (r && r.attendance && r.attendance.checkOut) st = `⚪ chiqib ketgan — ${localTime(r.attendance.checkOut, tz)}`;
      else if (r && r.status === 'absent') st = '🔴 bugun kelmagan';
      else st = '— bugun hali kelmagan';
      return `• <b>${esc(k.name)}</b>${k.className ? ` (${esc(k.className)})` : ''}: ${st}`;
    };
    return { text: `👨‍👩‍👧 <b>Farzandlaringiz</b>\n\n${kids.map(line).join('\n')}` };
  }

  return async function handle(msg) {
    if (msg.chat.type !== 'private' || !msg.from) return null;
    const text = msg.text.trim();
    const cmd = text.split(/[\s@]/)[0].toLowerCase();
    const arg = text.split(/\s+/)[1] || '';

    // ---- parents (anyone) ----
    if (cmd === '/start' && normCode(arg)) return linkByCode(msg, arg);
    if (!text.startsWith('/') && normCode(text)) return linkByCode(msg, text);
    if (cmd === '/farzandlarim') return children(msg);
    if (cmd === '/uzish') {
      const n = store.unlinkChat(msg.chat.id);
      return { text: n ? '🔕 Xabarlar to\'xtatildi. Qayta ulanish uchun farzandingiz kodini yuboring.' : 'Siz hech kimga ulanmagansiz.' };
    }

    const isViewer = viewers(store, cfg).has(String(msg.from.id));
    if (!isViewer) {
      if (cmd === '/start') {
        return {
          text: 'Assalomu alaykum!\n\n👨‍👩‍👧 <b>Ota-onalar:</b> farzandingizning <b>kodini</b> yuboring (maktab bergan varaqada, masalan ABCD2345) — '
            + 'u maktabga kelganda va chiqqanda xabar olasiz.\n\n'
            + `👔 <b>Xodimlar:</b> sizning chat ID: <code>${msg.chat.id}</code> — shu raqamni administratorga yuboring.`,
        };
      }
      return null;
    }
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
