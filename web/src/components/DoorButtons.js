'use client';
import { useState } from 'react';
import { api } from '@/lib/api';

/** Door commands for one terminal. compact: only "open" (dashboard). */
export default function DoorButtons({ device, compact = false, onDone }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);

  async function send(cmd) {
    if (cmd === 'alwaysOpen' && !confirm(`"${device.name}" eshigi doimiy ochiq qoladi — "Odatiy holat" ni bosmaguningizcha hamma kira oladi. Davom etasizmi?`)) return;
    setBusy(cmd);
    setMsg(null);
    try {
      await api(`/devices/${device.id}/door`, { method: 'POST', body: { cmd } });
      setMsg({ ok: true, text: cmd === 'open' ? 'Ochildi' : cmd === 'alwaysOpen' ? 'Doimiy ochiq' : 'Odatiy holatda' });
      if (onDone) onDone();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
    setBusy('');
    setTimeout(() => setMsg((m) => (m && m.ok ? null : m)), 4000);
  }

  const off = !!busy || device.online === false;
  return (
    <span className="row" style={{ gap: 6, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center' }}>
      <button type="button" className="small" disabled={off} onClick={() => send('open')}
        title={device.online === false ? 'Terminal ulanmagan' : 'Eshikni bir marta ochish'}>{busy === 'open' ? '…' : '🔓 Eshikni ochish'}</button>
      {!compact && (
        <>
          <button type="button" className="secondary small" disabled={off} onClick={() => send('alwaysOpen')}>Doimiy ochiq</button>
          <button type="button" className="secondary small" disabled={off} onClick={() => send('close')}
            title="Doimiy ochiq rejimini bekor qilish: eshik faqat yuz tanilganda ochiladi">Odatiy holat</button>
        </>
      )}
      {msg && <span className={msg.ok ? 'ok' : 'bad'} style={{ fontSize: 13 }}>{msg.ok ? '✓ ' : '✗ '}{msg.text}</span>}
    </span>
  );
}
