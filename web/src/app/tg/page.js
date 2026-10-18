'use client';
/**
 * Telegram mini app for the director / HR: read-only "today" and "report" views.
 * Opened from the bot; phone layout = cards, wide screen (Telegram Desktop) = tables.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, formatDuration, localTime, normText, setTimezone } from '@/lib/time';

const STATUS = {
  present: ['Keldi', 'ok'],
  late: ['Kechikdi', 'warn'],
  absent: ['Kelmagan', 'bad'],
  pending: ['Kutilmoqda', 'muted'],
  off: ['Dam olish', 'muted'],
  free: ['Erkin', 'muted'],
};
const WEEKDAY = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
const weekday = (d) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];

function loadTelegramScript() {
  return new Promise((resolve) => {
    if (window.Telegram && window.Telegram.WebApp) return resolve(window.Telegram.WebApp);
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-web-app.js';
    s.onload = () => resolve(window.Telegram && window.Telegram.WebApp);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
    return undefined;
  });
}

export default function MiniApp() {
  const [auth, setAuth] = useState(null); // { token, name, organizationName, today }
  const [error, setError] = useState('');
  const [tab, setTab] = useState('today');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wa = await loadTelegramScript();
      if (cancelled) return;
      if (!wa || !wa.initData) {
        setError('Bu sahifa Telegram bot orqali ochiladi: botga /start yozib, "Davomatni ochish" tugmasini bosing.');
        return;
      }
      wa.ready();
      wa.expand();
      try {
        const r = await fetch('/api/tg/login', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: wa.initData }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Xato (HTTP ${r.status})`);
        setTimezone(data.timezone);
        setAuth(data);
      } catch (e) {
        setError(e.message === 'Failed to fetch' ? 'Server bilan aloqa yo\'q. Maktabdagi kompyuter yoqilganmi?' : e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const get = useCallback(async (path) => {
    const r = await fetch(`/api/tg${path}`, { headers: { authorization: `Bearer ${auth.token}` } });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) throw new Error('Kirish muddati tugadi — ilovani yopib, qayta oching.');
    if (!r.ok) throw new Error(data.error || `Xato (HTTP ${r.status})`);
    return data;
  }, [auth]);

  if (error) return <div className="tg"><div className="tg-card tg-msg">⚠️ {error}</div></div>;
  if (!auth) return <div className="tg"><p className="tg-muted tg-msg">Yuklanmoqda…</p></div>;

  return (
    <div className="tg">
      <header className="tg-head">
        <div className="tg-title">📊 {auth.organizationName || 'Davomat'}</div>
        <div className="tg-tabs">
          <button className={tab === 'today' ? 'on' : ''} onClick={() => setTab('today')}>Kunlik</button>
          <button className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>Hisobot</button>
        </div>
      </header>
      {tab === 'today' ? <Today get={get} today={auth.today} /> : <Report get={get} today={auth.today} />}
    </div>
  );
}

function Today({ get, today }) {
  const [date, setDate] = useState(today);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(() => get(`/today?date=${date}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message)), [get, date]);
  useEffect(() => {
    setData(null);
    load();
    if (date !== today) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => clearInterval(t);
  }, [load, date, today]);

  const rows = useMemo(() => (data ? data.rows : []), [data]);
  const count = (f) => rows.filter(f).length;
  const FILTERS = [
    ['all', 'Jami', (r) => !['off', 'free'].includes(r.status) || r.checkIn || r.checkOut, ''],
    ['came', 'Kelgan', (r) => r.status === 'present' || r.status === 'late', 'ok'],
    ['late', 'Kechikkan', (r) => r.status === 'late', 'warn'],
    ['absent', 'Kelmagan', (r) => r.status === 'absent', 'bad'],
    ['inside', 'Ichkarida', (r) => r.inside, ''],
  ];
  const active = FILTERS.find((f) => f[0] === filter) || FILTERS[0];
  const shown = rows.filter(active[2]).filter((r) => !q || normText(`${r.name} ${r.position}`).includes(normText(q)));

  return (
    <>
      <div className="tg-bar">
        <button className="tg-icon" onClick={() => setDate(addDays(date, -1))} aria-label="Oldingi kun">‹</button>
        <label className="tg-date">
          <span>{date === today ? 'Bugun' : weekday(date)}</span>
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <button className="tg-icon" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Keyingi kun">›</button>
      </div>
      {error && <div className="tg-card tg-err">{error}</div>}
      <div className="tg-stats">
        {FILTERS.map(([key, label, f, cls]) => (
          <button key={key} className={`tg-stat ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
            <b className={cls}>{data ? count(f) : '…'}</b><span>{label}</span>
          </button>
        ))}
      </div>
      <input className="tg-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Ism yoki lavozim" />
      {data && !shown.length && <p className="tg-muted tg-msg">{filter === 'absent' ? 'Kelmagan yo\'q 👍' : filter === 'late' ? 'Kechikkan yo\'q 👍' : 'Hech kim yo\'q'}</p>}

      {/* phone: cards */}
      <div className="tg-list only-narrow">
        {shown.map((r) => (
          <div key={r.id} className="tg-row">
            <div className="tg-row-main">
              <div className="tg-name">{r.name}</div>
              <div className="tg-muted tg-small">{r.position}{r.hours ? `${r.position ? ' · ' : ''}${r.hours.start}–${r.hours.end}` : ''}</div>
            </div>
            <div className="tg-row-side">
              <StatusPill r={r} />
              <div className="tg-small">{times(r)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* wide screen (Telegram Desktop): table */}
      {shown.length > 0 && (
        <table className="tg-table only-wide">
          <thead><tr><th>Xodim</th><th>Lavozim</th><th>Ish vaqti</th><th>Keldi</th><th>Ketdi</th><th>Ishlagan</th><th>Holat</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td className="tg-muted">{r.position}</td>
                <td>{r.hours ? `${r.hours.start}–${r.hours.end}` : <span className="tg-muted">{r.flexible ? 'erkin' : '—'}</span>}</td>
                <td>{localTime(r.checkIn)}</td>
                <td>{r.inside ? <span className="tg-pill ok">ichkarida</span> : localTime(r.checkOut)}</td>
                <td>{r.workedMinutes != null ? formatDuration(r.workedMinutes) : ''}{r.visits > 1 && <span className="tg-muted"> ({r.visits} marta)</span>}</td>
                <td><StatusPill r={r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function times(r) {
  if (!r.checkIn && !r.checkOut) return '';
  const out = r.inside ? 'ichkarida' : localTime(r.checkOut) || '…';
  return `${localTime(r.checkIn) || '?'} – ${out}`;
}

function StatusPill({ r }) {
  const [label, cls] = STATUS[r.status] || [r.status, 'muted'];
  return <span className={`tg-pill ${cls}`}>{r.status === 'late' ? `Kechikdi ${formatDuration(r.lateMinutes)}` : label}</span>;
}

function monthStart(d) { return `${d.slice(0, 8)}01`; }

function Report({ get, today }) {
  const presets = useMemo(() => {
    const lastMonthEnd = addDays(monthStart(today), -1);
    const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
    return [
      ['week', 'Shu hafta', addDays(today, -dow), today],
      ['month', 'Shu oy', monthStart(today), today],
      ['prev', 'O\'tgan oy', monthStart(lastMonthEnd), lastMonthEnd],
    ];
  }, [today]);
  const [range, setRange] = useState({ key: 'month', from: monthStart(today), to: today });
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('absent');
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    setData(null);
    get(`/report?from=${range.from}&to=${range.to}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [get, range]);

  const all = data ? data.summary : [];
  const FILTERS = [
    ['absent', 'Kelmaganlar', (s) => s.absentDays > 0, (a, b) => b.absentDays - a.absentDays || b.lateCount - a.lateCount],
    ['late', 'Kechikkanlar', (s) => s.lateCount > 0, (a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes],
    ['all', 'Hammasi', () => true, (a, b) => a.name.localeCompare(b.name)],
  ];
  const active = FILTERS.find((f) => f[0] === filter);
  const shown = all.filter(active[2]).filter((s) => !q || normText(`${s.name} ${s.position}`).includes(normText(q))).sort(active[3]);
  const totals = { absent: all.reduce((n, s) => n + s.absentDays, 0), late: all.reduce((n, s) => n + s.lateCount, 0) };

  return (
    <>
      <div className="tg-chips">
        {presets.map(([key, label, from, to]) => (
          <button key={key} className={range.key === key ? 'on' : ''} onClick={() => setRange({ key, from, to })}>{label}</button>
        ))}
      </div>
      <div className="tg-bar tg-range">
        <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, key: '', from: e.target.value }))} />
        <span>—</span>
        <input type="date" value={range.to} max={today} onChange={(e) => e.target.value && setRange((r) => ({ ...r, key: '', to: e.target.value }))} />
      </div>
      {error && <div className="tg-card tg-err">{error}</div>}
      <div className="tg-stats">
        {FILTERS.map(([key, label]) => (
          <button key={key} className={`tg-stat ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>
            <b className={key === 'absent' ? 'bad' : key === 'late' ? 'warn' : ''}>
              {!data ? '…' : key === 'absent' ? totals.absent : key === 'late' ? totals.late : all.length}
            </b>
            <span>{key === 'absent' ? 'kun kelmagan' : key === 'late' ? 'marta kechikkan' : 'xodim'}</span>
            <span className="tg-small">{label}</span>
          </button>
        ))}
      </div>
      <input className="tg-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Ism yoki lavozim" />
      {data && !shown.length && <p className="tg-muted tg-msg">{filter === 'absent' ? 'Bu davrda kelmagan kun yo\'q 👍' : filter === 'late' ? 'Bu davrda kechikish yo\'q 👍' : 'Xodim yo\'q'}</p>}
      <div className="tg-list tg-report">
        <div className="tg-row tg-row-head only-wide">
          <div className="tg-row-main">Xodim</div>
          <div className="tg-num">Ish kunlari</div><div className="tg-num">Kelgan</div><div className="tg-num">Kelmagan</div>
          <div className="tg-num">Kechikish</div><div className="tg-num">Ishlagan</div>
        </div>
        {shown.map((s) => (
          <div key={s.id}>
            <button className={`tg-row tg-click ${open === s.id ? 'open' : ''}`} onClick={() => setOpen(open === s.id ? null : s.id)}>
              <div className="tg-row-main">
                <div className="tg-name">{s.name}</div>
                <div className="tg-muted tg-small only-narrow">
                  {s.flexible ? 'erkin jadval · ' : ''}kelgan {s.presentDays}{s.flexible ? '' : `/${s.workDays}`} kun · {formatDuration(s.workedMinutes)}
                </div>
              </div>
              <div className="tg-num only-wide">{s.flexible ? 'erkin' : s.workDays}</div>
              <div className="tg-num only-wide">{s.presentDays}</div>
              <div className={`tg-num ${s.absentDays ? 'bad' : 'tg-muted'}`}><span className="only-narrow">❌ </span>{s.absentDays}</div>
              <div className={`tg-num ${s.lateCount ? 'warn' : 'tg-muted'}`}><span className="only-narrow">⏰ </span>{s.lateCount}
                {s.lateMinutes > 0 && <span className="tg-small"> ({formatDuration(s.lateMinutes)})</span>}</div>
              <div className="tg-num only-wide">{formatDuration(s.workedMinutes)}</div>
            </button>
            {open === s.id && <Details s={s} />}
          </div>
        ))}
      </div>
    </>
  );
}

function Details({ s }) {
  return (
    <div className="tg-details">
      <div>
        <b className="bad">Kelmagan kunlar ({s.absentDays})</b>
        {s.absentDates.length ? <ul>{s.absentDates.map((d) => <li key={d}>{d} <span className="tg-muted">{weekday(d)}</span></li>)}</ul>
          : <p className="tg-muted">yo&apos;q</p>}
      </div>
      <div>
        <b className="warn">Kechikishlar ({s.lateCount})</b>
        {s.lateDates.length ? (
          <ul>{s.lateDates.map((l) => (
            <li key={l.date}>{l.date} <span className="tg-muted">{weekday(l.date)}</span> — {localTime(l.checkIn)} ({formatDuration(l.minutes)})</li>
          ))}</ul>
        ) : <p className="tg-muted">yo&apos;q</p>}
      </div>
    </div>
  );
}
