import { useMemo, useState } from 'react';
import { api } from '../api.js';
import CameraCapture from '../components/CameraCapture.jsx';
import TicketResult from '../components/TicketResult.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const dayLabel = (isoDate) =>
  new Date(isoDate + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });

export default function Captura({ trip, onGoEstado }) {
  const [mode, setMode] = useState('foto');
  const [image, setImage] = useState(null);
  const [text, setText] = useState('');
  const [hasReceipt, setHasReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  // Día del gasto: Hoy / Ayer / Otra fecha — siempre explícito
  const hoy = useMemo(() => iso(new Date()), []);
  const ayer = useMemo(() => iso(new Date(Date.now() - 86400000)), []);
  const [dayMode, setDayMode] = useState('hoy');
  const [customDate, setCustomDate] = useState('');
  const expenseDate = dayMode === 'hoy' ? hoy : dayMode === 'ayer' ? ayer : customDate;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      if (mode === 'foto' && image) fd.append('photo', image.blob, 'ticket.jpg');
      if (mode === 'texto') {
        fd.append('description', text);
        fd.append('has_receipt', String(hasReceipt));
      }
      if (expenseDate) fd.append('expense_date', expenseDate);
      const e = await api(`/trips/${trip.id}/expenses`, { method: 'POST', body: fd });
      setResult(e);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setImage(null);
    setText('');
    setHasReceipt(true);
    setDayMode('hoy');
  }

  const canSubmit = (mode === 'foto' ? !!image : text.trim().length > 3) && !!expenseDate;

  return (
    <div>
      <div className="section-title">Registrar gasto · Laura Martínez · viaje #{trip.id} {trip.destination}</div>
      <p className="screen-help">
        Toma la foto del ticket (o descríbelo con texto), dime de qué día es, y la IA hace el resto:
        separa cada concepto, aplica la política y lo guarda. Lo que quede en duda lo resuelve Finanzas
        en la mesa de revisión — tú no tienes que pelearte con nada.
      </p>

      <div className="cols">
        <div>
          <div className="mode-tabs">
            <button className={'tab' + (mode === 'foto' ? ' active' : '')} onClick={() => setMode('foto')}>📷 Foto del ticket</button>
            <button className={'tab' + (mode === 'texto' ? ' active' : '')} onClick={() => setMode('texto')}>⌨️ Texto libre</button>
          </div>

          {mode === 'foto' && !image && <CameraCapture onImage={(blob, url) => setImage({ blob, url })} />}
          {mode === 'foto' && image && (
            <div style={{ display: 'grid', gap: 10 }}>
              <img className="preview-img" src={image.url} alt="Ticket capturado" />
              <button className="btn ghost small" onClick={() => setImage(null)}>↺ Tomar otra</button>
            </div>
          )}

          {mode === 'texto' && (
            <>
              <textarea
                placeholder='Describe el gasto, ej: "Cena con proveedores 680, incluye 2 cervezas de 140"'
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <label className="check-line">
                <input type="checkbox" checked={hasReceipt} onChange={(e) => setHasReceipt(e.target.checked)} />
                Cuento con comprobante de este gasto
              </label>
            </>
          )}

          <div style={{ margin: '14px 0' }}>
            <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--cream-muted)', marginBottom: 6 }}>
              ¿De qué día es este gasto?
            </span>
            <div className="chips-row">
              <button className={'sug-chip' + (dayMode === 'hoy' ? ' sel-day' : '')} onClick={() => setDayMode('hoy')}>
                Hoy · {dayLabel(hoy)}
              </button>
              <button className={'sug-chip' + (dayMode === 'ayer' ? ' sel-day' : '')} onClick={() => setDayMode('ayer')}>
                Ayer · {dayLabel(ayer)}
              </button>
              <button className={'sug-chip' + (dayMode === 'otra' ? ' sel-day' : '')} onClick={() => setDayMode('otra')}>
                📅 Otra fecha
              </button>
              {dayMode === 'otra' && (
                <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} />
              )}
            </div>
          </div>

          {err && <div className="err">{err}</div>}

          <button className="btn" disabled={!canSubmit || busy} onClick={submit} style={{ width: '100%' }}>
            {busy ? <><span className="spinner" />El agente está analizando…</> : '🧾 Analizar y registrar gasto'}
          </button>
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Veredicto del agente</div>
          {busy && <div className="analyzing"><span className="spinner" />Leyendo conceptos, clasificando y aplicando la política…</div>}
          {!busy && !result && (
            <p style={{ color: 'var(--cream-muted)', fontSize: 14.5 }}>
              Aquí aparecerá tu ticket con cada concepto sellado: ✅ aprobado, ❌ rechazado o ⚠️ en
              revisión de Finanzas — siempre con la explicación y la política aplicada.
            </p>
          )}
          {!busy && result && (
            <>
              <TicketResult expense={result} />
              {Number(result.review_amount) > 0 && (
                <div className="alert warn" style={{ marginTop: 10 }}>
                  ⚠️ Lo marcado en revisión lo decidirá Finanzas en la mesa de revisión — no tienes que hacer nada más.
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                <button className="btn ghost" style={{ flex: 1 }} onClick={reset}>➕ Registrar otro</button>
                <button className="btn" style={{ flex: 1 }} onClick={onGoEstado}>📊 Ver estado del viaje</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
