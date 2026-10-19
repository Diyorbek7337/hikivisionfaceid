'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { readSheet } from 'read-excel-file/browser';
import { api, useApi } from '@/lib/api';
import { scheduleSummary } from '@/components/ui';

// Header words in Uzbek (Latin and Cyrillic) and Russian.
const GUESS = {
  last: /f\.?\s*i\.?\s*sh|ф\.?\s*и\.?\s*[шо]|fio|familiya|фамили|ism.*familiya|full\s*name/i,
  first: /^(ism|ismi|исм|исми|имя|name|first\s*name)$/i,
  middle: /otasining|sharif|отчеств|шариф|middle/i,
  position: /lavozim|должност|лавозим|position/i,
  phone: /telefon|тел|phone/i,
  className: /^(sinf|sinfi|синф|синфи|класс|class)$/i,
};

function guessColumns(headers) {
  const m = { last: '', first: '', middle: '', position: '', phone: '', className: '' };
  headers.forEach((t, i) => {
    for (const [k, re] of Object.entries(GUESS)) if (m[k] === '' && re.test(t)) { m[k] = String(i); break; }
  });
  if (m.last === '' && m.first !== '') { m.last = m.first; m.first = ''; }
  return m;
}

/** The header row: the first of the top rows with a recognisable name column; else the first row with 2+ cells. */
function guessHeaderRow(data) {
  const top = data.slice(0, 20);
  const byName = top.findIndex((r) => r.some((c) => GUESS.last.test(c) || GUESS.first.test(c)));
  if (byName !== -1) return byName;
  const any = top.findIndex((r) => r.filter(Boolean).length >= 2);
  return any === -1 ? 0 : any;
}

const FOOTER = /^(jami|итого|всего|жами|imzo|direktor)/i;

const clean = (v) => (v == null ? '' : String(v).trim());

