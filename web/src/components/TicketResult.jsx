import { useState } from 'react';
import { api, money } from '../api.js';
import Stamp from './Stamp.jsx';

// Renderiza un gasto como ticket térmico, con veredicto por concepto.
// Con `reviewer` + `onUpdate`, muestra los botones de decisión final (✓/✗/?)
// y un campo de comentario que se firma junto con la decisión.
export default function TicketResult({ expense, onUpdate, compact, reviewer }) {
  const [note, setNote] = useState('');
  const [partialId, setPartialId] = useState(null);
  const [partialAmt, setPartialAmt] = useState('');
  const [err, setErr] = useState(null);

  async function setVerdict(itemId, verdict, approvedAmount = null) {
    setErr(null);
    try {
      const updated = await api('/items/' + itemId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verdict,
          approved_amount: approvedAmount,
          reviewer: reviewer || null,
          note: reviewer ? note.trim() || null : null,
        }),
      });
      if (reviewer) setNote('');
      setPartialId(null);
      setPartialAmt('');
      onUpdate?.(updated);
    } catch (e) {
      setErr(e.message);
    }
  }

  const e = expense;
  return (
    <div className={'ticket punched-top punched-bottom' + (compact ? '' : ' result-pop')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h3>{e.merchant || e.description}</h3>
          <div className="sub">
            {e.expense_date} · {e.source === 'photo' ? '📷 foto de ticket' : e.source === 'chat' ? '💬 por chat' : e.source === 'text' ? '⌨️ texto' : '📋 registro'}
            {!e.has_receipt ? ' · sin comprobante' : ''}
            {e.receipt_path && (
              <> · <a href={'/api/receipts/' + e.receipt_path} target="_blank" rel="noreferrer">📎 evidencia</a></>
            )}
          </div>
        </div>
        <Stamp v={e.status} big={!compact} />
      </div>

      <hr className="dashed" />

      {e.items.map((it) => (
        <div className="item-row" key={it.id}>
          <div className="item-head">
            <span className="item-desc">{it.description}</span>
            <span className="item-cat">{it.category}</span>
            <span className={'item-amt ' + (it.verdict === 'rejected' ? 'red' : it.verdict === 'review' ? 'amber' : 'green')}>
              {money(it.amount)}
            </span>
            {onUpdate && (
              <span className="item-actions" title="Decisión final">
                <button className={'vbtn ok' + (it.verdict === 'approved' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'approved')} title="Aprobar todo">✓</button>
                {reviewer && (
                  <button className={'vbtn rev' + (partialId === it.id ? ' sel' : '')} title="Aprobación parcial (indica el monto)"
                    onClick={() => { setPartialId(partialId === it.id ? null : it.id); setPartialAmt(''); }}>◐</button>
                )}
                <button className={'vbtn no' + (it.verdict === 'rejected' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'rejected')} title="Rechazar todo">✗</button>
                <button className={'vbtn rev' + (it.verdict === 'review' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'review')} title="Enviar a revisión">?</button>
              </span>
            )}
          </div>
          {partialId === it.id && (
            <div className="partial-row">
              <span>Del total de <b>{money(it.amount)}</b>, aprobar $</span>
              <input type="number" min="0.01" max={it.amount} step="0.01" value={partialAmt}
                onChange={(ev) => setPartialAmt(ev.target.value)} />
              <span>→ se rechazan <b className="red">{money(Math.max(0, it.amount - (Number(partialAmt) || 0)))}</b></span>
              <button className="btn small"
                disabled={!(Number(partialAmt) > 0 && Number(partialAmt) < Number(it.amount))}
                onClick={() => setVerdict(it.id, 'partial', Number(partialAmt))}>
                Confirmar
              </button>
            </div>
          )}
          <div className="item-reason">
            {it.reason} {it.policy_code ? <b>[{it.policy_code}]</b> : null}
            {it.review_note
              ? ` · ✍️ ${it.reviewed_by || 'Revisor'}: “${it.review_note}”`
              : it.manually_corrected ? ' · ✍️ corregido manualmente' : ''}
          </div>
        </div>
      ))}

      {err && <div className="err">{err}</div>}
      {reviewer && onUpdate && (
        <input
          className="rev-note"
          placeholder="💬 Comentario del revisor — se guarda con tu próxima decisión ✓ / ✗ / ?"
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
        />
      )}

      <hr className="dashed" />
      <div className="row"><span className="lbl green">Aprobado</span><span className="val green">{money(e.approved_amount)}</span></div>
      <div className="row"><span className="lbl red">Rechazado</span><span className="val red">{money(e.rejected_amount)}</span></div>
      {Number(e.review_amount) > 0 && (
        <div className="row"><span className="lbl amber">En revisión</span><span className="val amber">{money(e.review_amount)}</span></div>
      )}
      <div className="row total"><span className="lbl">Total ticket</span><span className="val">{money(e.total)}</span></div>

      {!compact && e.agent_summary && <div className="summary-note">{e.agent_summary}</div>}

      {!compact && (
        <>
          <div className="barcode" />
          <div className="folio">FOLIO EXP-{String(e.id).padStart(5, '0')} · TALÓN</div>
        </>
      )}
    </div>
  );
}
