'use strict';
const { localTime, formatDuration } = require('../time');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CSS = `
:root{--bg:#f5f6f8;--card:#fff;--text:#1d2330;--muted:#6b7280;--line:#e5e7eb;--brand:#2563eb;--ok:#15803d;--warn:#b45309;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--card:#1a1d24;--text:#e7e9ee;--muted:#9aa1ad;--line:#2a2f3a;--brand:#60a5fa;--ok:#4ade80;--warn:#fbbf24;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
header{background:var(--card);border-bottom:1px solid var(--line)}
.nav{max-width:1100px;margin:auto;padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.nav b{margin-right:auto}.nav a.active{font-weight:600;text-decoration:underline}
main{max-width:1100px;margin:auto;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin-bottom:16px;overflow-x:auto}
h1{font-size:22px;margin:4px 0 16px}h2{font-size:17px;margin:0 0 12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);white-space:nowrap}
th{font-size:13px;color:var(--muted);font-weight:600}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.stat .n{font-size:28px;font-weight:700}.stat .l{color:var(--muted);font-size:13px}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--bad)}.muted{color:var(--muted)}
form.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
label{display:block;font-size:13px;color:var(--muted)}
input,select{width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
input[type=checkbox]{width:auto}
button,.btn{display:inline-block;padding:8px 14px;border-radius:8px;border:1px solid var(--brand);background:var(--brand);color:#fff;font:inherit;cursor:pointer}
.btn.secondary,button.secondary{background:transparent;color:var(--brand)}button.danger{background:var(--bad);border-color:var(--bad)}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:end}
code{background:var(--bg);border:1px solid var(--line);padding:2px 6px;border-radius:6px;word-break:break-all}
.flash{padding:10px 14px;border-radius:8px;margin-bottom:16px;background:var(--card);border:1px solid var(--line)}
.flash.error{border-color:var(--bad);color:var(--bad)}
`;

function layout({ title, body, active = '', flash = null }) {
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Davomat</title>
<style>${CSS}</style></head><body>
<header><div class="nav"><b>📷 Davomat</b>
${link('/admin', 'Bugun', 'dashboard')}${link('/admin/attendance', 'Hisobot', 'attendance')}
${link('/admin/employees', 'Xodimlar', 'employees')}${link('/admin/devices', 'Terminallar', 'devices')}
${link('/admin/events', 'Eventlar', 'events')}
<form method="post" action="/admin/logout" style="margin:0"><button class="secondary">Chiqish</button></form>
</div></header><main>
${flash ? `<div class="flash ${flash.type === 'error' ? 'error' : ''}">${esc(flash.text)}</div>` : ''}
${body}</main></body></html>`;
}

function loginPage(error) {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Kirish — Davomat</title>
<style>${CSS}</style></head><body><main style="max-width:380px;padding-top:80px">
<div class="card"><h1>📷 Davomat</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<form method="post" action="/admin/login">
<p><label>Login<input name="username" autocomplete="username" required></label></p>
<p><label>Parol<input name="password" type="password" autocomplete="current-password" required></label></p>
<button style="width:100%">Kirish</button></form></div></main></body></html>`;
}

const fmtTime = (iso, tz) => (iso ? localTime(new Date(iso), tz) : '');
const money = (n) => new Intl.NumberFormat('en-US').format(Math.round(n || 0));

