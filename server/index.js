import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, q, isPg } from './db.js';
import { applyPolicies, computeTotals, buildSummary, r2 } from './rules.js';
import { extractItems, azureReady, chatAgent } from './agent.js';

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
  const { employee_id = 1, destination, purpose, start_date, end_date, requested_amount, international } = req.body;
  if (!destination || !start_date || !end_date)
    return res.status(400).json({ error: 'Faltan campos: destino y fechas del viaje.' });
  const [t] = await q(
    `INSERT INTO trips(employee_id,destination,purpose,start_date,end_date,requested_amount,international,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'requested') RETURNING *`,
    [employee_id, destination, purpose || '', start_date, end_date, r2(requested_amount), international ? 1 : 0]
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

  // Panel de alertas minimalista: solo lo accionable. Los montos rechazados y
  // el excedente ya se ven en los KPIs y en la liquidación.
  const alerts = [];
  const reviewCount = items.filter((i) => i.verdict === 'review').length;
  if (reviewCount > 0)
    alerts.push({ level: 'warn', text: `${reviewCount} concepto(s) en revisión humana por $${review.toFixed(2)}. Resuélvelos antes de liquidar.` });
  if (pct >= 80 && pct <= 100) alerts.push({ level: 'warn', text: `Llevas ${pct}% del anticipo consumido.` });
  const outside = expenses.filter((e) => e.expense_date && (e.expense_date < trip.start_date || e.expense_date > trip.end_date));
  if (outside.length) alerts.push({ level: 'warn', text: `${outside.length} gasto(s) con fecha fuera del rango del viaje (${trip.start_date} → ${trip.end_date}).` });

  // Per diem: referencia diaria configurada (alerta, no rechazo)
  let perDiem = null;
  const [pd] = await q(`SELECT params FROM policies WHERE code='POL-DIA' AND active=1`);
  if (pd) {
    const p = JSON.parse(pd.params || '{}');
    const ref = trip.international
      ? r2((p.ext_per_day_usd ?? 70) * (p.usd_mxn ?? 18.5))
      : (p.mx_per_day ?? 700);
    perDiem = { reference: ref, international: !!trip.international, params: p };
    const byDay = {};
    for (const e of expenses) byDay[e.expense_date] = r2((byDay[e.expense_date] || 0) + Number(e.total));
    const diasArriba = Object.values(byDay).filter((tot) => tot > ref).length;
    if (diasArriba > 0)
      alerts.push({
        level: 'warn',
        text: `${diasArriba} día(s) arriba del presupuesto por día de $${ref.toFixed(2)} [POL-DIA] — el detalle está en los gastos por día.`,
      });
  }

  return { ...trip, expenses, stats: { totalSpent, approved, rejected, review, available, pct }, alerts, perDiem };
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
// verdict='partial' + approved_amount divide el concepto: parte aprobada + parte rechazada.
app.patch('/api/items/:id', async (req, res) => {
  const { verdict, category, note, reviewer, approved_amount } = req.body;
  if (verdict && !['approved', 'rejected', 'review', 'partial'].includes(verdict))
    return res.status(400).json({ error: 'Veredicto inválido' });
  const [item] = await q('SELECT * FROM expense_items WHERE id=$1', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Concepto no encontrado' });

  if (verdict === 'partial') {
    const amt = r2(approved_amount);
    if (!(amt > 0) || amt >= r2(item.amount))
      return res.status(400).json({ error: `El monto aprobado debe ser mayor a $0 y menor al total del concepto ($${r2(item.amount).toFixed(2)}).` });
    const rejectedPart = r2(r2(item.amount) - amt);
    await q(
      `UPDATE expense_items SET amount=$1, verdict='approved', reason=$2,
       manually_corrected=1, review_note=COALESCE($3,review_note), reviewed_by=COALESCE($4,reviewed_by) WHERE id=$5`,
      [amt, `Aprobación parcial del revisor: $${amt.toFixed(2)} de $${r2(item.amount).toFixed(2)}.`, note || null, reviewer || null, item.id]
    );
    await q(
      `INSERT INTO expense_items(expense_id,description,amount,category,verdict,policy_code,reason,manually_corrected,reviewed_by,review_note)
       VALUES($1,$2,$3,$4,'rejected',$5,$6,1,$7,$8)`,
      [
        item.expense_id,
        `Parte no aprobada — ${item.description}`.slice(0, 120),
        rejectedPart,
        item.category,
        item.policy_code,
        `Rechazo parcial del revisor: $${rejectedPart.toFixed(2)} de $${r2(item.amount).toFixed(2)}.`,
        reviewer || null,
        note || null,
      ]
    );
  } else {
    await q(
      `UPDATE expense_items SET verdict=COALESCE($1,verdict), category=COALESCE($2,category),
       manually_corrected=1, review_note=COALESCE($3,review_note), reviewed_by=COALESCE($4,reviewed_by)
       WHERE id=$5`,
      [verdict || null, category || null, note || null, reviewer || null, item.id]
    );
  }
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

// ── Chat conversacional con Talón ─────────────────────────────────
async function registerTextExpense(trip, text, expense_date, media = null) {
  const t0 = Date.now();
  const ex = await extractItems({ text: text || null, imageBase64: media?.imageBase64 || null, mime: media?.mime || null });
  if (!ex.items.length) return null;
  const date = expense_date || ex.date || new Date().toISOString().slice(0, 10);
  const result = await applyPolicies({ items: ex.items, tripId: trip.id, expenseDate: date, hasReceipt: 1 });
  const summary = ex.note ? `${ex.note} ${result.summary}` : result.summary;
  const [e] = await q(
    `INSERT INTO expenses(trip_id,description,merchant,expense_date,total,source,has_receipt,receipt_path,status,approved_amount,rejected_amount,review_amount,agent_summary)
     VALUES($1,$2,$3,$4,$5,'chat',1,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [trip.id, (text || ex.merchant || 'Ticket por chat').slice(0, 120), ex.merchant, date, result.total, media?.receiptPath || null, result.status, result.approved, result.rejected, result.review, summary]
  );
  for (const it of result.items) {
    await q(
      `INSERT INTO expense_items(expense_id,description,amount,category,verdict,policy_code,reason) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [e.id, it.description, it.amount, it.category, it.verdict, it.policy_code, it.reason]
    );
  }
  await q(`INSERT INTO agent_logs(expense_id,mode,model,latency_ms,input_summary,output_json) VALUES($1,$2,$3,$4,$5,$6)`, [
    e.id, ex.mode + '-chat', ex.model || '', Date.now() - t0, text, JSON.stringify(ex.items),
  ]);
  e.items = await q('SELECT * FROM expense_items WHERE expense_id=$1 ORDER BY id', [e.id]);
  return e;
}

function chatContext(t) {
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const pols = t._policies.map((p) => `- [${p.code}] ${p.name} ${p.params}`).join('\n');
  const exps = t.expenses
    .map((e) => `- ${e.expense_date} ${e.description}: total ${money(e.total)} → ${e.status} (ok ${money(e.approved_amount)}, no ${money(e.rejected_amount)}, rev ${money(e.review_amount)})`)
    .join('\n');
  return `Empleada: ${t.employee_name}. Viaje #${t.id} a ${t.destination} (${t.purpose}), del ${t.start_date} al ${t.end_date}, ${t.international ? 'EXTRANJERO' : 'nacional'}.
Anticipo autorizado: ${money(t.advance_amount)}. Gastado: ${money(t.stats.totalSpent)}. Disponible: ${money(t.stats.available)}.
Aprobado: ${money(t.stats.approved)} · Rechazado: ${money(t.stats.rejected)} · En revisión: ${money(t.stats.review)}.
Referencia diaria (per diem): ${t.perDiem ? money(t.perDiem.reference) + (t.international ? ' (70 USD/día)' : ' (700 MXN/día)') : 'n/a'}.
Fecha de hoy: ${new Date().toISOString().slice(0, 10)}.
Gastos registrados:
${exps || '(ninguno todavía)'}
Políticas activas:
${pols}`;
}

function mockChat(message, t) {
  const m = message.toLowerCase();
  const money = (n) => `$${Number(n).toFixed(2)}`;
  if (/gast|pagu|compr|regist|se me pas/.test(m) && /\d/.test(m)) {
    const date = /antier|anteayer/.test(m)
      ? new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
      : /ayer/.test(m)
        ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
        : null;
    return { reply: 'Va, lo registro y lo reviso contra la política… 🧾', action: { type: 'register_expense', text: message, date } };
  }
  if (/queda|disponible|presupuesto|cu[aá]nto llevo|saldo/.test(m))
    return { reply: `Llevas ${money(t.stats.totalSpent)} gastados de ${money(t.advance_amount)} de anticipo: te quedan ${money(t.stats.available)}. 📊`, action: null };
  if (/rechaz|no pas/.test(m))
    return { reply: `Se han rechazado ${money(t.stats.rejected)} por política (alcohol, gastos personales o excedentes). Puedes ver el detalle en Estado del viaje.`, action: null };
  if (/pol[ií]tica|alcohol|l[ií]mite|regla/.test(m))
    return { reply: 'La política vive en la base de datos: alcohol nunca se reembolsa, sin comprobante arriba de $100 va a revisión, propina máx. 15%, y hay límites por categoría y per diem diario. 📋', action: null };
  return { reply: 'Soy Talón 🧾 Puedo decirte cuánto te queda, qué se rechazó y por qué, o registrar un gasto si me lo cuentas (ej. "gasté 350 en un taxi").', action: null };
}

app.post('/api/chat', upload.single('photo'), async (req, res) => {
  try {
    let { trip_id, messages = [] } = req.body;
    if (typeof messages === 'string') {
      try { messages = JSON.parse(messages); } catch { messages = []; }
    }
    const t = await tripFull(Number(trip_id));
    if (!t) return res.status(404).json({ error: 'Viaje no encontrado' });
    t._policies = (await q('SELECT code,name,params FROM policies WHERE active=1')).map((p) => ({ ...p }));

    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    // Foto adjunta como evidencia: registrar directo con la imagen en el expediente
    if (req.file) {
      const mime = req.file.mimetype || 'image/jpeg';
      const receiptPath = `r${Date.now()}_${Math.random().toString(36).slice(2, 8)}${extFromMime(mime)}`;
      fs.writeFileSync(path.join(UP, receiptPath), req.file.buffer);
      const low = lastUser.toLowerCase();
      const date = /antier|anteayer/.test(low)
        ? new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10)
        : /ayer/.test(low)
          ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
          : null;
      let expense = await registerTextExpense(t, lastUser, date, {
        imageBase64: req.file.buffer.toString('base64'),
        mime,
        receiptPath,
      });
      // Respaldo: si la foto no se pudo leer pero el texto trae el monto,
      // registrar desde el texto conservando la foto como evidencia.
      if (!expense && /\d/.test(lastUser)) {
        expense = await registerTextExpense(t, lastUser, date, { receiptPath });
      }
      const reply = expense
        ? 'Recibí tu evidencia 📎 y registré el gasto con este veredicto. La foto queda en el expediente y Finanzas podrá abrirla desde la mesa de revisión.'
        : 'No pude leer el ticket 😕 Vuelve a mandarme la foto junto con el monto y qué fue (ej. «taxi del aeropuerto 250») y lo registro con tu foto como evidencia.';
      return res.json({ reply, expense });
    }
    let out;
    if (azureReady()) {
      try {
        out = await chatAgent({ context: chatContext(t), messages });
      } catch (err) {
        console.error('[chat] Azure falló, usando respuesta local:', err.message);
        out = mockChat(lastUser, t);
      }
    } else {
      out = mockChat(lastUser, t);
    }

    let expense = null;
    if (out.action?.type === 'register_expense' && out.action.text) {
      expense = await registerTextExpense(t, out.action.text, out.action.date || null);
      if (!expense) out.reply += ' …aunque no encontré un monto claro. ¿Me lo repites con la cantidad? 🙏';
    }
    res.json({ reply: out.reply, expense });
  } catch (err) {
    console.error('[chat]', err);
    res.status(500).json({ error: 'El chat falló: ' + err.message });
  }
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
  // Todos los gastos: Finanzas tiene la decisión final sobre cualquier veredicto
  const expenses = await q(
    `SELECT e.*, t.destination, t.status AS trip_status, emp.name AS employee_name
     FROM expenses e JOIN trips t ON t.id=e.trip_id JOIN employees emp ON emp.id=t.employee_id
     ORDER BY t.id, e.expense_date, e.id`
  );
  const allItems = expenses.length
    ? await q(
        `SELECT * FROM expense_items WHERE expense_id IN (${expenses.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY id`,
        expenses.map((e) => e.id)
      )
    : [];
  for (const e of expenses) e.items = allItems.filter((i) => i.expense_id === e.id);

  // Alertas por viaje (fechas fuera de rango, per diem, excedentes…): mismas que ve el empleado
  const tripRows = await q('SELECT id FROM trips ORDER BY id');
  const tripAlerts = [];
  for (const tr of tripRows) {
    const t = await tripFull(tr.id);
    if (t && t.alerts.length)
      tripAlerts.push({ trip_id: t.id, destination: t.destination, employee_name: t.employee_name, alerts: t.alerts });
  }

  res.json({ pending, resolved, sums, byCat, expenses, tripAlerts });
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
