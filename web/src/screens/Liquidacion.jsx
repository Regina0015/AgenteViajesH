import { useEffect, useState, useCallback } from 'react';
import { api, money } from '../api.js';

export default function Liquidacion({ trip, reload }) {
  const [liq, setLiq] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(
    () => api(`/trips/${trip.id}/liquidation/preview`).then(setLiq).catch((e) => setErr(e.message)),
    [trip.id]
  );
  useEffect(() => { load(); }, [load]);

  async function generate() {
    setBusy(true); setErr(null);
    try {
      const L = await api(`/trips/${trip.id}/liquidation`, { method: 'POST' });
      setLiq(L);
      await reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!liq) return <div className="analyzing"><span className="spinner" />Calculando liquidación…</div>;

  const deduction = liq.payroll_deduction > 0;
  const refund = liq.refund_to_company > 0;

  return (
    <div className="cols">
      <div>
        <div className="section-title">Liquidación · viaje #{trip.id} {trip.destination}</div>

        <div className="ticket punched-top punched-bottom" style={{ maxWidth: 560 }}>
          <h3>Liquidación de gastos de viaje</h3>
          <div className="sub">Laura Martínez · {trip.destination} · {trip.start_date} → {trip.end_date}</div>
          <hr className="dashed" />

          {liq.detail.map((d) => (
            <div className="row" key={d.id}>
              <span className="lbl">{d.description} <span className="muted-ink">· {d.date}</span></span>
              <span className="val">{money(d.total)}</span>
            </div>
          ))}

          <hr className="dashed" />
          <div className="row"><span className="lbl">Anticipo depositado</span><span className="val">{money(liq.advance_amount)}</span></div>
          <div className="row"><span className="lbl">Total gastado</span><span className="val">{money(liq.total_spent)}</span></div>
          <div className="row"><span className="lbl red">No reembolsable (política)</span><span className="val red">−{money(liq.rejected_total)}</span></div>
          {liq.review_total > 0 && (
            <div className="row"><span className="lbl amber">Pendiente de revisión</span><span className="val amber">{money(liq.review_total)}</span></div>
          )}
          <div className="row"><span className="lbl">Gasto corporativo válido</span><span className="val">{money(liq.approved_total)}</span></div>
          <div className="row"><span className="lbl amber">Excedente sobre anticipo</span><span className="val amber">{money(liq.over_budget)}</span></div>

          <hr className="dashed" />
          {deduction && (
            <div className="row total">
              <span className="lbl red">Descuento vía nómina</span>
              <span className="val red">{money(liq.payroll_deduction)}</span>
            </div>
          )}
          {refund && (
            <div className="row total">
              <span className="lbl green">Devolución a la empresa</span>
              <span className="val green">{money(liq.refund_to_company)}</span>
            </div>
          )}
          {!deduction && !refund && (
            <div className="row total"><span className="lbl green">Saldo en ceros</span><span className="val green">$0.00</span></div>
          )}

          {liq.saved && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <span className="stamp approved big">LIQUIDADO</span>
            </div>
          )}

          <div className="barcode" />
          <div className="folio">LIQ-{String(trip.id).padStart(5, '0')} · TALÓN · {trip.destination.toUpperCase()}</div>
        </div>
      </div>

      <div>
        <div className="section-title">Cierre</div>
        {liq.pending_review && (
          <div className="alert warn">
            ⚠️ Hay {money(liq.review_total)} en conceptos pendientes de revisión humana. Resuélvelos en
            «Estado del viaje» (abre el gasto y corrige el concepto) antes de cerrar — mientras tanto no
            cuentan como gasto válido.
          </div>
        )}
        <p style={{ color: 'var(--cream-muted)', fontSize: 14, maxWidth: 420 }}>
          Reglas aplicadas: lo rechazado por política lo absorbe el empleado [POL-ALCOHOL, POL-PERSONAL…];
          el anticipo es un tope, el excedente va a nómina [POL-TOPE]; si se gastó menos del anticipo,
          el sobrante se devuelve a la empresa.
        </p>
        {err && <div className="err">{err}</div>}
        <div style={{ display: 'grid', gap: 10, maxWidth: 420 }} className="no-print">
          <button className="btn" disabled={busy || trip.status === 'closed'} onClick={generate}>
            {trip.status === 'closed' ? '✅ Viaje cerrado' : busy ? 'Generando…' : '🔒 Generar liquidación y cerrar viaje'}
          </button>
          <button className="btn ghost" onClick={() => window.print()}>🖨️ Imprimir / PDF</button>
        </div>
      </div>
    </div>
  );
}
