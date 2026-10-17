'use client';
import { useEffect, useRef, useState } from 'react';
import { toFaceJpeg } from '@/lib/image';

/** Lets the admin upload a photo or take one with the camera. Calls onChange(base64Jpeg). */
export default function FacePicker({ value, onChange }) {
  const fileRef = useRef(null);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState('');
  const canUseCamera = typeof navigator !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      setError('');
      onChange(await toFaceJpeg(f));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        {value
          ? <img className="face big" src={`data:image/jpeg;base64,${value}`} alt="Yuz rasmi" />
          : <div className="face big" style={{ display: 'grid', placeItems: 'center' }}><span className="muted">Rasm yo&apos;q</span></div>}
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" className="secondary" onClick={() => fileRef.current.click()}>📁 Rasm yuklash</button>
          {canUseCamera && <button type="button" className="secondary" onClick={() => setCamera(true)}>📷 Kameradan olish</button>}
          {value && <button type="button" className="secondary" onClick={() => onChange(null)}>✕ Rasmni olib tashlash</button>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
      {error && <p className="bad">{error}</p>}
      <p className="hint">Yuz to&apos;g&apos;ridan, yorug&apos; joyda, ko&apos;zoynak va niqobsiz bo&apos;lsin. Rasmda faqat bitta odam bo&apos;lsin.</p>
      {camera && <CameraModal onClose={() => setCamera(false)} onShot={async (canvas) => { setCamera(false); onChange(await toFaceJpeg(canvas)); }} />}
    </div>
  );
}

function CameraModal({ onClose, onShot }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch((e) => setError(e.name === 'NotAllowedError' ? 'Kameraga ruxsat berilmadi' : `Kamerani ochib bo'lmadi: ${e.message}`));
    return () => { if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  function shoot() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    onShot(c);
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kamera</h2>
        {error ? <p className="bad">{error}</p> : <video ref={videoRef} autoPlay playsInline muted />}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" onClick={shoot} disabled={!!error}>📸 Rasmga olish</button>
          <button type="button" className="secondary" onClick={onClose}>Bekor qilish</button>
        </div>
      </div>
    </div>
  );
}
