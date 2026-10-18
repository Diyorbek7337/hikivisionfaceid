'use client';
import { useEffect, useRef, useState } from 'react';
import { toFaceJpeg } from '@/lib/image';

/** Upload a photo or take one with the camera. `src` = current image URL/data; onChange(base64Jpeg | null). */
export default function FacePicker({ src, onChange }) {
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
    } catch {
      setError('Bu faylni rasm sifatida ochib bo\'lmadi. JPG yoki PNG rasm tanlang.');
    }
  }

  return (
    <div>
      <div className="row" style={{ alignItems: 'center' }}>
        {src
          ? <img className="face big" src={src} alt="Yuz rasmi" />
          : <div className="face big" style={{ display: 'grid', placeItems: 'center' }}><span className="muted">Rasm yo&apos;q</span></div>}
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" className="secondary" onClick={() => fileRef.current.click()}>📁 Rasm yuklash / telefon kamerasi</button>
          {canUseCamera && <button type="button" className="secondary" onClick={() => setCamera(true)}>📷 Kompyuter kamerasi</button>}
          {src && <button type="button" className="secondary" onClick={() => onChange(null)}>✕ Rasmni olib tashlash</button>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={onFile} />
      {error && <p className="bad">{error}</p>}
      <p className="hint">Yuz to&apos;g&apos;ridan, yorug&apos; joyda, ko&apos;zoynak va niqobsiz bo&apos;lsin. Rasmda faqat bitta odam bo&apos;lsin.</p>
      {camera && <CameraModal onClose={() => setCamera(false)} onShot={async (canvas) => { setCamera(false); onChange(await toFaceJpeg(canvas)); }} />}
    </div>
  );
}

function cameraError(e) {
  if (e.name === 'NotAllowedError') return 'Kameraga ruxsat berilmadi (brauzer manzil satridagi kamera belgisini bosing)';
  if (e.name === 'NotFoundError') return 'Kompyuterda kamera topilmadi — pastdagi tugma orqali rasm yuklang yoki telefondan foydalaning';
  if (e.name === 'NotReadableError') return 'Kamera boshqa dasturda band';
  return `Kamerani ochib bo'lmadi: ${e.message}`;
}

export function CameraView({ onShot, busy }) {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stream;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Bu brauzerda kamera ishlamaydi (server kompyuterida localhost orqali oching yoki rasm yuklang)');
      return undefined;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((s) => { stream = s; if (videoRef.current) videoRef.current.srcObject = s; })
      .catch((e) => setError(cameraError(e)));
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

  if (error) return <p className="bad">{error}</p>;
  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted />
      <button type="button" style={{ marginTop: 8, width: '100%' }} onClick={shoot} disabled={busy}>📸 Rasmga olish</button>
    </div>
  );
}

function CameraModal({ onClose, onShot }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Kamera</h2>
        <CameraView onShot={onShot} />
        <button type="button" className="secondary" style={{ marginTop: 8 }} onClick={onClose}>Bekor qilish</button>
      </div>
    </div>
  );
}
