import { useState } from 'react';
import { api, money } from '../api.js';
import Stamp from '../components/Stamp.jsx';

export default function Solicitud({ trips, reload, onGoCapture }) {
  const [form, setForm] = useState({ destination: '', purpose: '', start_date: '', end_date: '', requested_amount: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create() {
    setBusy(true); setErr(null);
    try {
      await api('/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, requested_amount: Number(form.requested_amount) || 0, employee_id: 1 }),
      });
      setForm({ destination: '', purpose: '', start_date: '', end_date: '', requested_amount: '' });
      await reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function approve(t) {
    await api(`/trips/${t.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ advance_amount: t.requested_amount }),
    });
    await reload();
  }

  return (
    <div className="cols">
      <div>
        <div className="section-title">Nueva solicitud de viáticos</div>
        <div className="ticket punched-top punched-bottom">
          <h3>Solicitud de anticipo</h3>
          <div className="sub">Empleada: Laura Martínez · Compras</div>
          <hr className="dashed" />
          <label className="fld"><span>Destino</span>
            <input value={form.destination} onChange={set('destination')} placeholder="Monterrey, NL" /></label>
          <label className="fld"><span>Motivo del viaje</span>
            <input value={form.purpose} onChange={set('purpose')} placeholder="Visita a proveedores" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="fld"><span>Inicio</span>
              <input type="date" value={form.start_date} onChange={set('start_date')} /></label>
            <label className="fld"><span>Fin</span>
              <input type="date" value={form.end_date} onChange={set('end_date')} /></label>
          </div>
          <label className="fld"><span>Presupuesto solicitado (MXN)</span>
            <input type="number" min="0" value={form.requested_amount} onChange={set('requested_amount')} placeholder="2000" /></label>
          {err && <div className="err">{err}</div>}
          <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={create}>
            ✈️ Enviar solicitud
          </button>
        </div>
      </div>

      <div>
        <div className="section-title">Viajes</div>
        <div className="trip-list">
          {trips.map((t) => (
            <div className="ticket punched-top punched-bottom" key={t.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div>
                  <h3>#{t.id} · {t.destination}</h3>
                  <div className="sub">{t.purpose} · {t.start_date} → {t.end_date}</div>
                </div>
                <Stamp v={t.status} />
              </div>
              <hr className="dashed" />
              <div className="row"><span className="lbl">Solicitado</span><span className="val">{money(t.requested_amount)}</span></div>
              <div className="row"><span className="lbl">Anticipo autorizado</span><span className="val">{money(t.advance_amount)}</span></div>
              <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                {t.status === 'requested' && (
                  <button className="btn small" onClick={() => approve(t)}>✅ Aprobar anticipo (modo jefe)</button>
                )}
                {t.status === 'active' && (
                  <button className="btn ghost small" onClick={() => onGoCapture(t.id)}>🧾 Capturar gastos</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
