'use client';
import { useState } from 'react';
import { api, useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { classList } from '@/lib/people';
import { localDateTime } from '@/lib/time';

export default function Settings() {
  const { status, reloadStatus, user } = useApp();
  const [form, setForm] = useState(status.settings);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    setError('');
    try {
      // the phone viewers list is saved by its own card
      const { telegramViewers: _v, ...body } = form;
      await api('/settings', { method: 'PUT', body });
      setMsg('Saqlandi');
      reloadStatus();
      setTimeout(() => setMsg(''), 2000);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <h1>Sozlamalar</h1>
      {error && <div className="flash error">{error}</div>}
      <form className="card" onSubmit={save}>
        <h2>Umumiy</h2>
        <div className="grid">
          <label>Tashkilot nomi<input value={form.organizationName || ''} onChange={set('organizationName')} maxLength={100} /></label>
          <label>Kechikish hisoblanmaydigan vaqt (daqiqa)<input type="number" min="0" value={form.lateGraceMinutes} onChange={set('lateGraceMinutes')} /></label>
          <label>Takroriy skanlarni e&apos;tiborsiz qoldirish (soniya)<input type="number" min="0" value={form.debounceSeconds} onChange={set('debounceSeconds')} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.autoTimeSync} onChange={set('autoTimeSync')} /> Terminallar soatini avtomatik to&apos;g&apos;rilash
          </label>
        </div>
        <h2 style={{ marginTop: 16 }}>Telegram kunlik hisobot</h2>
        {!status.telegram && <p className="warn">Telegram bot sozlanmagan — <code>server\.env</code> faylida <code>BOT_TOKEN</code> va <code>ADMIN_TELEGRAM_IDS</code> ni kiriting (README).</p>}
        <div className="grid">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={!!form.dailyReportEnabled} onChange={set('dailyReportEnabled')} /> Har kuni hisobot yuborish
          </label>
          <label>Yuborish vaqti<input type="time" value={form.dailyReportTime} onChange={set('dailyReportTime')} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={form.parentNotifications !== false} onChange={set('parentNotifications')} /> Ota-onalarga farzandi kelganda / chiqqanda xabar yuborish
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button>Saqlash</button> <span className="ok">{msg}</span></div>
      </form>

      <Crm />

      <Viewers status={status} reloadStatus={reloadStatus} />

      <Users me={user} />

      <div className="card">
        <h2>Zaxira nusxa</h2>
        <p>Baza har kuni avtomatik nusxalanadi (<code>server\data\backups</code>, oxirgi 30 kun). Qo&apos;shimcha nusxani fleshkaga saqlab qo&apos;yish tavsiya etiladi.</p>
        <a className="btn secondary" href="/api/backup">💾 Hozirgi bazani yuklab olish</a>
      </div>

      <div className="card">
        <h2>Tizim</h2>
        <p>
          Server: <b>{status.hostname}</b> · versiya {status.version}<br />
          Tarmoqdagi manzil: {(status.ips || []).map((ip) => <code key={ip} style={{ marginRight: 6 }}>http://{ip}:{status.port}</code>)}<br />
          <span className="hint">Shu manzil orqali maktab tarmog&apos;idagi boshqa kompyuter yoki telefondan ham kirish mumkin.</span>
        </p>
      </div>
    </>
  );
}

function Users({ me }) {
  const { data: users, reload } = useApi('/users');
  const { data: people } = useApi('/employees');
  const [form, setForm] = useState({ username: '', name: '', password: '', role: 'admin', classes: '' });
  const [rights, setRights] = useState(null);
  const classes = classList(people);
  const [error, setError] = useState('');

  async function add(e) {
    e.preventDefault();
    setError('');
    try {
      await api('/users', { method: 'POST', body: form });
      setForm({ username: '', name: '', password: '', role: 'admin', classes: '' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changePassword(u) {
    const p = prompt(`${u.username} uchun yangi parol (kamida 6 belgi):`);
    if (!p) return;
    if (prompt('Yangi parolni yana bir marta kiriting:') !== p) { alert('Parollar bir xil emas'); return; }
    try {
      await api(`/users/${u.id}/password`, { method: 'PUT', body: { password: p } });
      alert('Parol o\'zgartirildi');
    } catch (err) {
      alert(err.message);
    }
  }

  async function remove(u) {
    if (!confirm(`${u.username} o'chirilsinmi?`)) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Foydalanuvchilar</h2>
      {error && <div className="flash error">{error}</div>}
      <table>
        <thead><tr><th>Login</th><th>Ism</th><th>Huquq</th><th></th></tr></thead>
        <tbody>
          {(users || []).map((u) => (
            <tr key={u.id}>
              <td>{u.username} {u.id === me.id && <span className="pill muted">siz</span>}</td><td>{u.name}</td>
              <td>{u.role === 'teacher' ? <>Sinf rahbari: <b>{u.classes.join(', ')}</b></> : 'Administrator'}</td>
              <td className="row">
                {u.id !== me.id && <button className="secondary small" onClick={() => setRights({ ...u, classes: u.classes.join(', ') })}>Huquq</button>}
                <button className="secondary small" onClick={() => changePassword(u)}>Parolni o&apos;zgartirish</button>
                {u.id !== me.id && <button className="secondary small" onClick={() => remove(u)}>O&apos;chirish</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="row" style={{ marginTop: 12 }} onSubmit={add}>
        <label>Login<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></label>
        <label>Ism<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Parol<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required /></label>
        <label>Huquq<select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="admin">Administrator (hamma narsa)</option>
          <option value="teacher">Sinf rahbari (faqat o&apos;z sinfi)</option>
        </select></label>
        {form.role === 'teacher' && <ClassesInput value={form.classes} onChange={(v) => setForm({ ...form, classes: v })} classes={classes} />}
        <button>+ Qo&apos;shish</button>
      </form>
      <p className="hint">Sinf rahbari faqat o&apos;z sinfi o&apos;quvchilarini ko&apos;radi: yuzini kiritadi, davomatini ko&apos;radi. Xodimlar, terminallar,
        sozlamalar va davomatni o&apos;zgartirish unga yopiq.</p>
      {rights && <RightsForm user={rights} classes={classes} onClose={(changed) => { setRights(null); if (changed) reload(); }} />}
    </div>
  );
}

/** Telegram users who may open the read-only mini app (director, HR). */
function Viewers({ status, reloadStatus }) {
  const list = status.settings.telegramViewers || [];
  const [form, setForm] = useState({ id: '', name: '' });
  const [error, setError] = useState('');
  async function saveList(next) {
    setError('');
    try {
      await api('/settings', { method: 'PUT', body: { telegramViewers: next } });
      reloadStatus();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }
  async function add(e) {
    e.preventDefault();
    if (await saveList([...list, { id: form.id.trim(), name: form.name.trim() }])) setForm({ id: '', name: '' });
  }
  return (
    <div className="card">
      <h2>📱 Telefondan ko&apos;ruvchilar (Telegram)</h2>
      <p className="muted">Rahbar yoki HR davomatni Telegram bot ichidagi ilovada ko&apos;radi (faqat ko&apos;rish — hech narsani o&apos;zgartira olmaydi).
        Odam botga <code>/start</code> yozsa, bot uning ID raqamini aytadi — shu raqamni bu yerga kiriting.
        <code>ADMIN_TELEGRAM_IDS</code> dagi adminlar avtomatik ruxsatga ega.</p>
      {!status.telegram && <p className="warn">Telegram bot sozlanmagan (<code>BOT_TOKEN</code>).</p>}
      {status.telegram && !status.publicUrl && (
        <p className="warn">Ilova uchun serverning internet manzili (<code>PUBLIC_URL</code>) kiritilmagan — hozircha bot faqat /bugun, /kelmaganlar,
          /kechikkanlar buyruqlariga javob beradi. Sozlash: README → &quot;Telefondan ko&apos;rish&quot;.</p>
      )}
      {status.publicUrl && <p className="hint">Ilova manzili: <code>{status.publicUrl}/tg/</code> — botda /start → &quot;📊 Davomatni ochish&quot;.</p>}
      {error && <div className="flash error">{error}</div>}
      <table>
        <thead><tr><th>Telegram ID</th><th>Kim</th><th></th></tr></thead>
        <tbody>
          {(status.adminTelegramIds || []).map((id) => <tr key={`a${id}`}><td><code>{id}</code></td><td className="muted">Administrator (.env)</td><td></td></tr>)}
          {list.map((v) => (
            <tr key={v.id}>
              <td><code>{v.id}</code></td><td>{v.name}</td>
              <td><button className="secondary small" onClick={() => confirm(`${v.name || v.id} ruxsatdan olib tashlansinmi?`) && saveList(list.filter((x) => x.id !== v.id))}>Olib tashlash</button></td>
            </tr>
          ))}
          {!list.length && !(status.adminTelegramIds || []).length && <tr><td colSpan={3} className="muted">Hali hech kim yo&apos;q</td></tr>}
        </tbody>
      </table>
      <form className="row" style={{ marginTop: 12 }} onSubmit={add}>
        <label>Telegram ID<input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} inputMode="numeric" placeholder="123456789" required /></label>
        <label>Kim<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Direktor, HR…" maxLength={60} /></label>
        <button>+ Qo&apos;shish</button>
      </form>
    </div>
  );
}

/** "9-A, 9-B" with suggestions from the existing classes. */
function ClassesInput({ value, onChange, classes }) {
  return (
    <label>Sinflari (vergul bilan)<input value={value} onChange={(e) => onChange(e.target.value)} list="all-classes" placeholder="9-A, 9-B" required />
      <datalist id="all-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist></label>
  );
}

function RightsForm({ user, classes, onClose }) {
  const [f, setF] = useState({ name: user.name || '', role: user.role, classes: user.classes });
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    try {
      await api(`/users/${user.id}`, { method: 'PUT', body: f });
      onClose(true);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div className="modal-back" onClick={() => onClose(false)}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save} style={{ maxWidth: 420 }}>
        <h2>{user.username} — huquq</h2>
        {error && <div className="flash error">{error}</div>}
        <p><label>Ism<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label></p>
        <p><label>Huquq<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="admin">Administrator (hamma narsa)</option>
          <option value="teacher">Sinf rahbari (faqat o&apos;z sinfi)</option>
        </select></label></p>
        {f.role === 'teacher' && <p><ClassesInput value={f.classes} onChange={(v) => setF({ ...f, classes: v })} classes={classes} /></p>}
        <p className="hint">Saqlangach, bu foydalanuvchi qayta kiradi (yangi huquq darhol ishlaydi).</p>
        <div className="row"><button>Saqlash</button><button type="button" className="secondary" onClick={() => onClose(false)}>Bekor qilish</button></div>
      </form>
    </div>
  );
}

/** Edume CRM: connect with the code from Edume → Sozlamalar → "Face ID qurilmasi". */
function Crm() {
  const { data, reload, error } = useApi('/crm');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const run = async (what, fn) => {
    setBusy(what); setErr('');
    try { await fn(); await reload(); } catch (e) { setErr(e.message); }
    setBusy('');
  };
  const connect = (e) => { e.preventDefault(); run('connect', async () => { await api('/crm', { method: 'PUT', body: { code } }); setCode(''); }); };
  const option = (body) => run('opt', () => api('/crm/options', { method: 'PUT', body }));
  const st = data || {};
  return (
    <div className="card">
      <h2>🔗 Edume CRM</h2>
      {error && <div className="flash error">{error.message}</div>}
      {err && <div className="flash error">{err}</div>}
      {!st.connected ? (
        <>
          <p className="muted">O&apos;quv markazi Edume&apos;dan foydalansa: o&apos;quvchilar va guruhlar Edume&apos;dan avtomatik olinadi, yuz ko&apos;rsatilganda
            Edume&apos;dagi darsga &quot;keldi / kechikdi&quot; yoziladi, dars tugagach kelmaganlar belgilanadi va ota-onaga Edume boti orqali xabar boradi.</p>
          <ol className="steps">
            <li>Edume → Sozlamalar → <b>Face ID qurilmasi</b> → &quot;Qurilma yaratish&quot; (direktor).</li>
            <li>Chiqqan <b>ulanish kodini</b> nusxalab, shu yerga qo&apos;ying.</li>
          </ol>
          <form className="row" onSubmit={connect}>
            <label style={{ flex: 1 }}>Ulanish kodi<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="eyJhcGlLZXkiOi…" required /></label>
            <button disabled={!!busy}>{busy === 'connect' ? 'Ulanmoqda…' : 'Ulash'}</button>
          </form>
        </>
      ) : (
        <>
          <p>✅ Ulangan: <b>{st.centerName || st.centerId}</b>
            {st.lastSync && <span className="muted"> · oxirgi sinxronlash: {localDateTime(st.lastSync)}</span>}</p>
          {st.lastError && <p className="bad">⚠️ {st.lastError}</p>}
          <p>Guruhlar: <b>{st.groups}</b> · o&apos;quvchilar: <b>{st.students}</b> (yuzi bor: {st.withFace})
            {!st.parentBot && <span className="warn"> · Edume&apos;da Telegram bot sozlanmagan — ota-onalarga xabar bormaydi</span>}</p>
          <div className="grid">
            <label className="inline"><input type="checkbox" checked={st.autoAbsent} onChange={(e) => option({ autoAbsent: e.target.checked })} />
              Dars tugagach kelmaganlarga &quot;absent&quot; qo&apos;yish</label>
            <label>… dars tugagandan necha daqiqa keyin
              <input type="number" min="0" max="240" defaultValue={st.absentAfterMinutes} onBlur={(e) => option({ absentAfterMinutes: e.target.value })} /></label>
            <label className="inline"><input type="checkbox" checked={st.parentMessages} onChange={(e) => option({ parentMessages: e.target.checked })} />
              Ota-onaga Edume boti orqali &quot;keldi / ketdi&quot; xabari</label>
          </div>
          <p className="hint">&quot;Absent&quot; faqat yuzi kiritilgan o&apos;quvchilarga va faqat o&apos;sha kuni terminallar ishlagan bo&apos;lsa qo&apos;yiladi.
            O&apos;qituvchi Edume&apos;da istalgan belgini o&apos;zgartira oladi. O&apos;quvchilar ro&apos;yxati Edume&apos;da boshqariladi (har 10 daqiqada yangilanadi).</p>
          <div className="row">
            <button className="secondary" disabled={!!busy} onClick={() => run('sync', () => api('/crm/sync', { method: 'POST' }))}>
              {busy === 'sync' ? 'Sinxronlanmoqda…' : '🔄 Hozir sinxronlash'}</button>
            <button className="secondary" disabled={!!busy} style={{ marginLeft: 'auto' }}
              onClick={() => confirm('Edume bilan aloqa uzilsinmi? O\'quvchilar tizimda qoladi, lekin Edume bilan yangilanmaydi.') && run('off', () => api('/crm', { method: 'DELETE' }))}>Uzish</button>
          </div>
        </>
      )}
    </div>
  );
}
