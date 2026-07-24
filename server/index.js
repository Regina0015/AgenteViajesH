import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, isPg } from './db.js';
import { applyPolicies, computeTotals, buildSummary, r2 } from './rules.js';
import { extractItems, azureReady } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await initDb();

const app = express();
app.use(express.json());

const UP = path.join(__dirname, 'uploads');
fs.mkdirSync(UP, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.use('/api/receipts', express.static(UP));

const extFromMime = (m) => ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }[m] || '.jpg');

// ── Salud / configuración ─────────────────────────────────────────
app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    agent: azureReady() ? 'azure' : 'mock',
    model: azureReady() ? process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o' : 'analizador local',
    db: isPg ? 'aiven-postgres' : 'sqlite-local',
  })
);

app.get('/api/employees', async (_req, res) => res.json(await q('SELECT * FROM employees ORDER BY id')));

app.get('/api/policies', async (_req, res) =>
  res.json((await q('SELECT * FROM policies ORDER BY id')).map((p) => ({ ...p, params: JSON.parse(p.params || '{}') })))
);

// ── Viajes ────────────────────────────────────────────────────────
app.get('/api/trips', async (_req, res) =>
  res.json(await q('SELECT t.*, e.name AS employee_name FROM trips t JOIN employees e ON e.id=t.employee_id ORDER BY t.id'))
);

app.post('/api/trips', async (req, res) => {
  const { employee_id = 1, destination, purpose, start_date, end_date, requested_amount } = req.body;
  if (!destination || !start_date || !end_date)
    return res.status(400).json({ error: 'Faltan campos: destino y fechas del viaje.' });
  const [t] = await q(
    `INSERT INTO trips(employee_id,destination,purpose,start_date,end_date,requested_amount,status)
     VALUES($1,$2,$3,$4,$5,$6,'requested') RETURNING *`,
    [employee_id, destination, purpose || '', start_date, end_date, r2(requested_amount)]
  );
  res.json(t);
});

app.post('/api/trips/:id/approve', async (req, res) => {
  const [trip] = await q('SELECT * FROM trips WHERE id=$1', [req.params.id]);
  if (!trip) return res.status(404).json({ error: 'Viaje no encontrado' });
  const amount = r2(req.body.advance_amount ?? trip.requested_amount);
  const [t] = await q(`UPDATE trips SET advance_amount=$1, status='active' WHERE id=$2 RETURNING *`, [amount, trip.id]);
  res.json(t);
});

async function tripFull(id) {
  const [trip] = await q(
    'SELECT t.*, e.name AS employee_name FROM trips t JOIN employees e ON e.id=t.employee_id WHERE t.id=$1',
    [id]
  );
  if (!trip) return null;
  const expenses = await q('SELECT * FROM expenses WHERE trip_id=$1 ORDER BY expense_date, id', [id]);
  const items = expenses.length
    ? await q(
        `SELECT * FROM expense_items WHERE expense_id IN (${expenses.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY id`,
        expenses.map((e) => e.id)
      )
    : [];
  for (const e of expenses) e.items = items.filter((i) => i.expense_id === e.id);

  const totalSpent = r2(expenses.reduce((s, e) => s + Number(e.total), 0));
  const approved = r2(expenses.reduce((s, e) => s + Number(e.approved_amount), 0));
  const rejected = r2(expenses.reduce((s, e) => s + Number(e.rejected_amount), 0));
  const review = r2(expenses.reduce((s, e) => s + Number(e.review_amount), 0));
  const available = r2(Number(trip.advance_amount) - totalSpent);
  const pct = Number(trip.advance_amount) > 0 ? Math.round((totalSpent / Number(trip.advance_amount)) * 100) : 0;

  const alerts = [];
  const reviewCount = items.filter((i) => i.verdict === 'review').length;
  if (reviewCount > 0)
    alerts.push({ level: 'warn', text: `${reviewCount} concepto(s) en revisión humana por $${review.toFixed(2)}. Resuélvelos antes de liquidar.` });
  if (pct >= 80 && pct <= 100) alerts.push({ level: 'warn', text: `Llevas ${pct}% del anticipo consumido.` });
  if (available < 0)
    alerts.push({ level: 'bad', text: `Excediste el anticipo por $${Math.abs(available).toFixed(2)} — el excedente va a descuento de nómina [POL-TOPE].` });
  if (rejected > 0) alerts.push({ level: 'bad', text: `$${rejected.toFixed(2)} rechazados por política — no serán reembolsados.` });
  const outside = expenses.filter((e) => e.expense_date && (e.expense_date < trip.start_date || e.expense_date > trip.end_date));
  if (outside.length) alerts.push({ level: 'warn', text: `${outside.length} gasto(s) con fecha fuera del rango del viaje (${trip.start_date} → ${trip.end_date}).` });

  return { ...trip, expenses, stats: { totalSpent, approved, rejected, review, available, pct }, alerts };
}

