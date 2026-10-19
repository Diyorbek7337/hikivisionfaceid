'use strict';
/** Minimal Telegram Bot API client (no extra dependencies). */

function createTelegram({ token, adminIds = [] }) {
  if (!token) {
    return { enabled: false, async send() {}, async notifyAdmins() {}, startPolling() {}, stop() {}, async call() {} };
  }
  const api = (method, body) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw Object.assign(new Error(data.description || `HTTP ${r.status}`), { code: data.error_code || r.status });
    return data.result;
  });

  let running = false;

  // Telegram allows ~30 messages a second per bot: hundreds of children arriving at 8:00 go out one by one,
  // ~20 a second, and a "Too Many Requests" answer waits as long as Telegram asks.
  let queue = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function send(chatId, text, extra = {}) {
    const job = queue.then(async () => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const r = await api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
          await sleep(50);
          return r;
        } catch (err) {
          const wait = /retry after (\d+)/i.exec(err.message);
          if (wait && attempt < 3) { await sleep((Number(wait[1]) + 1) * 1000); continue; }
          throw err;
        }
      }
    });
    queue = job.catch(() => {});
    return job;
  }

  async function notifyAdmins(text) {
    for (const id of adminIds) {
      try { await send(id, text); } catch (err) { console.error(`Telegram admin ${id}:`, err.message); }
    }
  }

  /**
   * Answers messages. `handle(msg)` may return { text, extra } (e.g. the mini app button for viewers);
   * otherwise /start and /id reply with the user's chat ID so the admin can paste it into the employee card.
   */
  async function startPolling(handle) {
    running = true;
    let offset = 0;
    while (running) {
      try {
        const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg || !msg.chat || typeof msg.text !== 'string') continue;
          let reply = null;
          if (handle) {
            try { reply = await handle(msg); } catch (e) { console.error('Telegram:', e.message); }
          }
          if (reply) {
            await send(msg.chat.id, reply.text, reply.extra).catch((e) => console.error('Telegram:', e.message));
          } else if (msg.text.startsWith('/start') || msg.text.startsWith('/id')) {
            await send(msg.chat.id, `Assalomu alaykum!\n\nSizning chat ID: <code>${msg.chat.id}</code>\n\nShu raqamni administratorga yuboring — u sizni davomat tizimiga ulaydi.`)
              .catch((e) => console.error('Telegram:', e.message));
          }
        }
      } catch (err) {
        console.error('Telegram polling xatosi:', err.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  return { enabled: true, send, notifyAdmins, startPolling, stop() { running = false; }, call: api };
}

module.exports = { createTelegram };
