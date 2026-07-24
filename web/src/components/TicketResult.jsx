import { api, money } from '../api.js';
import Stamp from './Stamp.jsx';

// Renderiza un gasto como ticket térmico, con veredicto por concepto
// y botones de corrección manual (revisión humana).
export default function TicketResult({ expense, onUpdate, compact }) {
  async function setVerdict(itemId, verdict) {
    const updated = await api('/items/' + itemId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict }),
    });
    onUpdate?.(updated);
  }

  const e = expense;
  return (
    <div className={'ticket punched-top punched-bottom' + (compact ? '' : ' result-pop')}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h3>{e.merchant || e.description}</h3>
          <div className="sub">
            {e.expense_date} · {e.source === 'photo' ? '📷 foto de ticket' : e.source === 'text' ? '⌨️ texto' : '📎 registro'}
            {!e.has_receipt ? ' · sin comprobante' : ''}
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
              <span className="item-actions" title="Corrección manual">
                <button className={'vbtn ok' + (it.verdict === 'approved' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'approved')} title="Aprobar">✓</button>
                <button className={'vbtn no' + (it.verdict === 'rejected' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'rejected')} title="Rechazar">✗</button>
                <button className={'vbtn rev' + (it.verdict === 'review' ? ' sel' : '')} onClick={() => setVerdict(it.id, 'review')} title="Enviar a revisión">?</button>
              </span>
            )}
          </div>
          <div className="item-reason">
            {it.reason} {it.policy_code ? <b>[{it.policy_code}]</b> : null}
            {it.manually_corrected ? ' · ✍️ corregido manualmente' : ''}
          </div>
        </div>
      ))}

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
