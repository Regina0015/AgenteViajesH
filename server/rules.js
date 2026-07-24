// Motor de reglas determinista: la IA clasifica y explica, pero los veredictos,
// montos y límites se deciden aquí, leyendo la tabla `policies` de la BD.
import { q } from './db.js';

export const CATALOG = ['comida', 'hospedaje', 'transporte', 'propina', 'alcohol', 'personal', 'otros'];
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `$${r2(n).toFixed(2)}`;

export function computeTotals(items) {
  const sum = (v) => r2(items.filter((i) => i.verdict === v).reduce((s, i) => s + Number(i.amount), 0));
  const approved = sum('approved');
  const rejected = sum('rejected');
  const review = sum('review');
  let status = 'approved';
  if (review > 0) status = 'review';
  else if (rejected > 0 && approved > 0) status = 'partial';
  else if (rejected > 0 && approved === 0) status = 'rejected';
  return { approved, rejected, review, status };
}

async function loadPolicies() {
  const rows = await q('SELECT * FROM policies WHERE active=1');
  return Object.fromEntries(rows.map((p) => [p.code, { ...p, params: JSON.parse(p.params || '{}') }]));
}

// Resta `excess` de los items aprobados de una lista (empezando por el último)
function shrink(list, excess) {
  let left = r2(excess);
  for (let i = list.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(left, list[i].amount);
    list[i].amount = r2(list[i].amount - take);
    left = r2(left - take);
  }
}

async function priorApproved(tripId, category, date) {
  const rows = date
    ? await q(
        `SELECT COALESCE(SUM(ei.amount),0) AS s FROM expense_items ei
         JOIN expenses e ON e.id = ei.expense_id
         WHERE e.trip_id=$1 AND ei.category=$2 AND ei.verdict='approved' AND e.expense_date=$3`,
        [tripId, category, date]
      )
    : await q(
        `SELECT COALESCE(SUM(ei.amount),0) AS s FROM expense_items ei
         JOIN expenses e ON e.id = ei.expense_id
         WHERE e.trip_id=$1 AND ei.category=$2 AND ei.verdict='approved'`,
        [tripId, category]
      );
  return r2(rows[0].s);
}

async function applyLimit(out, pol, category, scope, tripId, expenseDate) {
  if (!pol || !pol.params.limit) return;
  const limit = pol.params.limit;
  const mine = out.filter((i) => i.category === category && i.verdict === 'approved');
  if (!mine.length) return;
  const mineTotal = r2(mine.reduce((s, i) => s + i.amount, 0));
  let prior = 0;
  if (scope === 'dia') prior = await priorApproved(tripId, category, expenseDate);
  else if (scope === 'viaje') prior = await priorApproved(tripId, category, null);
  const allowance = Math.max(0, r2(limit - prior));
  if (mineTotal <= allowance) return;
  const excess = r2(mineTotal - allowance);
  shrink(mine, excess);
  const perLabel = { evento: 'por evento', noche: 'por noche', dia: 'por día', viaje: 'por viaje' }[pol.params.per] || '';
  out.push({
    description: `Excedente de ${category} (límite ${money(limit)} ${perLabel})`,
    amount: excess,
    category,
    confidence: 1,
    verdict: 'rejected',
    policy_code: pol.code,
    reason: `Supera el límite de ${money(limit)} ${perLabel} para ${category}${prior > 0 ? ` (ya llevabas ${money(prior)} acumulados)` : ''}.`,
  });
}

