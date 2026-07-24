export async function api(path, opts = {}) {
  const r = await fetch('/api' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

export const money = (n) =>
  (Number(n) || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

export const VERDICT_LABEL = {
  approved: 'APROBADO',
  rejected: 'RECHAZADO',
  review: 'REVISIÓN',
  partial: 'PARCIAL',
};

export const TRIP_LABEL = {
  requested: 'SOLICITADO',
  active: 'ACTIVO',
  closed: 'CERRADO',
};

export const CATEGORIES = ['comida', 'hospedaje', 'transporte', 'propina', 'alcohol', 'personal', 'otros'];