export default function ImportPage() {
  const router = useRouter();
  const { data: schedules } = useApi('/schedules');
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({ last: '', first: '', middle: '', position: '', phone: '', className: '' });
  const [kind, setKind] = useState('staff');
  const [oneClass, setOneClass] = useState('');
  const students = kind === 'student';
  useEffect(() => { if (new URLSearchParams(window.location.search).get('kind') === 'student') setKind('student'); }, []);
  const [scheduleId, setScheduleId] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError(''); setResult(null);
    try {
      const data = (await readSheet(f)).map((r) => r.map(clean));
      const hi = guessHeaderRow(data);
      const m = guessColumns(data[hi] || []);
      setRows(data); setHeaderRow(hi); setMap(m); setFileName(f.name);
    } catch (err) {
      setRows(null);
      setError('Faylni o\'qib bo\'lmadi. Fayl .xlsx formatida bo\'lishi kerak: Excel\'da faylni oching → "Сохранить как / Save as" → "Книга Excel (.xlsx)".');
    }
  }

  const headers = rows ? rows[headerRow] || [] : [];
  const people = useMemo(() => {
    if (!rows || map.last === '') return [];
    return rows.slice(headerRow + 1).map((r) => {
      const name = ['last', 'first', 'middle'].map((k) => (map[k] === '' ? '' : r[Number(map[k])])).filter(Boolean).join(' ').replace(/\s+/g, ' ');
      return {
        name,
        position: map.position === '' ? '' : r[Number(map.position)],
        phone: map.phone === '' ? '' : r[Number(map.phone)],
        className: map.className === '' ? '' : r[Number(map.className)],
      };
    }).filter((p) => p.name && !/^[\d\s.,-]+$/.test(p.name) && !FOOTER.test(p.name));
  }, [rows, headerRow, map]);

  async function doImport() {
    setBusy(true); setError('');
    try {
      const body = { rows: people, scheduleId: scheduleId ? Number(scheduleId) : null };
      if (students) Object.assign(body, { kind: 'student', className: oneClass.trim() });
      const r = await api('/employees/import', { method: 'POST', body });
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const col = (k, label) => (
    <label>{label}<select value={map[k]} onChange={(e) => setMap({ ...map, [k]: e.target.value })}>
      <option value="">— yo&apos;q —</option>
      {headers.map((h, i) => <option key={i} value={String(i)}>{h || `${i + 1}-ustun`}</option>)}
    </select></label>
  );

  return (
    <>
      <h1>Excel&apos;dan {students ? 'o\'quvchilarni' : 'xodimlarni'} import qilish</h1>
      <div className="tabs">
        <button type="button" className={!students ? 'on' : ''} onClick={() => setKind('staff')}>👔 Xodimlar</button>
        <button type="button" className={students ? 'on' : ''} onClick={() => setKind('student')}>👦 O&apos;quvchilar</button>
      </div>
      {error && <div className="flash error">{error}</div>}
      {result ? (
        <div className="card">
          <h2>✅ Tayyor</h2>
          <p>Qo&apos;shildi: <b>{result.added}</b> ta {students ? 'o\'quvchi' : 'xodim'}. {result.skipped > 0 && <>O&apos;tkazib yuborildi: {result.skipped} ta (bo&apos;sh{students ? ', sinfi yo\'q' : ''} yoki allaqachon bor).</>}</p>
          <p>Endi ularning yuzlarini kiriting — busiz terminal ularni taniy olmaydi.</p>
          <div className="row"><Link className="btn" href="/faces/">Yuzlarni kiritish →</Link><Link className="btn secondary" href={students ? '/employees/?kind=student' : '/employees/'}>Ro&apos;yxat</Link></div>
        </div>
      ) : (
        <>
          <div className="card">
            <ol className="steps">
              {students ? (
                <li>Har bir qatorda bitta o&apos;quvchi. Sarlavhalar: <b>F.I.Sh.</b> (yoki <b>Familiya</b>, <b>Ism</b>) va <b>Sinf</b> (masalan 9-A).
                  Har bir sinf alohida faylda bo&apos;lsa — sinf ustuni shart emas, sinfni pastda yozasiz.</li>
              ) : (
                <li>Excel faylda har bir qatorda bitta xodim bo&apos;lsin. Birinchi qatorda sarlavhalar: masalan <b>F.I.Sh.</b>, <b>Lavozim</b>, <b>Telefon</b>
                  (yoki alohida <b>Familiya</b>, <b>Ism</b>, <b>Otasining ismi</b>).</li>
              )}
              <li>Faylni tanlang (.xlsx).</li>
              <li>Ustunlarni tekshiring va &quot;Import qilish&quot; ni bosing. Bir xil ismli xodim ikki marta qo&apos;shilmaydi.</li>
            </ol>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
            {fileName && <p className="muted">{fileName}: {rows.length} qator</p>}
          </div>
          {rows && (
            <>
              <div className="card">
                <h2>Ustunlar</h2>
                <div className="grid">
                  <label>Sarlavha qatori<select value={headerRow} onChange={(e) => { const i = Number(e.target.value); setHeaderRow(i); setMap(guessColumns(rows[i] || [])); }}>
                    {rows.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1}-qator: {r.filter(Boolean).slice(0, 3).join(', ')}</option>)}
                  </select></label>
                  {col('last', "Familiya yoki F.I.Sh. *")}
                  {col('first', "Ism (alohida ustun bo'lsa)")}
                  {col('middle', "Otasining ismi (alohida bo'lsa)")}
                  {students ? col('className', 'Sinf ustuni') : col('position', 'Lavozim')}
                  {students && map.className === '' && (
                    <label>Hammasi shu sinfga *<input value={oneClass} onChange={(e) => setOneClass(e.target.value)} placeholder="Masalan: 9-A" /></label>
                  )}
                  {col('phone', students ? 'Telefon (ota-ona)' : 'Telefon')}
                  <label>Hammasiga ish jadvali<select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
                    {(schedules || []).map((s) => <option key={s.id} value={s.id}>{s.name} — {scheduleSummary(s)}</option>)}
                  </select></label>
                </div>
              </div>
              <div className="card">
                <div className="row between">
                  <h2 style={{ margin: 0 }}>Ko&apos;rib chiqish: {people.length} ta {students ? 'o\'quvchi' : 'xodim'}</h2>
                  <button onClick={doImport} disabled={!people.length || busy || (students && map.className === '' && !oneClass.trim())}
                    title={students && map.className === '' && !oneClass.trim() ? 'Sinf ustunini tanlang yoki sinfni yozing' : ''}>
                    {busy ? 'Import qilinmoqda…' : `${people.length} ta ${students ? 'o\'quvchini' : 'xodimni'} import qilish`}</button>
                </div>
                <table style={{ marginTop: 12 }}>
                  <thead><tr><th>#</th><th>F.I.Sh.</th><th>{students ? 'Sinf' : 'Lavozim'}</th><th>Telefon</th></tr></thead>
                  <tbody>
                    {people.slice(0, 20).map((p, i) => (
                      <tr key={i}><td>{i + 1}</td>
                        <td>{p.name} {p.name.split(' ').length < 2 && <span className="pill warn" title="Ism yoki familiya ustuni tanlanmagan bo'lishi mumkin">faqat 1 so&apos;z</span>}</td>
                        <td>{students ? p.className || oneClass : p.position}</td><td>{p.phone}</td></tr>
                    ))}
                    {people.length > 20 && <tr><td colSpan={4} className="muted">… va yana {people.length - 20} ta</td></tr>}
                    {!people.length && <tr><td colSpan={4} className="muted">F.I.Sh. ustunini tanlang</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <button className="secondary" onClick={() => router.push(students ? '/employees/?kind=student' : '/employees/')}>← Orqaga</button>
    </>
  );
}
