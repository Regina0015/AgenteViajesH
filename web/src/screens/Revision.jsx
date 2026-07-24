import { useEffect, useState, useCallback } from 'react';
import { api, money, CATEGORIES } from '../api.js';
import TicketResult from '../components/TicketResult.jsx';

// Dashboard del revisor (finanzas): cola de conceptos en revisión de TODOS los
// viajes, decisión PASA / NO PASA con justificación, y panorama de rechazos.
export default function Revision() {
  const [data, setData] = useState(null);
  const [notes, setNotes] = useState({});
  const [partial, setPartial] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  const togglePartial = (id) =>
    setPartial((p) => {
      const c = { ...p };
      if (id in c) delete c[id];
      else c[id] = '';
      return c;
    });

  const load = useCallback(() => api('/review').then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="analyzing"><span className="spinner" />Cargando cola de revisión…</div>;

  const sum = (v) => data.sums.find((s) => s.verdict === v) || { n: 0, s: 0 };
  const pend = sum('review'), ok = sum('approved'), no = sum('rejected');

  async function resolve(item, verdict, approvedAmount = null) {
    setBusy(item.id); setErr(null);
    try {
      await api('/items/' + item.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verdict,
          approved_amount: approvedAmount,
          note: notes[item.id] || null,
          reviewer: 'Marco Ruiz',
        }),
      });
      setNotes((n) => ({ ...n, [item.id]: '' }));
      setPartial((p) => { const c = { ...p }; delete c[item.id]; return c; });
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(null); }
  }

  async function recat(item, category) {
    await api('/items/' + item.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, reviewer: 'Marco Ruiz' }),
    });
    await load();
  }

  return (
    <div>
      <div className="section-title">Mesa de revisión · Marco Ruiz (Finanzas) · todos los viajes</div>
      <p className="screen-help">
        Todo lo que el agente no pudo decidir solo llega aquí. Lee la explicación de la IA, ajusta la
        categoría si hace falta, escribe tu justificación y decide: ✓ Pasa o ✗ No pasa. Tu decisión
        queda en el expediente junto a la de la IA.
      </p>

      <div className="kpis">
        <div className="ticket kpi"><span className="v amber">{Number(pend.n)}</span><span className="l">Por revisar</span></div>
        <div className="ticket kpi"><span className="v amber">{money(pend.s)}</span><span className="l">$ en revisión</span></div>
        <div className="ticket kpi"><span className="v green">{money(ok.s)}</span><span className="l">Aprobado global</span></div>
        <div className="ticket kpi"><span className="v red">{money(no.s)}</span><span className="l">Rechazado global</span></div>
      </div>

      {data.byCat.length > 0 && (
        <>
          <div className="section-title">Rechazos por categoría</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {data.byCat.map((c) => (
              <span className="chip" key={c.category}>
                {c.category}: <b style={{ color: 'var(--paper)' }}>{money(c.s)}</b> ({Number(c.n)})
              </span>
            ))}
          </div>
        </>
      )}

      {data.tripAlerts?.length > 0 && (
        <>
          <div className="section-title">Alertas por viaje</div>
          {data.tripAlerts.map((t) =>
            t.alerts.map((a, i) => (
              <div className={'alert ' + a.level} key={t.trip_id + '-' + i}>
                {a.level === 'bad' ? '⛔' : '⚠️'}{' '}
                <span><b>Viaje #{t.trip_id} · {t.destination} ({t.employee_name}):</b> {a.text}</span>
              </div>
            ))
          )}
        </>
      )}

      {err && <div className="err">{err}</div>}

      <div className="section-title">Cola de revisión ({data.pending.length})</div>
      {data.pending.length === 0 && (
        <div className="ticket punched-top punched-bottom" style={{ maxWidth: 460, textAlign: 'center' }}>
          <span className="stamp approved big">MESA LIMPIA</span>
          <p className="sub" style={{ marginTop: 10 }}>No hay conceptos pendientes de revisión.</p>
        </div>
      )}
      <div className="expense-list">
        {data.pending.map((it) => (
          <div className="ticket punched-top punched-bottom" key={it.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <h3>{it.description}</h3>
                <div className="sub">
                  {it.employee_name} · viaje #{it.trip_id} {it.destination} · {it.expense_date} ·{' '}
                  {it.merchant || it.expense_description}
                  {it.receipt_path && (
                    <> · <a href={'/api/receipts/' + it.receipt_path} target="_blank" rel="noreferrer">📎 ver ticket</a></>
                  )}
                </div>
                <div className="item-reason" style={{ marginTop: 6 }}>
                  🤖 Agente: {it.reason} {it.policy_code && <b>[{it.policy_code}]</b>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="item-amt" style={{ fontSize: 20 }}>{money(it.amount)}</div>
                <select value={it.category} onChange={(e) => recat(it, e.target.value)} style={{ marginTop: 6 }}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <hr className="dashed" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                style={{ flex: 1, minWidth: 200, background: 'rgba(28,27,24,.06)', color: 'var(--ink)', border: '1px dashed rgba(28,27,24,.35)' }}
                placeholder="Justificación del revisor (queda en el expediente)…"
                value={notes[it.id] || ''}
                onChange={(e) => setNotes((n) => ({ ...n, [it.id]: e.target.value }))}
              />
              <button className="btn small" style={{ background: 'var(--green)' }} disabled={busy === it.id} onClick={() => resolve(it, 'approved')}>
                ✓ Pasa
              </button>
              <button className="btn small ghost" disabled={busy === it.id} onClick={() => togglePartial(it.id)}>
                ◐ Parcial
              </button>
              <button className="btn small" disabled={busy === it.id} onClick={() => resolve(it, 'rejected')}>
                ✗ No pasa
              </button>
            </div>
            {it.id in partial && (
              <div className="partial-row">
                <span>Del total de <b>{money(it.amount)}</b>, aprobar $</span>
                <input
                  type="number" min="0.01" max={it.amount} step="0.01"
                  value={partial[it.id]}
                  onChange={(e) => setPartial((p) => ({ ...p, [it.id]: e.target.value }))}
                />
                <span>→ se rechazan <b className="red">{money(Math.max(0, it.amount - (Number(partial[it.id]) || 0)))}</b></span>
                <button
                  className="btn small"
                  disabled={busy === it.id || !(Number(partial[it.id]) > 0 && Number(partial[it.id]) < Number(it.amount))}
                  onClick={() => resolve(it, 'partial', Number(partial[it.id]))}
                >
                  Confirmar parcial
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="section-title">Todos los gastos · decisión final de Finanzas</div>
      <p className="screen-help">
        Aquí está todo lo que el agente ya decidió — aprobado o rechazado. Finanzas puede corregir
        cualquier veredicto con los botones ✓ / ✗ / ? de cada concepto; el cambio queda firmado.
      </p>
      {(() => {
        const byTrip = new Map();
        for (const e of data.expenses || []) {
          if (!byTrip.has(e.trip_id)) byTrip.set(e.trip_id, { e0: e, list: [] });
          byTrip.get(e.trip_id).list.push(e);
        }
        const dayName = (d) => {
          if (!d) return 'Sin fecha';
          const s = new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
          return s.charAt(0).toUpperCase() + s.slice(1);
        };
        return [...byTrip.values()].map(({ e0, list }) => {
          const byDay = new Map();
          for (const e of list) {
            const d = e.expense_date || '';
            if (!byDay.has(d)) byDay.set(d, []);
            byDay.get(d).push(e);
          }
          const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
          return (
            <details key={e0.trip_id} className="trip-fold" open={list.some((x) => x.status === 'review')}>
              <summary>
                Viaje #{e0.trip_id} · {e0.destination} · {e0.employee_name} — {list.length} gasto{list.length > 1 ? 's' : ''}
              </summary>
              {days.map(([d, exps]) => (
                <div key={d} style={{ marginTop: 12 }}>
                  <div className="day-head"><span>📅 {dayName(d)}</span></div>
                  <div className="expense-list">
                    {exps.map((e) => (
                      <TicketResult key={e.id} expense={e} compact reviewer="Marco Ruiz" onUpdate={() => load()} />
                    ))}
                  </div>
                </div>
              ))}
            </details>
          );
        });
      })()}

      {data.resolved.length > 0 && (
        <>
          <div className="section-title">Resueltos recientemente</div>
          <div className="expense-list">
            {data.resolved.map((it) => (
              <div className="ticket" key={it.id}>
                <div className="row">
                  <span className="lbl">
                    <b>{it.description}</b> <span className="muted-ink">· {it.employee_name} · #{it.trip_id} {it.destination}</span>
                    {it.review_note && <span className="muted-ink"> · ✍️ “{it.review_note}”</span>}
                    {it.reviewed_by && <span className="muted-ink"> — {it.reviewed_by}</span>}
                  </span>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span className="val">{money(it.amount)}</span>
                    <span className={`stamp ${it.verdict}`}>{it.verdict === 'approved' ? 'PASÓ' : 'NO PASÓ'}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
