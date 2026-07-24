import { useEffect, useState, useCallback } from 'react';
import { api, money } from '../api.js';
import TicketResult from '../components/TicketResult.jsx';

export default function Estado({ trip }) {
  const [full, setFull] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api('/trips/' + trip.id).then(setFull).catch(console.error), [trip.id]);
  useEffect(() => { load(); }, [load]);

  if (!full) return <div className="analyzing"><span className="spinner" />Cargando estado…</div>;

  const s = full.stats;
  const pctBar = Math.min(100, s.pct);
  const barClass = s.pct > 100 ? 'over' : s.pct >= 80 ? 'warn' : '';

  return (
    <div>
      <div className="section-title">Estado del viaje · #{full.id} {full.destination} · {full.employee_name}</div>
      <p className="screen-help">
        Tu semáforo del viaje: cuánto llevas, cuánto te queda y qué necesita tu atención.
        Haz clic en cualquier gasto para ver su desglose y corregir conceptos.
        {full.perDiem && <> Referencia diaria: <b>{money(full.perDiem.reference)}</b>{full.perDiem.international ? ' (70 USD/día extranjero)' : ' (per diem nacional)'}.</>}
      </p>

      <div className="kpis">
        <div className="ticket kpi"><span className="v">{money(full.advance_amount)}</span><span className="l">Anticipo</span></div>
        <div className="ticket kpi"><span className="v">{money(s.totalSpent)}</span><span className="l">Gastado</span></div>
        <div className="ticket kpi"><span className={'v ' + (s.available < 0 ? 'red' : 'green')}>{money(s.available)}</span><span className="l">Disponible</span></div>
        <div className="ticket kpi"><span className="v red">{money(s.rejected)}</span><span className="l">Rechazado</span></div>
        <div className="ticket kpi"><span className="v amber">{money(s.review)}</span><span className="l">En revisión</span></div>
      </div>

      <div style={{ marginBottom: 6, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cream-muted)' }}>
        Consumo del anticipo · {s.pct}%
      </div>
      <div className="progress-shell" style={{ marginBottom: 20 }}>
        <div className={'progress-fill ' + barClass} style={{ width: pctBar + '%' }} />
      </div>

      {full.alerts.length > 0 && (
        <>
          <div className="section-title">Alertas</div>
          {full.alerts.map((a, i) => (
            <div className={'alert ' + a.level} key={i}>{a.level === 'bad' ? '⛔' : '⚠️'} {a.text}</div>
          ))}
        </>
      )}

      <div className="section-title">Historial de gastos ({full.expenses.length})</div>
      <div className="expense-list">
        {full.expenses.map((e) =>
          open === e.id ? (
            <div key={e.id}>
              <TicketResult expense={e} compact onUpdate={() => load()} />
              <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setOpen(null)}>▲ Cerrar detalle</button>
            </div>
          ) : (
            <div className="ticket" key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(e.id)}>
              <div className="row">
                <span className="lbl"><b>{e.description}</b> <span className="muted-ink">· {e.expense_date}</span></span>
                <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <span className="val">{money(e.total)}</span>
                  <span className={`stamp ${e.status}`} style={{ transform: 'rotate(-2deg)' }}>
                    {{ approved: 'APROBADO', rejected: 'RECHAZADO', review: 'REVISIÓN', partial: 'PARCIAL' }[e.status]}
                  </span>
                </span>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
