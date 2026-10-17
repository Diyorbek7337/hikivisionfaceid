'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { readSheet } from 'read-excel-file/browser';
import { api, useApi } from '@/lib/api';
import { scheduleSummary } from '@/components/ui';

const GUESS = {
  last: /f\.?\s*i\.?\s*sh|ф\.?\s*и\.?\s*о|fio|familiya|фамилия|ism.*familiya|full\s*name/i,
  first: /^(ism|исм|имя|name)$/i,
  middle: /otasining|sharif|отчество|шариф/i,
  position: /lavozim|должност|лавозим|position/i,
  phone: /telefon|тел|phone/i,
};

const clean = (v) => (v == null ? '' : String(v).trim());

export default function ImportPage() {
  const router = useRouter();
  const { data: schedules } = useApi('/schedules');
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [map, setMap] = useState({ last: '', first: '', middle: '', position: '', phone: '' });
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
      const h = data.findIndex((r) => r.filter(Boolean).length >= 2);
      const hi = h === -1 ? 0 : h;
      const headers = data[hi] || [];
      const m = { last: '', first: '', middle: '', position: '', phone: '' };
      headers.forEach((t, i) => {
        for (const [k, re] of Object.entries(GUESS)) if (m[k] === '' && re.test(t)) { m[k] = String(i); break; }
      });
      if (m.last === '' && m.first !== '') { m.last = m.first; m.first = ''; }
      setRows(data); setHeaderRow(hi); setMap(m); setFileName(f.name);
    } catch (err) {
      setError(`Faylni o'qib bo'lmadi: ${err.message}. Fayl .xlsx formatida bo'lishi kerak (Excel'da "Saqlash" → .xlsx).`);
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
      };
    }).filter((p) => p.name && !/^\d+$/.test(p.name));
  }, [rows, headerRow, map]);

  async function doImport() {
    setBusy(true); setError('');
    try {
      const r = await api('/employees/import', { method: 'POST', body: { rows: people, scheduleId: scheduleId ? Number(scheduleId) : null } });
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
      <h1>Excel&apos;dan xodimlarni import qilish</h1>
      {error && <div className="flash error">{error}</div>}
      {result ? (
        <div className="card">
          <h2>✅ Tayyor</h2>
          <p>Qo&apos;shildi: <b>{result.added}</b> ta xodim. {result.skipped > 0 && <>O&apos;tkazib yuborildi: {result.skipped} ta (bo&apos;sh yoki allaqachon bor).</>}</p>
          <p>Endi ularning yuzlarini kiriting — busiz terminal ularni taniy olmaydi.</p>
          <div className="row"><Link className="btn" href="/faces/">Yuzlarni kiritish →</Link><Link className="btn secondary" href="/employees/">Xodimlar ro&apos;yxati</Link></div>
        </div>
      ) : (
        <>
          <div className="card">
            <ol className="steps">
              <li>Excel faylda har bir qatorda bitta xodim bo&apos;lsin. Birinchi qatorda sarlavhalar: masalan <b>F.I.Sh.</b>, <b>Lavozim</b>, <b>Telefon</b>
                (yoki alohida <b>Familiya</b>, <b>Ism</b>, <b>Otasining ismi</b>).</li>
              <li>Faylni tanlang (.xlsx).</li>
              <li>Ustunlarni tekshiring va &quot;Import qilish&quot; ni bosing. Bir xil ismli xodim ikki marta qo&apos;shilmaydi.</li>
            </ol>
            <input type="file" accept=".xlsx" onChange={onFile} />
            {fileName && <p className="muted">{fileName}: {rows.length} qator</p>}
          </div>
          {rows && (
            <>
              <div className="card">
                <h2>Ustunlar</h2>
                <div className="grid">
                  <label>Sarlavha qatori<select value={headerRow} onChange={(e) => setHeaderRow(Number(e.target.value))}>
                    {rows.slice(0, 15).map((r, i) => <option key={i} value={i}>{i + 1}-qator: {r.filter(Boolean).slice(0, 3).join(', ')}</option>)}
                  </select></label>
                  {col('last', "Familiya yoki F.I.Sh. *")}
                  {col('first', "Ism (alohida ustun bo'lsa)")}
                  {col('middle', "Otasining ismi (alohida bo'lsa)")}
                  {col('position', "Lavozim")}
                  {col('phone', "Telefon")}
                  <label>Hammasiga ish jadvali<select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)}>
                    {(schedules || []).map((s) => <option key={s.id} value={s.id}>{s.name} — {scheduleSummary(s)}</option>)}
                  </select></label>
                </div>
              </div>
              <div className="card">
                <div className="row between">
                  <h2 style={{ margin: 0 }}>Ko&apos;rib chiqish: {people.length} ta xodim</h2>
                  <button onClick={doImport} disabled={!people.length || busy}>{busy ? 'Import qilinmoqda…' : `${people.length} ta xodimni import qilish`}</button>
                </div>
                <table style={{ marginTop: 12 }}>
                  <thead><tr><th>#</th><th>F.I.Sh.</th><th>Lavozim</th><th>Telefon</th></tr></thead>
                  <tbody>
                    {people.slice(0, 20).map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td>{p.position}</td><td>{p.phone}</td></tr>)}
                    {people.length > 20 && <tr><td colSpan={4} className="muted">… va yana {people.length - 20} ta</td></tr>}
                    {!people.length && <tr><td colSpan={4} className="muted">F.I.Sh. ustunini tanlang</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <button className="secondary" onClick={() => router.push('/employees/')}>← Orqaga</button>
    </>
  );
}
