'use client';
import { useState } from 'react';
import Link from 'next/link';
import { collection } from 'firebase/firestore';
import { useApp } from '@/components/AppShell';
import { useLiveQuery } from '@/lib/hooks';
import { money } from '@/lib/time';
import { SyncBadge, ErrorBox } from '@/components/ui';

export default function Employees() {
  const { db } = useApp();
  const [all, loading, error] = useLiveQuery(() => collection(db, 'employees'), []);
  const [devices] = useLiveQuery(() => collection(db, 'devices'), []);
  const [showInactive, setShowInactive] = useState(false);
  const [q, setQ] = useState('');

  const list = all
    .filter((e) => !e.deleted && (showInactive || e.active))
    .filter((e) => !q || `${e.name} ${e.employeeNo} ${e.position || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(a.employeeNo) - Number(b.employeeNo));

  return (
    <>
      <div className="row between"><h1>Xodimlar</h1><Link className="btn" href="/employees/edit/">+ Xodim qo&apos;shish</Link></div>
      <ErrorBox error={error} />
      <div className="card row">
        <label style={{ flex: 1, minWidth: 200 }}>Qidirish<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ism yoki ID" /></label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Nofaollarni ham ko&apos;rsatish
        </label>
      </div>
      <div className="card">
        <table>
          <thead><tr>
            <th>ID</th><th>Ism</th><th>Lavozim</th><th>Ish vaqti</th><th>Soatbay</th><th>Yuz</th>
            {devices.map((d) => <th key={d.id}>{d.name}</th>)}<th></th>
          </tr></thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id}>
                <td><code>{e.employeeNo}</code></td>
                <td>{e.name} {!e.active && <span className="pill muted">nofaol</span>}</td>
                <td>{e.position}</td>
                <td>{e.workStart}–{e.workEnd}</td>
                <td>{money(e.hourlyRate)}</td>
                <td>{e.hasFace ? '✅' : <span className="warn" title="Terminal bu xodimni taniy olmaydi">rasm yo&apos;q</span>}</td>
                {devices.map((d) => <td key={d.id}><SyncBadge employee={e} device={d} /></td>)}
                <td><Link href={`/employees/edit/?id=${e.id}`}>Tahrirlash</Link></td>
              </tr>
            ))}
            {!loading && !list.length && <tr><td colSpan={7 + devices.length} className="muted">Xodim topilmadi</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="hint">Terminal ustunlari: ✓ — xodim va uning yuzi terminalga yozilgan; ⏳ — ko&apos;prik yubormoqda; ✗ — xato (ustiga olib boring).</p>
    </>
  );
}
