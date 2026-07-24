import { VERDICT_LABEL, TRIP_LABEL } from '../api.js';

export default function Stamp({ v, big }) {
  const label = VERDICT_LABEL[v] || TRIP_LABEL[v] || String(v).toUpperCase();
  return <span className={`stamp ${v}${big ? ' big' : ''}`}>{label}</span>;
}
