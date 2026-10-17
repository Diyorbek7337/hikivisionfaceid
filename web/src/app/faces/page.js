'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, useApi, faceUrl } from '@/lib/api';
import { toFaceJpeg } from '@/lib/image';
import { CameraView } from '@/components/FacePicker';
import { ErrorBox } from '@/components/ui';

/**
 * Fast face enrolment: pick a person, take a photo, save, the next person is selected automatically.
 * Works with the computer webcam (on the server PC via localhost) or a phone camera (file input).
 */
export default function Faces() {
  const { data: employees, error, reload } = useApi('/employees');
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const active = (employees || []).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name));
  const list = active
    .filter((e) => showAll || !e.hasFace || (selected && e.id === selected.id))
    .filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));
  const missing = active.filter((e) => !e.hasFace).length;

  useEffect(() => {
    if (!selected && list.length) setSelected(list[0]);
  }, [list, selected]);

  async function save() {
    if (!photo || !selected) return;
    setBusy(true); setErr('');
    try {
      await api(`/employees/${selected.id}/face`, { method: 'PUT', body: { image: photo } });
      setMsg(`✅ ${selected.name} — saqlandi`);
      const idx = list.findIndex((e) => e.id === selected.id);
      const next = list.slice(idx + 1).find((e) => showAll || !e.hasFace) || list.slice(0, idx).find((e) => !e.hasFace);
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
    if (f) setPhoto(await toFaceJpeg(f));
  }

  return (
    <>
      <h1>Yuzlarni kiritish</h1>
      <ErrorBox error={error} />
      <p className="muted">Rasmi yo&apos;q: <b>{missing}</b> / {active.length}. Xodimni tanlang → rasmga oling → Saqlash. Keyingi xodim avtomatik tanlanadi.</p>
      <div className="facegrid">
        <div className="card">
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
                <span>{e.name}<br /><span className="hint">{e.position}</span></span>
              </button>
            ))}
            {employees && !list.length && <p className="ok">🎉 Hammaning rasmi bor.</p>}
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
                  <CameraView key={selected.id} onShot={async (c) => setPhoto(await toFaceJpeg(c))} />
                  <button type="button" className="secondary" style={{ marginTop: 8, width: '100%' }} onClick={() => fileRef.current.click()}>📁 Rasm yuklash / telefon kamerasi</button>
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
