'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi, faceUrl } from '@/lib/api';
import { money, normText } from '@/lib/time';
import { SyncBadge, ErrorBox, scheduleSummary, rateText } from '@/components/ui';
import { KindTabs, classList, compareClasses } from '@/lib/people';

export default function Employees() {
  const { data: all, error } = useApi('/employees', { refreshMs: 8000 });
  const { data: devices } = useApi('/devices');
  const { data: schedules } = useApi('/schedules');
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('staff');
  const [cls, setCls] = useState('');
  useEffect(() => { if (new URLSearchParams(window.location.search).get('kind') === 'student') setKind('student'); }, []);
  const sched = new Map((schedules || []).map((s) => [s.id, s.name]));
  const defaultSched = schedules && schedules[0] ? schedules[0].name : '';
  const devs = devices || [];

  const counts = { staff: (all || []).filter((e) => e.active && e.kind !== 'student').length, student: (all || []).filter((e) => e.active && e.kind === 'student').length };
  const students = kind === 'student';
  const classes = classList(all);
  const list = (all || [])
    .filter((e) => (students ? e.kind === 'student' : e.kind !== 'student'))
    .filter((e) => !students || !cls || e.className === cls)
    .filter((e) => showInactive || e.active)
    .filter((e) => !q || normText(`${e.name} ${e.employeeNo} ${e.position || ''} ${e.className || ''}`).includes(normText(q)))
    .sort((a, b) => (students ? compareClasses(a.className, b.className) : 0) || a.name.localeCompare(b.name));
  const noFace = (all || []).filter((e) => e.active && !e.hasFace).length;

  return (
    <>
      <div className="row between"><h1>{students ? 'O\'quvchilar' : 'Xodimlar'} {all && <span className="muted">({list.filter((e) => e.active).length})</span>}</h1>
        <div className="toolbar">
          <Link className="btn secondary" href={students ? '/employees/import/?kind=student' : '/employees/import/'}>📄 Excel&apos;dan import</Link>
          <Link className="btn" href={students ? '/employees/edit/?kind=student' : '/employees/edit/'}>+ {students ? 'O\'quvchi' : 'Xodim'} qo&apos;shish</Link>
        </div>
      </div>
      <ErrorBox error={error} />
      {<KindTabs value={kind} onChange={(k) => { setKind(k); setCls(''); }} counts={counts} />}
      {noFace > 0 && <div className="flash warn">⚠️ {noFace} ta xodimning yuz rasmi yo&apos;q — terminal ularni taniy olmaydi. <Link href="/faces/">Yuzlarni kiritish →</Link></div>}
      <div className="card row">
        <label style={{ flex: 1, minWidth: 200 }}>Qidirish<input value={q} onChange={(e) => setQ(e.target.value)} placeholder={students ? 'Ism yoki ID' : 'Ism, ID yoki lavozim'} /></label>
        {students && (
          <label>Sinf<select value={cls} onChange={(e) => setCls(e.target.value)}>
            <option value="">Hammasi</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        )}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Nofaollarni ham ko&apos;rsatish
        </label>
      </div>
      <div className="card">
        <table>
          <thead><tr>
            <th></th><th>ID</th><th>Ism</th><th>{students ? 'Sinf' : 'Lavozim'}</th><th>Jadval</th>{students ? <th title="Telegram'ga ulangan ota-onalar">Ota-ona</th> : <th>Stavka</th>}
            {devs.map((d) => <th key={d.id}>{d.name}</th>)}<th></th>
          </tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{e.hasFace ? <img className="face" src={faceUrl(e)} alt="" loading="lazy" /> : <span className="face" style={{ display: 'inline-grid', placeItems: 'center' }} title="Rasm yo'q">—</span>}</td>
                <td><code>{e.employeeNo}</code></td>
                <td>{e.name} {!e.active && <span className="pill muted">nofaol</span>}
                  {e.externalId && <span className="pill muted" title="Edume CRM'dan: ism, guruh va jadval Edume'da o'zgartiriladi">Edume</span>}</td>
                <td className={students ? '' : 'muted'}>{students ? e.className : e.position}</td>
                <td>{e.personalSchedule && e.personalSchedule.type === 'flexible' && <span className="pill muted">Erkin</span>}
                  {e.personalSchedule && e.personalSchedule.type !== 'flexible'
                    && <span title={scheduleSummary(e.personalSchedule)}>Shaxsiy: <span className="muted">{scheduleSummary(e.personalSchedule)}</span></span>}
                  {!e.personalSchedule && (sched.get(e.scheduleId) || defaultSched)}</td>
                {students ? <td>{e.parents ? <span className="pill ok">{e.parents}</span> : <span className="muted">—</span>}</td>
                  : <td className="nw">{rateText(e.payType, e.payRate, money)}</td>}
                {devs.map((d) => <td key={d.id}><SyncBadge employee={e} device={d} /></td>)}
                <td><Link href={`/employees/edit/?id=${e.id}`}>Tahrirlash</Link></td>
              </tr>
            ))}
            {all && !list.length && <tr><td colSpan={7 + devs.length} className="muted">Hech kim topilmadi</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">Terminal ustunlari: ✓ — xodim va yuzi terminalga yozilgan; ⏳ — yuborilmoqda; ✗ — xato (sichqonchani ustiga olib boring).</p>
    </>
  );
}
