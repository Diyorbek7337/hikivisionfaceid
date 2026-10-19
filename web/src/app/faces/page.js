'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/components/AppShell';
import { api, useApi, faceUrl } from '@/lib/api';
import { toFaceJpeg } from '@/lib/image';
import { normText } from '@/lib/time';
import { CameraView } from '@/components/FacePicker';
import { ErrorBox } from '@/components/ui';
import { KindTabs, classList } from '@/lib/people';

/**
 * Fast face enrolment: pick a person, take a photo, save, the next person is selected automatically.
 * Works with the computer webcam (on the server PC via localhost) or a phone camera (file input).
 */
export default function Faces() {
  const { data: employees, error, reload } = useApi('/employees');
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const app = useApp();
  const teacher = !!(app && app.user && app.user.role === 'teacher');
  const [kind, setKind] = useState(teacher ? 'student' : 'staff');
  const [cls, setCls] = useState('');
  const [selected, setSelected] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [savedIds, setSavedIds] = useState(() => new Set()); // saved here, until the list reloads
  const fileRef = useRef(null);
  // Phones (and pages opened over plain http on another device) cannot use the in-page camera:
  // they get one big button that opens the phone's own camera.
  const [webcam, setWebcam] = useState(false);
  useEffect(() => {
    const md = navigator.mediaDevices;
    setWebcam(!!(md && md.getUserMedia) && !window.matchMedia('(pointer: coarse)').matches);
  }, []);

  const hasStudents = (employees || []).some((e) => e.kind === 'student');
  const classes = classList(employees);
  const active = (employees || []).filter((e) => e.active)
    .filter((e) => !hasStudents || (kind === 'student' ? e.kind === 'student' : e.kind !== 'student'))
    .filter((e) => kind !== 'student' || !cls || e.className === cls)
    .map((e) => (savedIds.has(e.id) ? { ...e, hasFace: true } : e))
    .sort((a, b) => a.name.localeCompare(b.name));
  const list = active
    .filter((e) => showAll || !e.hasFace || (selected && e.id === selected.id))
    .filter((e) => !q || normText(e.name).includes(normText(q)));
  const missing = active.filter((e) => !e.hasFace).length;

  useEffect(() => {
    if (!selected && list.length && !list.every((e) => e.hasFace && !showAll)) setSelected(list[0]);
  }, [list, selected, showAll]);

  async function save() {
    if (!photo || !selected) return;
    setBusy(true); setErr('');
    try {
      await api(`/employees/${selected.id}/face`, { method: 'PUT', body: { image: photo } });
      setMsg(`✅ ${selected.name} — saqlandi`);
      setSavedIds((prev) => new Set(prev).add(selected.id));
      const idx = list.findIndex((e) => e.id === selected.id);
      const pendingList = list.filter((e) => e.id !== selected.id);
      const next = showAll ? list[idx + 1] || null
        : pendingList.slice(Math.max(0, idx)).find((e) => !e.hasFace) || pendingList.find((e) => !e.hasFace) || null;
      setPhoto(null);
      setSelected(next || null);
      reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      setErr('');
      setPhoto(await toFaceJpeg(f));
    } catch {
      setErr('Bu faylni rasm sifatida ochib bo\'lmadi. JPG yoki PNG rasm tanlang (iPhone\'da: Sozlamalar → Kamera → Formatlar → "Eng mos").');
    }
  }

  return (
    <>
      <h1>Yuzlarni kiritish</h1>
      <ErrorBox error={error} />
      {hasStudents && !teacher && <KindTabs value={kind} onChange={(k) => { setKind(k); setCls(''); setSelected(null); setPhoto(null); }} />}
      {hasStudents && kind === 'student' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <label>Sinf<select value={cls} onChange={(e) => { setCls(e.target.value); setSelected(null); setPhoto(null); }}>
            <option value="">Hammasi</option>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        </div>
      )}
      <p className="muted">Rasmi yo&apos;q: <b>{missing}</b> / {active.length}. {kind === 'student' ? 'O\'quvchini' : 'Xodimni'} tanlang → rasmga oling → Saqlash. Keyingisi avtomatik tanlanadi.</p>
      <div className="facegrid">
        <div className="card facelist">
          <div className="row" style={{ marginBottom: 8 }}>
            <label style={{ flex: 1 }}>Qidirish<input value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', paddingBottom: 8 }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Hammasi
            </label>
          </div>
          <div className="list">
            {list.map((e) => (
              <button key={e.id} type="button" className={`item ${selected && selected.id === e.id ? 'active' : ''}`}
                onClick={() => { setSelected(e); setPhoto(null); setMsg(''); setErr(''); }}>
                {e.hasFace ? <img className="face" src={faceUrl(e)} alt="" loading="lazy" /> : <span className="face" style={{ display: 'inline-grid', placeItems: 'center' }}>?</span>}
                <span>{e.name}<br /><span className="hint">{e.kind === 'student' ? e.className : e.position}</span></span>
              </button>
            ))}
            {employees && !list.some((e) => showAll || !e.hasFace) && <p className="ok">🎉 Hammaning rasmi bor.</p>}
          </div>
        </div>
        <div className="card">
          {selected ? (
            <>
              <h2>{selected.name}</h2>
              {msg && <div className="flash">{msg}</div>}
              {err && <div className="flash error">{err}</div>}
              {photo ? (
                <>
                  <img src={`data:image/jpeg;base64,${photo}`} alt="" style={{ width: '100%', borderRadius: 8 }} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button onClick={save} disabled={busy}>{busy ? 'Saqlanmoqda…' : '✅ Saqlash'}</button>
                    <button className="secondary" onClick={() => setPhoto(null)}>↺ Qayta olish</button>
                  </div>
                </>
              ) : (
                <>
                  {webcam && <CameraView key={selected.id} onShot={async (c) => { setErr(''); setPhoto(await toFaceJpeg(c)); }} />}
                  {webcam ? (
                    <button type="button" className="secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => fileRef.current.click()}>📁 Rasm yuklash</button>
                  ) : (
                    <button type="button" className="big-shot" onClick={() => fileRef.current.click()}>📷 Rasmga olish</button>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
                </>
              )}
              <p className="hint">Yuz kameraga to&apos;g&apos;ri qarasin, yorug&apos; joyda, ko&apos;zoynak va niqobsiz. Orqa fon oddiy bo&apos;lsin.</p>
            </>
          ) : <p className="muted">Ro&apos;yxatdan xodimni tanlang. <Link href="/employees/">Xodimlar</Link></p>}
        </div>
      </div>
    </>
  );
}
