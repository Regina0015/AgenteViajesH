// Capa de datos: Aiven PostgreSQL (DATABASE_URL) con fallback a SQLite local
// para desarrollo. Misma interfaz q() en ambos: placeholders $1, $2, ...
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export let isPg = !!process.env.DATABASE_URL;

let pool = null; // pg
let sq = null;   // sqlite

export async function q(text, params = []) {
  if (isPg) {
    const r = await pool.query(text, params);
    return r.rows;
  }
  const sql = text.replace(/\$(\d+)/g, '?');
  const stmt = sq.prepare(sql);
  if (/^\s*(select|with)/i.test(sql) || /returning/i.test(sql)) return stmt.all(...params);
  stmt.run(...params);
  return [];
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT DEFAULT 'employee'
  )`,
  `CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    employee_id INT REFERENCES employees(id),
    destination TEXT NOT NULL,
    purpose TEXT DEFAULT '',
    start_date TEXT,
    end_date TEXT,
    requested_amount DOUBLE PRECISION DEFAULT 0,
    advance_amount DOUBLE PRECISION DEFAULT 0,
    international INT DEFAULT 0,
    status TEXT DEFAULT 'requested',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS policies (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE,
    name TEXT,
    rule_type TEXT,
    category TEXT,
    params TEXT DEFAULT '{}',
    active INT DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    trip_id INT REFERENCES trips(id),
    description TEXT DEFAULT '',
    merchant TEXT,
    expense_date TEXT,
    total DOUBLE PRECISION DEFAULT 0,
    source TEXT DEFAULT 'text',
    has_receipt INT DEFAULT 1,
    receipt_path TEXT,
    status TEXT DEFAULT 'review',
    approved_amount DOUBLE PRECISION DEFAULT 0,
    rejected_amount DOUBLE PRECISION DEFAULT 0,
    review_amount DOUBLE PRECISION DEFAULT 0,
    agent_summary TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS expense_items (
    id SERIAL PRIMARY KEY,
    expense_id INT REFERENCES expenses(id),
    description TEXT,
    amount DOUBLE PRECISION,
    category TEXT,
    verdict TEXT,
    policy_code TEXT,
    reason TEXT,
    manually_corrected INT DEFAULT 0,
    reviewed_by TEXT,
    review_note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS liquidations (
    id SERIAL PRIMARY KEY,
    trip_id INT UNIQUE REFERENCES trips(id),
    advance_amount DOUBLE PRECISION,
    total_spent DOUBLE PRECISION,
    rejected_total DOUBLE PRECISION,
    review_total DOUBLE PRECISION,
    approved_total DOUBLE PRECISION,
    over_budget DOUBLE PRECISION,
    payroll_deduction DOUBLE PRECISION,
    refund_to_company DOUBLE PRECISION,
    detail TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS agent_logs (
    id SERIAL PRIMARY KEY,
    expense_id INT,
    mode TEXT,
    model TEXT,
    latency_ms INT,
    input_summary TEXT,
    output_json TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`,
];

function ddl(s) {
  if (isPg) return s;
  return s
    .replaceAll('SERIAL PRIMARY KEY', 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replaceAll('DOUBLE PRECISION', 'REAL')
    .replaceAll('TIMESTAMPTZ DEFAULT now()', "TEXT DEFAULT (datetime('now'))");
}

export async function initDb() {
  if (isPg) {
    try {
      const pg = (await import('pg')).default;
      pg.types.setTypeParser(1700, parseFloat); // NUMERIC → number
      pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Aiven exige TLS; para el hack no validamos CA
        max: 5,
        connectionTimeoutMillis: 10000,
      });
      await pool.query('SELECT 1');
      console.log('[db] ✅ Conectado a PostgreSQL (Aiven)');
    } catch (err) {
      console.error('[db] ❌ No pude conectar a Aiven:', err.message);
      console.error('[db] ⚠️  Cayendo a SQLite local para no detener el desarrollo.');
      console.error('[db]     Revisa en la consola de Aiven que el servicio esté "Running" y sin IP allowlist.');
      isPg = false;
      pool = null;
    }
  }
  if (!isPg) {
    const { DatabaseSync } = await import('node:sqlite');
    sq = new DatabaseSync(process.env.SQLITE_PATH || path.join(__dirname, 'talon.db'));
    console.log('[db] ⚠️  DATABASE_URL vacío → usando SQLite local (fallback de desarrollo). Pega el Service URI de Aiven en .env para usar Postgres.');
  }
  for (const t of TABLES) await q(ddl(t));
  // Migraciones aditivas para BDs creadas antes (nunca destructivas)
  for (const col of ['reviewed_by TEXT', 'review_note TEXT']) {
    try { await q(`ALTER TABLE expense_items ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
  try { await q(`ALTER TABLE trips ADD COLUMN international INT DEFAULT 0`); } catch { /* ya existe */ }
  await seedIfEmpty();
  await ensureNewPolicies();
}

// Políticas agregadas después del seed inicial (INSERT solo si faltan)
async function ensureNewPolicies() {
  // Renombre (solo UPDATE, sin tocar datos): POL-PERDIEM → POL-DIA
  await q(`UPDATE policies SET code='POL-DIA', name='Presupuesto diario por viaje' WHERE code='POL-PERDIEM'`);
  const NEW = [
    ['POL-DIA', 'Presupuesto diario por viaje', 'per_diem', '*',
      '{"mx_per_day":700,"ext_per_day_usd":70,"usd_mxn":18.5}'],
  ];
  for (const p of NEW) {
    const found = await q(`SELECT id FROM policies WHERE code=$1`, [p[0]]);
    if (!found.length) {
      await q(`INSERT INTO policies(code,name,rule_type,category,params) VALUES($1,$2,$3,$4,$5)`, p);
      console.log(`[db] Política nueva sembrada: ${p[0]}`);
    }
  }
}

// ── Seed: solo INSERTa cuando la BD está vacía. Nunca borra nada. ──
async function seedIfEmpty() {
  const n = Number((await q('SELECT COUNT(*) AS n FROM employees'))[0].n);
  if (n > 0) return;
  console.log('[db] Sembrando datos demo: Laura, política del deck y viaje a Monterrey…');

  const [laura] = await q(
    `INSERT INTO employees(name,email,role) VALUES($1,$2,$3) RETURNING id`,
    ['Laura Martínez', 'laura.martinez@hebmex.com', 'compradora']
  );
  await q(`INSERT INTO employees(name,email,role) VALUES($1,$2,$3)`, [
    'Marco Ruiz', 'marco.ruiz@hebmex.com', 'revisor',
  ]);

  const POLICIES = [
    ['POL-ALCOHOL', 'Alcohol nunca reembolsable (se separa del ticket)', 'forbidden', 'alcohol', '{}'],
    ['POL-PERSONAL', 'Gastos personales no reembolsables (ropa, regalos, entretenimiento)', 'forbidden', 'personal', '{}'],
    ['POL-COMPROBANTE', 'Comprobante obligatorio arriba del mínimo', 'receipt_required', '*', '{"min_amount":100}'],
    ['POL-PROPINA', 'Propina máxima sobre el consumo', 'tip_limit', 'propina', '{"max_percent":15}'],
    ['POL-LIM-COMIDA', 'Límite de comida por evento', 'category_limit', 'comida', '{"limit":600,"per":"evento"}'],
    ['POL-LIM-HOTEL', 'Límite de hotel por noche', 'category_limit', 'hospedaje', '{"limit":1800,"per":"noche"}'],
    ['POL-LIM-TRANSP', 'Límite de transporte local por día', 'category_limit', 'transporte', '{"limit":500,"per":"dia"}'],
    ['POL-LIM-OTROS', 'Límite de "otros" por viaje', 'category_limit', 'otros', '{"limit":400,"per":"viaje"}'],
    ['POL-AMBIGUO', 'Conceptos ambiguos van a revisión humana', 'review_ambiguous', '*', '{"min_confidence":0.7}'],
    ['POL-TOPE', 'El presupuesto es un tope: el excedente se descuenta vía nómina', 'budget_cap', '*', '{}'],
  ];
  for (const p of POLICIES) {
    await q(`INSERT INTO policies(code,name,rule_type,category,params) VALUES($1,$2,$3,$4,$5)`, p);
  }

  // Viaje 1 · el caso del jurado: Laura → Monterrey, anticipo $2,000
  const [mty] = await q(
    `INSERT INTO trips(employee_id,destination,purpose,start_date,end_date,requested_amount,advance_amount,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'active') RETURNING id`,
    [laura.id, 'Monterrey, NL', 'Visita a proveedores', '2026-07-22', '2026-07-23', 2000, 2000]
  );

  const seedExpense = async (e) => {
    const approved = e.items.filter(i => i.verdict === 'approved').reduce((s, i) => s + i.amount, 0);
    const rejected = e.items.filter(i => i.verdict === 'rejected').reduce((s, i) => s + i.amount, 0);
    const review = e.items.filter(i => i.verdict === 'review').reduce((s, i) => s + i.amount, 0);
    const total = approved + rejected + review;
    let status = 'approved';
    if (review > 0) status = 'review';
    else if (rejected > 0 && approved > 0) status = 'partial';
    else if (rejected > 0) status = 'rejected';
    const [row] = await q(
      `INSERT INTO expenses(trip_id,description,merchant,expense_date,total,source,has_receipt,status,approved_amount,rejected_amount,review_amount,agent_summary)
       VALUES($1,$2,$3,$4,$5,'seed',1,$6,$7,$8,$9,$10) RETURNING id`,
      [mty.id, e.description, e.merchant, e.date, total, status, approved, rejected, review, e.summary]
    );
    for (const i of e.items) {
      await q(
        `INSERT INTO expense_items(expense_id,description,amount,category,verdict,policy_code,reason)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, i.description, i.amount, i.category, i.verdict, i.policy_code || null, i.reason]
      );
    }
  };

  await seedExpense({
    description: 'Taxi aeropuerto → hotel', merchant: 'Taxis Aeropuerto MTY', date: '2026-07-22',
    summary: '✅ Gasto aprobado. Transporte dentro del límite diario ($500) [POL-LIM-TRANSP].',
    items: [{ description: 'Taxi aeropuerto → hotel', amount: 350, category: 'transporte', verdict: 'approved', reason: 'Transporte local dentro de política.' }],
  });
  await seedExpense({
    description: 'Comida día 1', merchant: 'Restaurante El Norteño', date: '2026-07-22',
    summary: '✅ Gasto aprobado. Comida dentro del límite por evento ($600) [POL-LIM-COMIDA].',
    items: [{ description: 'Comida día 1', amount: 420, category: 'comida', verdict: 'approved', reason: 'Comida dentro del límite por evento.' }],
  });
  await seedExpense({
    description: 'Cena con proveedores (incluye 2 cervezas)', merchant: 'La Terraza Grill', date: '2026-07-22',
    summary: '🟠 Ticket aprobado parcialmente. Se aprueban $540.00 (cena). Se rechazan $140.00 — Cervezas (2): bebida alcohólica, nunca reembolsable [POL-ALCOHOL].',
    items: [
      { description: 'Cena (alimentos)', amount: 540, category: 'comida', verdict: 'approved', reason: 'Alimentos dentro del límite por evento.' },
      { description: 'Cervezas (2)', amount: 140, category: 'alcohol', verdict: 'rejected', policy_code: 'POL-ALCOHOL', reason: 'Bebida alcohólica: nunca es reembolsable; se separa del resto del ticket.' },
    ],
  });
  await seedExpense({
    description: 'Taxi a visita con proveedor', merchant: 'Didi', date: '2026-07-23',
    summary: '✅ Gasto aprobado. Transporte dentro del límite diario ($500) [POL-LIM-TRANSP].',
    items: [{ description: 'Taxi a visita con proveedor', amount: 180, category: 'transporte', verdict: 'approved', reason: 'Transporte local dentro de política.' }],
  });
  await seedExpense({
    description: 'Comida día 2', merchant: 'Fonda Doña Chuy', date: '2026-07-23',
    summary: '✅ Gasto aprobado. Comida dentro del límite por evento ($600) [POL-LIM-COMIDA].',
    items: [{ description: 'Comida día 2', amount: 510, category: 'comida', verdict: 'approved', reason: 'Comida dentro del límite por evento.' }],
  });
  await seedExpense({
    description: 'Súper: snacks y otros', merchant: 'OXXO Constitución', date: '2026-07-23',
    summary: '🟡 Gasto enviado a revisión humana. Categoría ambigua: un súper a las 11 pm puede ser gasto de viaje o personal [POL-AMBIGUO].',
    items: [{ description: 'Súper: snacks y otros', amount: 360, category: 'otros', verdict: 'review', policy_code: 'POL-AMBIGUO', reason: 'Concepto ambiguo: requiere revisión humana.' }],
  });

  // Viaje 2 · vacío, para capturar gastos EN VIVO durante la demo
  await q(
    `INSERT INTO trips(employee_id,destination,purpose,start_date,end_date,requested_amount,advance_amount,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'active')`,
    [laura.id, 'CDMX', 'Expo Retail 2026', '2026-07-24', '2026-07-25', 3000, 3000]
  );

  console.log('[db] Seed listo ✅');
}
