import { useState } from 'react';
import { api } from '../api.js';
import CameraCapture from '../components/CameraCapture.jsx';
import TicketResult from '../components/TicketResult.jsx';

export default function Captura({ trip }) {
  const [mode, setMode] = useState('foto');
  const [image, setImage] = useState(null); // {blob, url}
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [hasReceipt, setHasReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

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
      if (date) fd.append('expense_date', date);
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
    setDate('');
    setHasReceipt(true);
  }

  const canSubmit = mode === 'foto' ? !!image : text.trim().length > 3;

  return (
    <div className="cols">
      <div>
        <div className="section-title">Registrar gasto · viaje #{trip.id} {trip.destination}</div>
        <p className="screen-help">
          Toma la foto del ticket (o descríbelo con texto) y la IA hace el resto: separa cada concepto,
          aplica la política y lo guarda. Del lado derecho verás el veredicto sellado.
        </p>

        <div className="mode-tabs">
          <button className={'tab' + (mode === 'foto' ? ' active' : '')} onClick={() => setMode('foto')}>📷 Foto del ticket</button>
          <button className={'tab' + (mode === 'texto' ? ' active' : '')} onClick={() => setMode('texto')}>⌨️ Texto libre</button>
        </div>

        {mode === 'foto' && !image && <CameraCapture onImage={(blob, url) => setImage({ blob, url })} />}
        {mode === 'foto' && image && (
          <div style={{ display: 'grid', gap: 10 }}>
            <img className="preview-img" src={image.url} alt="Ticket capturado" />
            <button className="btn ghost small no-print" onClick={() => setImage(null)}>↺ Tomar otra</button>
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

        <label className="fld" style={{ marginTop: 12 }}>
          <span>Fecha del gasto (opcional — si es foto, el agente intenta leerla)</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {err && <div className="err">{err}</div>}

        <button className="btn" disabled={!canSubmit || busy} onClick={submit} style={{ width: '100%' }}>
          {busy ? <><span className="spinner" />El agente está analizando…</> : '🧾 Analizar con el agente'}
        </button>
      </div>

      <div>
        <div className="section-title">Veredicto del agente</div>
        {busy && <div className="analyzing"><span className="spinner" />Leyendo conceptos, clasificando y aplicando la política…</div>}
        {!busy && !result && (
          <p style={{ color: 'var(--cream-muted)', fontSize: 14 }}>
            Aquí aparecerá el ticket con cada concepto sellado: aprobado ✓, rechazado ✗ o a revisión ?.
            Puedes corregir cualquier concepto manualmente si el agente se equivoca.
          </p>
        )}
        {!busy && result && (
          <>
            <TicketResult expense={result} onUpdate={setResult} />
            <button className="btn ghost" style={{ marginTop: 14, width: '100%' }} onClick={reset}>➕ Registrar otro gasto</button>
          </>
        )}
      </div>
    </div>
  );
}
