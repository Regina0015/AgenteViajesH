import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, money } from '../api.js';
import TicketResult from '../components/TicketResult.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
function dayTitle(date) {
  const hoy = iso(new Date());
  const ayer = iso(new Date(Date.now() - 86400000));
  const nice = new Date(date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  const label = nice.charAt(0).toUpperCase() + nice.slice(1);
  if (date === hoy) return `Hoy · ${label}`;
  if (date === ayer) return `Ayer · ${label}`;
  return label;
}

export default function Estado({ trip }) {
  const [full, setFull] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => api('/trips/' + trip.id).then(setFull).catch(console.error), [trip.id]);
  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => {
    if (!full) return [];
    const map = new Map();
    for (const e of full.expenses) {
      const d = e.expense_date || 'sin fecha';
      if (!map.has(d)) map.set(d, { date: d, total: 0, expenses: [] });
      const g = map.get(d);
      g.total += Number(e.total);
      g.expenses.push(e);
    }
    return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [full]);

  if (!full) return <div className="analyzing"><span className="spinner" />Cargando estado…</div>;

  const s = full.stats;
  const pctBar = Math.min(100, s.pct);
  const barClass = s.pct > 100 ? 'over' : s.pct >= 80 ? 'warn' : '';
  const ref = full.perDiem?.reference;

  return (
    <div>
      <div className="section-title">Estado del viaje · #{full.id} {full.destination} · {full.employee_name}</div>
      <p className="screen-help">
        Tu semáforo del viaje: cuánto llevas, cuánto te queda y qué necesita atención, día por día.
        {ref && <> Presupuesto por día: <b>{money(ref)}</b>{full.perDiem.international ? ' (70 USD, viaje al extranjero)' : ' (viaje nacional)'}.</>}
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

      <div className="section-title">Gastos por día ({full.expenses.length} en total)</div>
      {days.length === 0 && (
        <p style={{ color: 'var(--cream-muted)' }}>Aún no registras gastos en este viaje — ve a 📷 Capturar gasto o cuéntaselo al 💬 Chat.</p>
      )}
      {days.map((g) => (
        <div key={g.date} style={{ marginBottom: 22 }}>
          <div className="day-head">
            <span>📅 {dayTitle(g.date)}</span>
            <span className="day-total">
              {money(g.total)}
              {ref && (g.total > ref
                ? <em className="over-ref"> · arriba de la referencia ({money(ref)})</em>
                : <em className="ok-ref"> · dentro de la referencia</em>)}
            </span>
          </div>
          <div className="expense-list">
            {g.expenses.map((e) =>
              open === e.id ? (
                <div key={e.id}>
                  <TicketResult expense={e} compact />
                  <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setOpen(null)}>▲ Cerrar detalle</button>
                </div>
              ) : (
                <div className="ticket" key={e.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(e.id)}>
                  <div className="row">
                    <span className="lbl">
                      <b>{e.description}</b>
                      <span className="muted-ink"> · {e.source === 'photo' ? '📷' : e.source === 'chat' ? '💬' : '⌨️'}</span>
                    </span>
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
      ))}
    </div>
  );
}