export async function applyPolicies({ items, tripId, expenseDate, hasReceipt }) {
  const P = await loadPolicies();

  // Paso 1 · veredictos intrínsecos por concepto
  const out = items
    .map((it) => {
      const catRaw = String(it.category || '').toLowerCase();
      const category = CATALOG.includes(catRaw) ? catRaw : 'otros';
      const item = {
        description: String(it.description || 'Concepto').slice(0, 120),
        amount: r2(it.amount),
        category,
        confidence: it.confidence ?? 0.9,
        verdict: 'approved',
        policy_code: null,
        reason: 'Dentro de política.',
      };
      if (it.is_alcohol || category === 'alcohol') {
        item.category = 'alcohol';
        item.verdict = 'rejected';
        item.policy_code = 'POL-ALCOHOL';
        item.reason = 'Bebida alcohólica: nunca es reembolsable; se separa del resto del ticket.';
      } else if (it.is_personal || category === 'personal') {
        item.category = 'personal';
        item.verdict = 'rejected';
        item.policy_code = 'POL-PERSONAL';
        item.reason = 'Gasto personal (ropa, regalos, entretenimiento, snacks): no reembolsable.';
      } else if (it.ambiguous || item.confidence < (P['POL-AMBIGUO']?.params.min_confidence ?? 0.7)) {
        item.verdict = 'review';
        item.policy_code = 'POL-AMBIGUO';
        item.reason = 'Concepto ambiguo: requiere revisión humana.';
      }
      return item;
    })
    .filter((i) => i.amount > 0);

  // Paso 2 · propina: tope % sobre el consumo de comida aprobado
  const tp = P['POL-PROPINA'];
  if (tp) {
    const maxPct = tp.params.max_percent ?? 15;
    const foodBase = r2(out.filter((i) => i.category === 'comida' && i.verdict === 'approved').reduce((s, i) => s + i.amount, 0));
    const tips = out.filter((i) => i.category === 'propina' && i.verdict === 'approved');
    const tipTotal = r2(tips.reduce((s, i) => s + i.amount, 0));
    const cap = r2((foodBase * maxPct) / 100);
    if (tips.length && tipTotal > cap) {
      const excess = r2(tipTotal - cap);
      shrink(tips, excess);
      out.push({
        description: `Propina excedente (tope ${maxPct}%)`,
        amount: excess,
        category: 'propina',
        confidence: 1,
        verdict: 'rejected',
        policy_code: 'POL-PROPINA',
        reason: `La propina supera el ${maxPct}% del consumo permitido.`,
      });
    }
  }

  // Paso 3 · límites por categoría (algunos consultan el histórico en BD)
  await applyLimit(out, P['POL-LIM-COMIDA'], 'comida', null, tripId, expenseDate);
  await applyLimit(out, P['POL-LIM-HOTEL'], 'hospedaje', null, tripId, expenseDate);
  await applyLimit(out, P['POL-LIM-TRANSP'], 'transporte', 'dia', tripId, expenseDate);
  await applyLimit(out, P['POL-LIM-OTROS'], 'otros', 'viaje', tripId, expenseDate);

  // Paso 4 · comprobante obligatorio arriba del mínimo
  const rc = P['POL-COMPROBANTE'];
  const total = r2(out.reduce((s, i) => s + i.amount, 0));
  if (rc && !hasReceipt && total > (rc.params.min_amount ?? 100)) {
    for (const i of out) {
      if (i.verdict === 'approved') {
        i.verdict = 'review';
        i.policy_code = 'POL-COMPROBANTE';
        i.reason = `Sin comprobante y el gasto supera ${money(rc.params.min_amount ?? 100)}: requiere revisión humana.`;
      }
    }
  }

  const clean = out.filter((i) => i.amount > 0);
  const totals = computeTotals(clean);
  return { items: clean, total, ...totals, summary: buildSummary(clean, totals) };
}

export function buildSummary(items, t) {
  const head = {
    approved: '✅ Gasto aprobado.',
    partial: '🟠 Ticket aprobado parcialmente.',
    rejected: '❌ Gasto rechazado.',
    review: '🟡 Gasto enviado a revisión humana.',
  }[t.status];
  const parts = [head];
  const ap = items.filter((i) => i.verdict === 'approved');
  const rj = items.filter((i) => i.verdict === 'rejected');
  const rv = items.filter((i) => i.verdict === 'review');
  if (ap.length) parts.push(`Se aprueban ${money(t.approved)} (${ap.map((i) => i.description).join(', ')}).`);
  for (const i of rj) parts.push(`Se rechazan ${money(i.amount)} — ${i.description}: ${i.reason} [${i.policy_code || 'política'}]`);
  for (const i of rv) parts.push(`En revisión ${money(i.amount)} — ${i.description}: ${i.reason} [${i.policy_code || 'política'}]`);
  return parts.join(' ');
}
