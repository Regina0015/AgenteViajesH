import { useEffect, useMemo, useState } from 'react';
import { api, money } from '../api.js';
import Stamp from '../components/Stamp.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const HOY = iso(new Date());
const MANANA = iso(new Date(Date.now() + 86400000));

export default function Solicitud({ trips, reload, onCreated, onGoCapture }) {
  const [form, setForm] = useState({ destination: '', purpose: '', start_date: HOY, end_date: MANANA, requested_amount: '', international: false });
  const [perDiem, setPerDiem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  useEffect(() => {
    api('/policies')
      .then((ps) => setPerDiem(ps.find((p) => p.code === 'POL-DIA')?.params || null))
      .catch(() => {});
  }, []);

  const sugerido = useMemo(() => {
    if (!perDiem || !form.start_date || !form.end_date) return null;
    const days = Math.max(1, Math.round((new Date(form.end_date) - new Date(form.start_date)) / 86400000) + 1);
    const rate = form.international
      ? Math.round((perDiem.ext_per_day_usd ?? 70) * (perDiem.usd_mxn ?? 18.5))
      : (perDiem.mx_per_day ?? 700);
    return { days, rate, total: days * rate };
  }, [perDiem, form.start_date, form.end_date, form.international]);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const t = await api('/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          requested_amount: Number(form.requested_amount) || sugerido?.total || 0,
          international: form.international,
          employee_id: 1,
        }),
      });
      setForm({ destination: '', purpose: '', start_date: HOY, end_date: MANANA, requested_amount: '', international: false });
      await reload();
      onCreated?.(t.id);
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
    <div>
      <div className="section-title">Solicitud de viáticos</div>
      <p className="screen-help">
        Paso 1 del viaje: pide tu anticipo. El presupuesto se sugiere solo con la tarifa por día de la
        política (700 MXN por día en México · 70 USD por día en el extranjero) y tu jefe lo aprueba con un clic.
      </p>
      <div className="cols">
        <div>
          <div className="ticket punched-top punched-bottom">
            <h3>Nueva solicitud de anticipo</h3>
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
            <label className="check-line" style={{ color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={form.international} onChange={set('international')} />
              🌎 Viaje al extranjero (70 USD por día)
            </label>
            <label className="fld"><span>Presupuesto solicitado (MXN)</span>
              <input type="number" min="0" value={form.requested_amount} onChange={set('requested_amount')}
                placeholder={sugerido ? String(sugerido.total) : '2000'} /></label>
            {sugerido && (
              <div className="hint-inline" style={{ color: 'var(--ink-soft)', marginTop: -6, marginBottom: 10 }}>
                💡 Sugerido por política: <b>{money(sugerido.total)}</b> ({sugerido.days} día{sugerido.days > 1 ? 's' : ''} × {money(sugerido.rate)})
                {' '}<button className="vbtn" style={{ width: 'auto', padding: '0 8px' }}
                  onClick={() => setForm({ ...form, requested_amount: String(sugerido.total) })}>usar</button>
              </div>
            )}
            {err && <div className="err">{err}</div>}
            <button className="btn" style={{ width: '100%' }} disabled={busy || !form.destination || !form.start_date || !form.end_date} onClick={create}>
              ✈️ Enviar solicitud
            </button>
          </div>
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Mis viajes</div>
          <div className="trip-list">
            {trips.map((t) => (
              <div className="ticket punched-top punched-bottom" key={t.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div>
                    <h3>#{t.id} · {t.destination} {t.international ? '🌎' : ''}</h3>
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
                    <button className="btn ghost small" onClick={() => onGoCapture(t.id)}>📷 Capturar gastos</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
