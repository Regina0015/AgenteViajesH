import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import TicketResult from '../components/TicketResult.jsx';

const SUGERENCIAS = [
  '¿Cuánto me queda de presupuesto?',
  'Gasté 350 en un taxi al hotel',
  '¿Qué me han rechazado y por qué?',
  '¿Qué dice la política sobre el alcohol?',
];

export default function Chat({ trip }) {
  const [msgs, setMsgs] = useState([
    {
      role: 'assistant',
      content: `¡Hola! Soy Talón 🧾 tu agente de viáticos. Estoy viendo tu viaje #${trip.id} a ${trip.destination}. Pregúntame lo que necesites o cuéntame un gasto y lo registro al momento.`,
    },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);

  async function send(msg) {
    const content = (msg ?? text).trim();
    if (!content || busy) return;
    const next = [...msgs, { role: 'user', content }];
    setMsgs(next);
    setText('');
    setBusy(true);
    try {
      const r = await api('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_id: trip.id, messages: next.map(({ role, content }) => ({ role, content })) }),
      });
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
        Habla con tu agente en lenguaje natural: pregúntale tu saldo, la política, o nárrale un gasto
        («gasté 350 en un taxi») y lo registra con veredicto al instante.
      </p>

      <div className="chat-wrap">
        <div className="chat-log" ref={logRef}>
          {msgs.map((m, i) => (
            <div key={i} className={'bubble-row ' + m.role}>
              <div className={'bubble ' + m.role}>
                {m.role === 'assistant' && <div className="bubble-who">🧾 Talón</div>}
                {m.content}
                {m.expense && (
                  <div style={{ marginTop: 10 }}>
                    <TicketResult expense={m.expense} compact onUpdate={(u) =>
                      setMsgs((all) => all.map((x, j) => (j === i ? { ...x, expense: u } : x)))
                    } />
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

        <div className="chat-input">
          <input
            placeholder="Escríbele a Talón…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <button className="btn" onClick={() => send()} disabled={busy || !text.trim()}>Enviar ➤</button>
        </div>
      </div>
    </div>
  );
}