function dashboardPage({ date, rows, tz, devices }) {
  const came = rows.filter((r) => r.att && r.att.check_in_at).length;
  const late = rows.filter((r) => r.att && r.att.late_minutes > 0).length;
  const left = rows.filter((r) => r.att && r.att.check_out_at).length;
  const body = `<h1>Bugun — ${esc(date)}</h1>
<div class="stats">
<div class="stat"><div class="n">${rows.length}</div><div class="l">Jami xodimlar</div></div>
<div class="stat"><div class="n ok">${came}</div><div class="l">Kelgan</div></div>
<div class="stat"><div class="n warn">${late}</div><div class="l">Kechikkan</div></div>
<div class="stat"><div class="n bad">${rows.length - came}</div><div class="l">Kelmagan</div></div>
<div class="stat"><div class="n">${left}</div><div class="l">Ketgan</div></div>
</div>
<div class="card"><table><thead><tr><th>Xodim</th><th>ID</th><th>Ish vaqti</th><th>Keldi</th><th>Ketdi</th><th>Holat</th></tr></thead><tbody>
${rows.map(({ emp, att }) => {
    let status = '<span class="bad">Kelmagan</span>';
    if (att && att.check_in_at) {
      status = att.late_minutes > 0
        ? `<span class="warn">Kechikdi: ${formatDuration(att.late_minutes)}</span>`
        : '<span class="ok">O\'z vaqtida</span>';
    } else if (att && att.check_out_at) status = '<span class="warn">Faqat chiqish</span>';
    return `<tr><td>${esc(emp.name)}</td><td>${esc(emp.employee_no)}</td><td>${esc(emp.work_start)}–${esc(emp.work_end)}</td>
<td>${fmtTime(att && att.check_in_at, tz)}</td><td>${fmtTime(att && att.check_out_at, tz)}</td><td>${status}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">Hali xodim qo\'shilmagan. <a href="/admin/employees/new">Xodim qo\'shish</a></td></tr>'}
</tbody></table></div>
<div class="card"><h2>Terminallar</h2><table><thead><tr><th>Nomi</th><th>Yo'nalish</th><th>Oxirgi aloqa</th></tr></thead><tbody>
${devices.map((d) => `<tr><td>${esc(d.name)}</td><td>${directionLabel(d.direction)}</td><td>${lastSeen(d, tz)}</td></tr>`).join('')
  || '<tr><td colspan="3" class="muted">Terminal qo\'shilmagan. <a href="/admin/devices/new">Terminal qo\'shish</a></td></tr>'}
</tbody></table></div>`;
  return layout({ title: 'Bugun', body, active: 'dashboard' });
}

function directionLabel(d) {
  return { in: '➡️ Kirish', out: '⬅️ Chiqish', auto: '🔁 Avtomatik' }[d] || esc(d);
}

function lastSeen(d, tz) {
  if (!d.last_seen_at) return '<span class="muted">Hali ulanmagan</span>';
  const t = new Date(d.last_seen_at);
  const ageMin = (Date.now() - t) / 60000;
  const cls = ageMin < 10 ? 'ok' : 'warn';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(t);
  return `<span class="${cls}">${esc(day)} ${localTime(t, tz)}</span>`;
}

function employeesPage({ employees }) {
  const body = `<div class="row" style="justify-content:space-between"><h1>Xodimlar</h1>
<a class="btn" href="/admin/employees/new">+ Xodim qo'shish</a></div>
<div class="card"><table><thead><tr><th>Ism</th><th>Terminal ID</th><th>Lavozim</th><th>Ish vaqti</th><th>Soatbay (so'm)</th><th>Telegram</th><th>Holat</th><th></th></tr></thead><tbody>
${employees.map((e) => `<tr><td>${esc(e.name)}</td><td><code>${esc(e.employee_no)}</code></td><td>${esc(e.position || '')}</td>
<td>${esc(e.work_start)}–${esc(e.work_end)}</td><td>${money(e.hourly_rate)}</td>
<td>${e.telegram_chat_id ? '✅' : '<span class="muted">—</span>'}</td>
<td>${e.active ? '<span class="ok">Faol</span>' : '<span class="muted">Nofaol</span>'}</td>
<td><a href="/admin/employees/${e.id}">Tahrirlash</a></td></tr>`).join('')
  || '<tr><td colspan="8" class="muted">Hali xodim yo\'q</td></tr>'}
</tbody></table></div>`;
  return layout({ title: 'Xodimlar', body, active: 'employees' });
}

function employeeFormPage({ employee, error }) {
  const e = employee;
  const v = (k, d = '') => esc(e[k] ?? d);
  const body = `<h1>${e.id ? 'Xodimni tahrirlash' : 'Yangi xodim'}</h1>
${error ? `<div class="flash error">${esc(error)}</div>` : ''}
<div class="card"><form method="post" action="/admin/employees/${e.id || 'new'}" class="grid">
<label>Ism familiya *<input name="name" value="${v('name')}" required></label>
<label>Terminal ID (Employee No) *<input name="employee_no" value="${v('employee_no')}" required></label>
<label>Lavozim<input name="position" value="${v('position')}"></label>
<label>Telefon<input name="phone" value="${v('phone')}"></label>
<label>Ish boshlanishi *<input name="work_start" type="time" value="${v('work_start', '09:00')}" required></label>
<label>Ish tugashi *<input name="work_end" type="time" value="${v('work_end', '18:00')}" required></label>
<label>Soatbay stavka (so'm)<input name="hourly_rate" type="number" min="0" step="1" value="${v('hourly_rate', 0)}"></label>
<label>Telegram chat ID<input name="telegram_chat_id" value="${v('telegram_chat_id')}" placeholder="Bot /start da ko'rsatadi"></label>
<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" value="1" ${e.active === 0 ? '' : 'checked'}> Faol</label>
<div class="row" style="grid-column:1/-1"><button>Saqlash</button><a class="btn secondary" href="/admin/employees">Bekor qilish</a></div>
</form></div>
<div class="card muted">⚠️ <b>Terminal ID</b> ikkala terminaldagi <b>Employee No</b> bilan aynan bir xil bo'lishi shart (masalan <code>001</code>).</div>
${e.id ? `<div class="card"><form method="post" action="/admin/employees/${e.id}/delete" onsubmit="return confirm('Xodim va uning barcha davomat yozuvlari o\\'chiriladi. Davom etasizmi?')">
<button class="danger">Xodimni o'chirish</button> <span class="muted">Odatda o'chirish o'rniga "Faol" belgisini olib tashlang — tarix saqlanib qoladi.</span></form></div>` : ''}`;
  return layout({ title: 'Xodim', body, active: 'employees' });
}

function devicesPage({ devices, publicUrl, tz }) {
  const host = publicUrl ? new URL(publicUrl) : null;
  const body = `<div class="row" style="justify-content:space-between"><h1>Terminallar</h1>
<a class="btn" href="/admin/devices/new">+ Terminal qo'shish</a></div>
${devices.map((d) => `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(d.name)} — ${directionLabel(d.direction)}</h2>
<a href="/admin/devices/${d.id}">Tahrirlash</a></div>
<p>Oxirgi aloqa: ${lastSeen(d, tz)}${d.last_ip ? ` · Lokal IP: <code>${esc(d.last_ip)}</code>` : ''}${d.last_skew_sec != null && Math.abs(d.last_skew_sec) > 120 ? ` · <span class="bad">Terminal soati ${Math.round(d.last_skew_sec / 60)} daqiqa farq qilmoqda — vaqtni to'g'rilang!</span>` : ''}</p>
<p><b>Terminalga kiritiladigan sozlamalar</b> (Configuration → Network → Advanced → HTTP Listening):</p>
<table><tbody>
<tr><th>Destination IP / Domain</th><td><code>${esc(host ? host.hostname : 'SERVER_IP_YOKI_DOMEN')}</code></td></tr>
<tr><th>URL</th><td><code>/hik/${esc(d.token)}/event</code></td></tr>
<tr><th>Port</th><td><code>${esc(host ? (host.port || (host.protocol === 'https:' ? '443' : '80')) : '80')}</code></td></tr>
<tr><th>Protocol</th><td><code>${esc(host ? host.protocol.replace(':', '').toUpperCase() : 'HTTP')}</code></td></tr>
</tbody></table></div>`).join('') || '<div class="card muted">Hali terminal qo\'shilmagan.</div>'}
${publicUrl ? '' : '<div class="card warn">⚠️ <code>PUBLIC_URL</code> sozlanmagan — .env faylida server manzilini kiriting.</div>'}`;
  return layout({ title: 'Terminallar', body, active: 'devices' });
}

function deviceFormPage({ device }) {
  const d = device;
  const opt = (val, label) => `<option value="${val}" ${d.direction === val ? 'selected' : ''}>${label}</option>`;
  const body = `<h1>${d.id ? 'Terminalni tahrirlash' : 'Yangi terminal'}</h1>
<div class="card"><form method="post" action="/admin/devices/${d.id || 'new'}" class="grid">
<label>Nomi *<input name="name" value="${esc(d.name || '')}" placeholder="Masalan: Kirish eshigi" required></label>
<label>Yo'nalish<select name="direction">
${opt('in', 'Kirish — har skan "keldi"')}${opt('out', 'Chiqish — har skan "ketdi"')}${opt('auto', 'Avtomatik — 1-skan keldi, keyingilari ketdi')}
</select></label>
<div class="row" style="grid-column:1/-1"><button>Saqlash</button><a class="btn secondary" href="/admin/devices">Bekor qilish</a></div>
</form></div>
${d.id ? `<div class="card row">
<form method="post" action="/admin/devices/${d.id}/token" onsubmit="return confirm('Eski URL ishlamay qoladi. Terminalda URL ni yangilashingiz kerak bo\\'ladi.')"><button class="secondary">Yangi URL yaratish</button></form>
<form method="post" action="/admin/devices/${d.id}/delete" onsubmit="return confirm('Terminal o\\'chirilsinmi?')"><button class="danger">O'chirish</button></form>
</div>` : ''}`;
  return layout({ title: 'Terminal', body, active: 'devices' });
}

function attendancePage({ from, to, employeeId, employees, records, summary, tz }) {
  const body = `<h1>Davomat hisoboti</h1>
<div class="card"><form method="get" class="row">
<label>Dan<input type="date" name="from" value="${esc(from)}"></label>
<label>Gacha<input type="date" name="to" value="${esc(to)}"></label>
<label>Xodim<select name="employee"><option value="">Hammasi</option>
${employees.map((e) => `<option value="${e.id}" ${String(e.id) === String(employeeId || '') ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
</select></label>
<button>Ko'rsatish</button>
<a class="btn secondary" href="/admin/attendance.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&employee=${encodeURIComponent(employeeId || '')}">Excel (CSV) yuklab olish</a>
</form></div>
<div class="card"><h2>Jami</h2><table><thead><tr><th>Xodim</th><th>Kelgan kunlar</th><th>Kechikishlar</th><th>Jami kechikish</th><th>Ishlagan</th><th>Summa (so'm)</th></tr></thead><tbody>
${summary.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.days}</td><td>${s.lateCount}</td><td>${formatDuration(s.lateMinutes)}</td>
<td>${formatDuration(s.workedMinutes)}</td><td>${money(s.pay)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Ma\'lumot yo\'q</td></tr>'}
</tbody></table></div>
<div class="card"><h2>Kunlar bo'yicha</h2><table><thead><tr><th>Sana</th><th>Xodim</th><th>Keldi</th><th>Ketdi</th><th>Kechikish</th><th>Erta ketish</th><th>Ishlagan</th><th></th></tr></thead><tbody>
${records.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.employee_name)}</td>
<td>${fmtTime(r.check_in_at, tz) || '<span class="muted">—</span>'}</td><td>${fmtTime(r.check_out_at, tz) || '<span class="muted">—</span>'}</td>
<td>${r.late_minutes ? `<span class="warn">${formatDuration(r.late_minutes)}</span>` : ''}</td>
<td>${r.early_minutes ? `<span class="warn">${formatDuration(r.early_minutes)}</span>` : ''}</td>
<td>${r.worked_minutes != null ? formatDuration(r.worked_minutes) : ''}</td>
<td><form method="post" action="/admin/attendance/${r.id}/delete" style="margin:0" onsubmit="return confirm('Yozuv o\\'chirilsinmi?')"><button class="secondary" style="padding:2px 8px">✕</button></form></td></tr>`).join('')
  || '<tr><td colspan="8" class="muted">Ma\'lumot yo\'q</td></tr>'}
</tbody></table></div>`;
  return layout({ title: 'Hisobot', body, active: 'attendance' });
}

const ACTION_LABELS = {
  checkin: '<span class="ok">Keldi</span>',
  checkout: '<span class="ok">Ketdi</span>',
  duplicate: '<span class="muted">Takroriy skan</span>',
  repeat_in: '<span class="muted">Qayta kirish</span>',
  unknown_employee: '<span class="bad">Xodim topilmadi</span>',
  inactive_employee: '<span class="muted">Nofaol xodim</span>',
  not_recognized: '<span class="muted">Tanilmadi / boshqa event</span>',
  resent: '<span class="muted">Qayta yuborilgan</span>',
  unparsed: '<span class="bad">O\'qib bo\'lmadi</span>',
  error: '<span class="bad">Xato</span>',
};

function eventsPage({ events, tz }) {
  const body = `<h1>Oxirgi eventlar</h1>
<p class="muted">Terminallardan kelgan so'nggi 200 ta event. Sozlashda tekshirish uchun qulay.</p>
<div class="card"><table><thead><tr><th>Qabul qilindi</th><th>Terminal</th><th>Event vaqti</th><th>Employee No</th><th>Ism</th><th>Kod</th><th>Natija</th></tr></thead><tbody>
${events.map((e) => `<tr><td>${esc(new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(e.received_at)))} ${localTime(new Date(e.received_at), tz)}</td>
<td>${esc(e.device_name || '')}</td><td>${e.event_time ? localTime(new Date(e.event_time), tz) : ''}</td>
<td>${e.employee_no ? `<code>${esc(e.employee_no)}</code>` : ''}</td><td>${esc(e.person_name || '')}</td>
<td class="muted">${e.major != null ? `${e.major}/${e.minor}` : esc(e.event_type || '')}</td>
<td>${ACTION_LABELS[e.action] || esc(e.action)}${e.action === 'unknown_employee' && e.employee_no
    ? ` · <a href="/admin/employees/new?employee_no=${encodeURIComponent(e.employee_no)}&name=${encodeURIComponent(e.person_name || '')}">Qo'shish</a>` : ''}</td></tr>`).join('')
  || '<tr><td colspan="7" class="muted">Hali event kelmagan</td></tr>'}
</tbody></table></div>`;
  return layout({ title: 'Eventlar', body, active: 'events' });
}

module.exports = {
  esc, layout, loginPage, dashboardPage, employeesPage, employeeFormPage,
  devicesPage, deviceFormPage, attendancePage, eventsPage,
};
