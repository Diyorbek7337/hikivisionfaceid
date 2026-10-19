'use strict';
/**
 * Parents: each student has a code (printed on a slip with a QR link to the bot). A parent who sends it
 * to the bot gets a message when the child enters or leaves the school.
 */
const { localTime, formatDuration } = require('./time');

const NOTIFY_MAX_AGE_MS = 15 * 60 * 1000; // a terminal's late backlog is not announced
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function parentMessage(student, result, tz) {
  const who = `<b>${esc(student.name)}</b>${student.className ? ` (${esc(student.className)})` : ''}`;
  const time = localTime(result.time, tz);
  if (result.action === 'checkin') {
    if (result.firstOfDay === false) return `🔁 Farzandingiz ${who} maktabga qaytib keldi — ${time}`;
    let text = `✅ Farzandingiz ${who} maktabga keldi — ${time}`;
    if (result.record && result.record.lateMinutes > 0) text += `\n⏰ ${formatDuration(result.record.lateMinutes)} kechikdi`;
    return text;
  }
  return `👋 Farzandingiz ${who} maktabdan chiqdi — ${time}`;
}

/** Sends the arrival / departure message to the student's parents. Never throws. */
async function notifyParents({ store, telegram, tz, log = console }, result) {
  try {
    if (!telegram || !telegram.enabled || !store.settings.parentNotifications) return;
    const { action, employee, time } = result;
    if (!employee || employee.kind !== 'student' || (action !== 'checkin' && action !== 'checkout')) return;
    if (!time || Math.abs(Date.now() - time.getTime()) > NOTIFY_MAX_AGE_MS) return;
    const chats = store.parentChats(employee.id);
    if (!chats.length) return;
    const text = parentMessage(employee, result, tz);
    await Promise.all(chats.map((chat) => telegram.send(chat, text).catch((err) => {
      // The parent blocked the bot or deleted the chat: stop sending there.
      if (err.code === 403) {
        store.unlinkChat(chat);
        log.log(`ℹ️  Ota-ona boti bloklangan — ulanish o'chirildi (chat ${chat})`);
      } else {
        log.error('Telegram (ota-ona):', err.message);
      }
    })));
  } catch (err) {
    log.error('Ota-onaga xabar:', err.message);
  }
}

module.exports = { notifyParents, parentMessage };
