'use client';
/**
 * Slips for parents: each student's secret code and a QR code that opens the bot with it.
 * Printed per class (8 slips on an A4 page) and cut; the class teacher hands them out.
 */
import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { useApi } from '@/lib/api';
import { useApp } from '@/components/AppShell';
import { ErrorBox } from '@/components/ui';
import { compareClasses } from '@/lib/people';

export default function Parents() {
  const app = useApp();
  const teacher = app.user.role === 'teacher';
  const { data, error } = useApi('/parents/slips');
  const [cls, setCls] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);

  const classes = useMemo(() => [...new Set((data ? data.students : []).map((s) => s.className))].sort(compareClasses), [data]);
  useEffect(() => { if (!cls && classes.length) setCls(classes[0]); }, [classes, cls]);
  const students = (data ? data.students : [])
    .filter((s) => s.className === cls)
    .filter((s) => !onlyMissing || !s.parents)
    .sort((a, b) => a.name.localeCompare(b.name));
  const inClass = (data ? data.students : []).filter((s) => s.className === cls);
  const linked = inClass.filter((s) => s.parents > 0).length;
  const bot = data && data.botUsername;

  return (
    <>
      <div className="no-print">
        <h1>Ota-onalar uchun varaqalar</h1>
        <ErrorBox error={error} />
        <p className="muted">Har bir o&apos;quvchiga varaqa: ota-ona QR kodni telefon kamerasi bilan skanerlaydi → Telegram bot ochiladi → u farzandi
          maktabga kelganda va chiqqanda xabar oladi. Varaqalarni chop eting, qirqing va o&apos;quvchilar orqali uyiga yuboring.</p>
        {data && !bot && (
          <div className="flash warn">⚠️ Telegram bot ulanmagan (yoki tizim hali bot nomini olmagan) — QR kod chiqmaydi.
            {teacher ? ' Administratorga ayting.' : <> <code>server\.env</code> da <code>BOT_TOKEN</code> ni kiriting va tizimni qayta ishga tushiring.</>}</div>
        )}
        <div className="card row">
          <label>Sinf<select value={cls} onChange={(e) => setCls(e.target.value)}>
            {classes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
          <label className="inline" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Faqat hali ulanmaganlar
          </label>
          <span className="muted" style={{ paddingBottom: 8 }}>Ulangan: <b>{linked}</b> / {inClass.length}</span>
          <button style={{ marginLeft: 'auto' }} onClick={() => window.print()} disabled={!students.length}>🖨 Chop etish ({students.length})</button>
        </div>
        {data && !data.students.length && <div className="card muted">O&apos;quvchilar yo&apos;q.</div>}
      </div>
      <div className="slips">
        {students.map((s) => <Slip key={s.id} s={s} bot={bot} org={data.organizationName} />)}
      </div>
    </>
  );
}

function Slip({ s, bot, org }) {
  const link = bot ? `https://t.me/${bot}?start=${s.code}` : '';
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr).catch(() => setQr(''));
  }, [link]);
  const code = `${s.code.slice(0, 4)} ${s.code.slice(4)}`;
  return (
    <div className="slip">
      <div className="slip-head">{org || 'Maktab'} · Davomat xabarlari</div>
      <div className="slip-body">
        {qr ? <img src={qr} alt="QR" className="slip-qr" /> : <div className="slip-qr" />}
        <div>
          <div className="slip-name">{s.name}</div>
          <div className="muted">{s.className} sinf {s.parents > 0 && <span className="no-print pill ok">ulangan: {s.parents}</span>}</div>
          <div className="slip-code">{code}</div>
          <div className="slip-short">📷 QR kodni telefon kamerasi bilan oching → Telegram → <b>START</b>.
            {bot && <> Yoki <b>@{bot}</b> ga kodni yuboring.</>} Farzandingiz kelib-ketganda xabar olasiz.</div>
        </div>
      </div>
      <ol className="slip-steps">
        <li>Telefon kamerasini QR kodga qarating va havolani oching (Telegram ochiladi).</li>
        <li><b>START / Запустить</b> tugmasini bosing — tayyor.</li>
        {bot && <li>Yoki Telegram&apos;da <b>@{bot}</b> ni topib, yuqoridagi kodni yuboring.</li>}
      </ol>
      <div className="slip-foot">Farzandingiz maktabga kelganda va chiqqanda xabar olasiz. Kodni begonalarga bermang.</div>
    </div>
  );
}