app.get('/api/trips/:id', async (req, res) => {
  const t = await tripFull(req.params.id);
  if (!t) return res.status(404).json({ error: 'Viaje no encontrado' });
  res.json(t);
});

// ── Gastos: aquí vive el agente ───────────────────────────────────
app.post('/api/trips/:id/expenses', upload.single('photo'), async (req, res) => {
  try {
    const [trip] = await q('SELECT * FROM trips WHERE id=$1', [req.params.id]);
    if (!trip) return res.status(404).json({ error: 'Viaje no encontrado' });

    const description = (req.body.description || '').trim();
    let imageBase64 = null, mime = null, receiptPath = null;
    if (req.file) {
      mime = req.file.mimetype || 'image/jpeg';
      receiptPath = `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extFromMime(mime)}`;
      fs.writeFileSync(path.join(UP, receiptPath), req.file.buffer);
      imageBase64 = req.file.buffer.toString('base64');
    }
    if (!description && !imageBase64)
      return res.status(400).json({ error: 'Manda una descripción del gasto o la foto del ticket.' });

    const hasReceipt = req.file ? 1 : String(req.body.has_receipt) === 'false' ? 0 : 1;
    const t0 = Date.now();
    const ex = await extractItems({ text: description || null, imageBase64, mime });
    if (!ex.items.length)
      return res.status(422).json({ error: 'No pude identificar conceptos ni montos. Intenta con otra foto o describe el gasto con el monto.' });

    const expense_date = req.body.expense_date || ex.date || new Date().toISOString().slice(0, 10);
    const result = await applyPolicies({ items: ex.items, tripId: trip.id, expenseDate: expense_date, hasReceipt });
    const summary = ex.note ? `${ex.note} ${result.summary}` : result.summary;

    const [e] = await q(
      `INSERT INTO expenses(trip_id,description,merchant,expense_date,total,source,has_receipt,receipt_path,status,approved_amount,rejected_amount,review_amount,agent_summary)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        trip.id,
        description || ex.merchant || 'Ticket',
        ex.merchant,
        expense_date,
        result.total,
        req.file ? 'photo' : 'text',
        hasReceipt,
        receiptPath,
        result.status,
        result.approved,
        result.rejected,
        result.review,
        summary,
      ]
    );
    for (const it of result.items) {
      await q(
        `INSERT INTO expense_items(expense_id,description,amount,category,verdict,policy_code,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [e.id, it.description, it.amount, it.category, it.verdict, it.policy_code, it.reason]
      );
    }
    await q(
      `INSERT INTO agent_logs(expense_id,mode,model,latency_ms,input_summary,output_json) VALUES($1,$2,$3,$4,$5,$6)`,
      [e.id, ex.mode, ex.model || '', Date.now() - t0, description || `foto:${receiptPath}`, JSON.stringify(ex.items)]
    );
    e.items = await q('SELECT * FROM expense_items WHERE expense_id=$1 ORDER BY id', [e.id]);
    res.json(e);
  } catch (err) {
    console.error('[expenses]', err);
    res.status(500).json({ error: 'El agente no pudo procesar el gasto: ' + err.message });
  }
});

