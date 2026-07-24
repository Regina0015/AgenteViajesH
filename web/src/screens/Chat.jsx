import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import TicketResult from '../components/TicketResult.jsx';

const SUGERENCIAS = [
  '¿Cuánto me queda de presupuesto?',
  'Gasté 350 en un taxi al hotel',
  'Ayer se me pasó registrar una comida de 240',
  '¿Qué me han rechazado y por qué?',
];

export default function Chat({ trip }) {
  const [msgs, setMsgs] = useState([
    {
      role: 'assistant',
      content: `¡Hola Laura! Soy Talón 🧾 tu agente de viáticos. Estoy viendo tu viaje #${trip.id} a ${trip.destination}. Pregúntame lo que necesites, cuéntame un gasto, o adjunta la foto del ticket con el 📎 y la guardo como evidencia.`,
    },
  ]);
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState(null); // {blob, url, name}
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  function pickPhoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    setPhoto({ blob: file, url: URL.createObjectURL(file), name: file.name });
  }

  async function send(msg) {
    const content = (msg ?? text).trim();
    if ((!content && !photo) || busy) return;
    const next = [...msgs, { role: 'user', content: content || '📎 (foto adjunta)', image: photo?.url }];
    setMsgs(next);
    setText('');
    setBusy(true);
    const history = next.map(({ role, content }) => ({ role, content }));
    try {
      let r;
      if (photo) {
        const fd = new FormData();
        fd.append('trip_id', String(trip.id));
        fd.append('messages', JSON.stringify(history));
        fd.append('photo', photo.blob, photo.name || 'evidencia.jpg');
        r = await api('/chat', { method: 'POST', body: fd });
      } else {
        r = await api('/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trip_id: trip.id, messages: history }),
        });
      }
      setPhoto(null);
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply, expense: r.expense }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: '⚠️ Algo falló: ' + e.message }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="section-title">Chat con Talón</div>
      <p className="screen-help">
        Habla con tu agente en lenguaje natural: pregúntale tu saldo, nárrale un gasto («gasté 350 en un
        taxi»), o adjunta la foto del ticket 📎 — queda como evidencia que Finanzas puede abrir.
      </p>

      <div className="chat-wrap">
        <div className="chat-log" ref={logRef}>
          {msgs.map((m, i) => (
            <div key={i} className={'bubble-row ' + m.role}>
              <div className={'bubble ' + m.role}>
                {m.role === 'assistant' && <div className="bubble-who">🧾 Talón</div>}
                {m.content}
                {m.image && <img className="bubble-img" src={m.image} alt="Evidencia adjunta" />}
                {m.expense && (
                  <div style={{ marginTop: 10 }}>
                    <TicketResult expense={m.expense} compact />
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="bubble-row assistant">
              <div className="bubble assistant"><span className="spinner" />Pensando…</div>
            </div>
          )}
        </div>

        <div className="chips-row">
          {SUGERENCIAS.map((s) => (
            <button key={s} className="sug-chip" onClick={() => send(s)} disabled={busy}>{s}</button>
          ))}
        </div>

        {photo && (
          <div className="attach-preview">
            <img src={photo.url} alt="Foto por enviar" />
            <span>{photo.name || 'evidencia.jpg'} — se adjuntará como evidencia</span>
            <button className="vbtn" onClick={() => setPhoto(null)} title="Quitar foto">✕</button>
          </div>
        )}

        <div className="chat-input">
          <button className="btn ghost" style={{ padding: '0 14px' }} title="Adjuntar foto del ticket"
            onClick={() => fileRef.current.click()} disabled={busy}>📎</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickPhoto(e.target.files[0]); e.target.value = ''; }} />
          <input
            placeholder={photo ? 'Cuéntame de qué es esta foto (opcional) y envía…' : 'Escríbele a Talón…'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn" onClick={() => send()} disabled={busy || (!text.trim() && !photo)}>Enviar ➤</button>
        </div>
      </div>
    </div>
  );
}
