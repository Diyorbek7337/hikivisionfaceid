'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi, faceUrl } from '@/lib/api';
import { money, normText } from '@/lib/time';
import { SyncBadge, ErrorBox, scheduleSummary } from '@/components/ui';

export default function Employees() {
  const { data: all, error } = useApi('/employees', { refreshMs: 8000 });
  const { data: devices } = useApi('/devices');
  const { data: schedules } = useApi('/schedules');
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');
  const sched = new Map((schedules || []).map((s) => [s.id, s.name]));
  const defaultSched = schedules && schedules[0] ? schedules[0].name : '';
  const devs = devices || [];

  const list = (all || [])
    .filter((e) => showInactive || e.active)
    .filter((e) => !q || normText(`${e.name} ${e.employeeNo} ${e.position || ''}`).includes(normText(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const noFace = (all || []).filter((e) => e.active && !e.hasFace).length;

  return (
    <>
      <div className="row between"><h1>Xodimlar {all && <span className="muted">({all.filter((e) => e.active).length})</span>}</h1>
        <div className="toolbar">
          <Link className="btn secondary" href="/employees/import/">📄 Excel&apos;dan import</Link>
          <Link className="btn" href="/employees/edit/">+ Xodim qo&apos;shish</Link>
        </div>
      </div>
      <ErrorBox error={error} />
      {noFace > 0 && <div className="flash warn">⚠️ {noFace} ta xodimning yuz rasmi yo&apos;q — terminal ularni taniy olmaydi. <Link href="/faces/">Yuzlarni kiritish →</Link></div>}
      <div className="card row">
        <label style={{ flex: 1, minWidth: 200 }}>Qidirish<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism, ID yoki lavozim" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Nofaollarni ham ko&apos;rsatish
        </label>
      </div>
      <div className="card">
        <table>
          <thead><tr>
            <th></th><th>ID</th><th>Ism</th><th>Lavozim</th><th>Jadval</th><th>Soatbay</th>
            {devs.map((d) => <th key={d.id}>{d.name}</th>)}<th></th>
          </tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td>{e.hasFace ? <img className="face" src={faceUrl(e)} alt="" loading="lazy" /> : <span className="face" style={{ display: 'inline-grid', placeItems: 'center' }} title="Rasm yo'q">—</span>}</td>
                <td><code>{e.employeeNo}</code></td>
                <td>{e.name} {!e.active && <span className="pill muted">nofaol</span>}</td>
                <td className="muted">{e.position}</td>
                <td>{e.personalSchedule && e.personalSchedule.type === 'flexible' && <span className="pill muted">Erkin</span>}
                  {e.personalSchedule && e.personalSchedule.type !== 'flexible'
                    && <span title={scheduleSummary(e.personalSchedule)}>Shaxsiy: <span className="muted">{scheduleSummary(e.personalSchedule)}</span></span>}
                  {!e.personalSchedule && (sched.get(e.scheduleId) || defaultSched)}</td>
                <td>{e.hourlyRate ? money(e.hourlyRate) : ''}</td>
                {devs.map((d) => <td key={d.id}><SyncBadge employee={e} device={d} /></td>)}
                <td><Link href={`/employees/edit/?id=${e.id}`}>Tahrirlash</Link></td>
              </tr>
            ))}
            {all && !list.length && <tr><td colSpan={7 + devs.length} className="muted">Xodim topilmadi</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">Terminal ustunlari: ✓ — xodim va yuzi terminalga yozilgan; ⏳ — yuborilmoqda; ✗ — xato (sichqonchani ustiga olib boring).</p>
    </>
  );
}