// Corrección manual de un concepto (empleado o revisor).
// Conserva la explicación del agente y guarda aparte la justificación humana.
app.patch('/api/items/:id', async (req, res) => {
  const { verdict, category, note, reviewer } = req.body;
  if (verdict && !['approved', 'rejected', 'review'].includes(verdict))
    return res.status(400).json({ error: 'Veredicto inválido' });
  const [item] = await q('SELECT * FROM expense_items WHERE id=$1', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Concepto no encontrado' });

  await q(
    `UPDATE expense_items SET verdict=COALESCE($1,verdict), category=COALESCE($2,category),
     manually_corrected=1, review_note=COALESCE($3,review_note), reviewed_by=COALESCE($4,reviewed_by)
     WHERE id=$5`,
    [verdict || null, category || null, note || null, reviewer || null, item.id]
  );
  const items = await q('SELECT * FROM expense_items WHERE expense_id=$1 ORDER BY id', [item.expense_id]);
  const t = computeTotals(items);
  const [e] = await q(
    `UPDATE expenses SET approved_amount=$1, rejected_amount=$2, review_amount=$3, status=$4, agent_summary=$5
     WHERE id=$6 RETURNING *`,
    [t.approved, t.rejected, t.review, t.status, buildSummary(items, t), item.expense_id]
  );
  e.items = items;
  res.json(e);
});

// ── Dashboard del revisor (finanzas) ──────────────────────────────
app.get('/api/review', async (_req, res) => {
  const base = `SELECT ei.*, e.merchant, e.description AS expense_description, e.expense_date,
      e.receipt_path, e.source, e.trip_id, t.destination, emp.name AS employee_name
    FROM expense_items ei
    JOIN expenses e ON e.id = ei.expense_id
    JOIN trips t ON t.id = e.trip_id
    JOIN employees emp ON emp.id = t.employee_id`;
  const pending = await q(base + ` WHERE ei.verdict='review' ORDER BY e.expense_date, ei.id`);
  const resolved = await q(
    base + ` WHERE ei.manually_corrected=1 AND ei.verdict<>'review' ORDER BY ei.id DESC LIMIT 20`
  );
  const sums = await q(
    `SELECT verdict, COUNT(*) AS n, COALESCE(SUM(amount),0) AS s FROM expense_items GROUP BY verdict`
  );
  const byCat = await q(
    `SELECT category, COUNT(*) AS n, COALESCE(SUM(amount),0) AS s
     FROM expense_items WHERE verdict='rejected' GROUP BY category ORDER BY s DESC`
  );
  res.json({ pending, resolved, sums, byCat });
});

// ── Liquidación ───────────────────────────────────────────────────
async function computeLiquidation(tripId) {
  const trip = await tripFull(tripId);
  if (!trip) return null;
  const { totalSpent, approved, rejected, review } = trip.stats;
  const advance = r2(trip.advance_amount);
  const overBudget = Math.max(0, r2(approved - advance));
  const payrollDeduction = r2(rejected + overBudget);
  const refund = Math.max(0, r2(advance - totalSpent));
  const detail = trip.expenses.map((e) => ({
    id: e.id, description: e.description, date: e.expense_date, total: Number(e.total),
    approved: Number(e.approved_amount), rejected: Number(e.rejected_amount), review: Number(e.review_amount), status: e.status,
  }));
  return {
    trip_id: trip.id, advance_amount: advance, total_spent: totalSpent,
    rejected_total: rejected, review_total: review, approved_total: approved,
    over_budget: overBudget, payroll_deduction: payrollDeduction, refund_to_company: refund,
    detail, pending_review: review > 0,
  };
}

app.get('/api/trips/:id/liquidation/preview', async (req, res) => {
  const L = await computeLiquidation(req.params.id);
  if (!L) return res.status(404).json({ error: 'Viaje no encontrado' });
  const saved = await q('SELECT * FROM liquidations WHERE trip_id=$1', [req.params.id]);
  res.json({ ...L, saved: saved.length > 0 });
});

app.post('/api/trips/:id/liquidation', async (req, res) => {
  const L = await computeLiquidation(req.params.id);
  if (!L) return res.status(404).json({ error: 'Viaje no encontrado' });
  await q(
    `INSERT INTO liquidations(trip_id,advance_amount,total_spent,rejected_total,review_total,approved_total,over_budget,payroll_deduction,refund_to_company,detail)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (trip_id) DO UPDATE SET
       advance_amount=excluded.advance_amount, total_spent=excluded.total_spent,
       rejected_total=excluded.rejected_total, review_total=excluded.review_total,
       approved_total=excluded.approved_total, over_budget=excluded.over_budget,
       payroll_deduction=excluded.payroll_deduction, refund_to_company=excluded.refund_to_company,
       detail=excluded.detail`,
    [L.trip_id, L.advance_amount, L.total_spent, L.rejected_total, L.review_total, L.approved_total, L.over_budget, L.payroll_deduction, L.refund_to_company, JSON.stringify(L.detail)]
  );
  await q(`UPDATE trips SET status='closed' WHERE id=$1`, [L.trip_id]);
  res.json({ ...L, saved: true });
});

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`[api] 🧾 Talón corriendo en http://localhost:${PORT}`);
  console.log(`[api] Agente IA: ${azureReady() ? 'Azure (' + (process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o') + ')' : 'simulado (llena .env para activar Azure)'}`);
});
