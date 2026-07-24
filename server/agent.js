// El agente extractor: manda la foto o el texto del gasto al modelo con visión
// de Azure AI Foundry y regresa los conceptos. Sin credenciales, usa un
// analizador local (claramente marcado como simulado) para poder desarrollar.

const CFG = {
  endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
  key: process.env.AZURE_OPENAI_API_KEY || '',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-06-01',
  chatUrl: process.env.AZURE_CHAT_URL || '',
};

export const azureReady = () =>
  !!(CFG.chatUrl || (CFG.endpoint && CFG.key && !CFG.endpoint.includes('TU-RECURSO')));

const SYSTEM = `Eres el analista de gastos de viaje de una empresa. Recibirás la FOTO de un ticket
o la DESCRIPCIÓN en texto libre de un gasto. Tu trabajo es extraer los conceptos.

Reglas:
1. Extrae CADA concepto por separado con su monto en pesos. Si el ticket agrupa, sepáralo.
2. Clasifica cada concepto en una de estas categorías exactas:
   comida | hospedaje | transporte | propina | alcohol | personal | otros
3. Marca is_alcohol=true en cervezas, vino, licores, cócteles — aunque vengan dentro de una comida.
4. Marca is_personal=true en ropa, regalos, entretenimiento, snacks personales.
5. Si el texto da un total y menciona una parte (ej. "cena 680, incluye 140 de cervezas"),
   separa: el resto (540) como comida y los 140 como alcohol.
6. Si no puedes clasificar con confianza ≥ 0.7, marca ambiguous=true.
7. NO apliques políticas ni decidas reembolsos: solo extrae y clasifica.
8. Extrae también el comercio (merchant) y la fecha (YYYY-MM-DD) si son visibles; si no, null.

Responde ÚNICAMENTE este JSON, sin texto adicional:
{"merchant": "..." | null, "date": "YYYY-MM-DD" | null,
 "items": [{"description":"...","amount":0.0,"category":"...","confidence":0.0,
            "ambiguous":false,"is_alcohol":false,"is_personal":false}]}`;

async function callAzure({ text, imageBase64, mime }) {
  const url =
    CFG.chatUrl ||
    `${CFG.endpoint.replace(/\/+$/, '')}/openai/deployments/${CFG.deployment}/chat/completions?api-version=${CFG.apiVersion}`;
  const content = [];
  content.push({ type: 'text', text: text || 'Extrae los conceptos de este ticket.' });
  if (imageBase64) {
    content.push({ type: 'image_url', image_url: { url: `data:${mime || 'image/jpeg'};base64,${imageBase64}`, detail: 'high' } });
  }
  const body = {
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content },
    ],
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': CFG.key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const raw = await r.text();
      if (!r.ok) throw new Error(`Azure ${r.status}: ${raw.slice(0, 300)}`);
      const data = JSON.parse(raw);
      let contentOut = data.choices?.[0]?.message?.content || '';
      contentOut = contentOut.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(contentOut);
      if (!Array.isArray(parsed.items) || !parsed.items.length) throw new Error('El modelo no regresó conceptos');
      return {
        merchant: parsed.merchant || null,
        date: parsed.date || null,
        items: parsed.items.map((i) => ({
          description: String(i.description || 'Concepto'),
          amount: Number(i.amount) || 0,
          category: String(i.category || 'otros').toLowerCase(),
          confidence: Number(i.confidence ?? 0.85),
          ambiguous: !!i.ambiguous,
          is_alcohol: !!i.is_alcohol,
          is_personal: !!i.is_personal,
        })).filter((i) => i.amount > 0),
      };
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn('[agent] reintento tras error:', err.message);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Analizador local (solo desarrollo/demo sin credenciales) ──────
function amountNear(text, words) {
  const re = new RegExp(
    `(?:(\\d{2,6}(?:[.,]\\d{1,2})?)\\s*(?:pesos\\s*)?(?:de\\s+)?(?:${words})|(?:${words})[^\\d]{0,25}?\\$?\\s?(\\d{2,6}(?:[.,]\\d{1,2})?))`,
    'i'
  );
  const m = text.match(re);
  if (!m) return 0;
  return parseFloat((m[1] || m[2]).replace(',', '.'));
}

function mockFromText(text = '') {
  const t = text.toLowerCase();
  const money = [...text.matchAll(/\$?\s?(\d{2,6}(?:[.,]\d{1,2})?)\b/g)]
    .map((m) => parseFloat(m[1].replace(',', '.')))
    .filter((n) => n >= 15);
  const total = money.length ? Math.max(...money) : 0;
  const alcohol = amountNear(text, 'cervezas?|vinos?|alcohol|tequila|mezcal|whisky|c[oó]cteles?|micheladas?');
  const tip = amountNear(text, 'propinas?');

  const CATS = [
    ['transporte', /taxi|uber|didi|cabify|metro|cami[oó]n|autob[uú]s|estacionamiento|gasolina|casetas?|vuelo|avi[oó]n/],
    ['hospedaje', /hotel|hospedaje|airbnb|motel|noche de/],
    ['comida', /desayun|comida|comi[oó]?|cena|restaurant|caf[eé]|cafeter|almuerzo|taquer|tacos|buffet/],
    ['personal', /ropa|regalos?|cine|entretenimiento|souvenirs?|videojuego/],
  ];
  let mainCat = 'otros';
  for (const [c, re] of CATS) if (re.test(t)) { mainCat = c; break; }
  let ambiguous = mainCat === 'otros';
  if (/s[uú]per|oxxo|farmacia|snacks?|conveniencia|servicio/.test(t)) { mainCat = 'otros'; ambiguous = true; }

  const items = [];
  const rest = Math.round((total - alcohol - tip) * 100) / 100;
  const desc = text.trim().slice(0, 60) || 'Gasto';
  if (rest > 0) items.push({ description: desc, amount: rest, category: mainCat, confidence: ambiguous ? 0.5 : 0.85, ambiguous });
  if (alcohol > 0) items.push({ description: 'Bebidas alcohólicas', amount: alcohol, category: 'alcohol', confidence: 0.95, is_alcohol: true });
  if (tip > 0) items.push({ description: 'Propina', amount: tip, category: 'propina', confidence: 0.9 });
  if (!items.length && total > 0) items.push({ description: desc, amount: total, category: 'otros', confidence: 0.4, ambiguous: true });
  return { merchant: null, date: null, items };
}

function mockFromPhoto() {
  // Ticket de demostración cuando no hay credenciales de Azure
  return {
    merchant: 'CAFETERÍA CENTRAL (ticket demo)',
    date: null,
    items: [
      { description: 'Café americano', amount: 45, category: 'comida', confidence: 0.95 },
      { description: 'Sandwich de pavo', amount: 75, category: 'comida', confidence: 0.95 },
      { description: 'Galletas (snack)', amount: 35, category: 'personal', confidence: 0.9, is_personal: true },
      { description: 'Agua embotellada', amount: 20, category: 'otros', confidence: 0.55, ambiguous: true },
    ],
  };
}

// ── Chat conversacional ───────────────────────────────────────────
const CHAT_SYSTEM = (context) => `Eres "Talón", el agente de viáticos de la empresa. Hablas español mexicano,
breve, claro y amable (1-3 oraciones, puedes usar un emoji). Atiendes a la persona empleada durante su viaje.

CONTEXTO REAL (única fuente de verdad, no inventes cifras):
${context}

Puedes hacer dos cosas:
1. RESPONDER preguntas sobre su viaje (presupuesto, cuánto queda, qué se rechazó y por qué,
   qué dice la política, fechas, etc.) usando SOLO el contexto.
2. REGISTRAR un gasto cuando la persona lo narre (ej. "gasté 350 en un taxi al hotel",
   "pagué la cena 680 con 140 de cervezas"). En ese caso pon el texto del gasto en action.
   Fechas: si dicen "ayer", "antier" o un día concreto, calcula la fecha exacta usando la
   fecha de hoy del contexto y ponla en action.date (YYYY-MM-DD). Si no dicen día, date=null (hoy).

Responde ÚNICAMENTE este JSON:
{"reply":"tu respuesta en español",
 "action": null | {"type":"register_expense","text":"descripción textual del gasto con su monto","date":"YYYY-MM-DD o null"}}

Si narran un gasto, en reply di algo corto tipo "Va, lo registro y lo reviso contra la política…"
(el sistema añadirá el veredicto). Si piden algo fuera de viáticos, redirígelos con amabilidad.`;

export async function chatAgent({ context, messages }) {
  const url =
    CFG.chatUrl ||
    `${CFG.endpoint.replace(/\/+$/, '')}/openai/deployments/${CFG.deployment}/chat/completions?api-version=${CFG.apiVersion}`;
  const body = {
    messages: [
      { role: 'system', content: CHAT_SYSTEM(context) },
      ...messages.slice(-10).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content).slice(0, 1500) })),
    ],
    temperature: 0.4,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': CFG.key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await r.text();
    if (!r.ok) throw new Error(`Azure ${r.status}: ${raw.slice(0, 200)}`);
    let content = JSON.parse(raw).choices?.[0]?.message?.content || '{}';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    const parsed = JSON.parse(content);
    return { reply: String(parsed.reply || '…'), action: parsed.action || null };
  } finally {
    clearTimeout(timer);
  }
}

export async function extractItems({ text, imageBase64, mime }) {
  if (azureReady()) {
    try {
      const out = await callAzure({ text, imageBase64, mime });
      return { mode: 'azure', model: CFG.deployment, note: null, ...out };
    } catch (err) {
      console.error('[agent] Azure falló, usando analizador local:', err.message);
      const out = imageBase64 && !text ? mockFromPhoto() : mockFromText(text || '');
      return { mode: 'mock-fallback', model: 'analizador local', note: '⚠️ La IA de Azure no respondió; se usó el analizador local.', ...out };
    }
  }
  const out = imageBase64 && !text ? mockFromPhoto() : mockFromText(text || '');
  return { mode: 'mock', model: 'analizador local', note: '🧪 Agente simulado (aún sin credenciales de Azure en .env).', ...out };
}
