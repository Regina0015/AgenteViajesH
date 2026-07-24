import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Solicitud from './screens/Solicitud.jsx';
import Captura from './screens/Captura.jsx';
import Estado from './screens/Estado.jsx';
import Liquidacion from './screens/Liquidacion.jsx';
import Revision from './screens/Revision.jsx';

const VIEWS = [
  ['solicitud', '01', 'Solicitud'],
  ['captura', '02', 'Capturar gasto'],
  ['estado', '03', 'Estado del viaje'],
  ['liquidacion', '04', 'Liquidación'],
  ['revision', '05', 'Revisión'],
];

export default function App() {
  const [view, setView] = useState('captura');
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [health, setHealth] = useState(null);

  const loadTrips = useCallback(async () => {
    const t = await api('/trips');
    setTrips(t);
    setTripId((cur) => cur ?? (t.find((x) => x.status === 'active')?.id ?? t[0]?.id ?? null));
    return t;
  }, []);

  useEffect(() => {
    loadTrips().catch(console.error);
    api('/health').then(setHealth).catch(() => setHealth({ agent: 'off' }));
  }, [loadTrips]);

  const trip = trips.find((t) => t.id === Number(tripId));

  return (
    <div className="app">
      <div className="app-chrome">
        <header className="masthead">
          <div className="brand">
            <h1>TAL<span className="tld">Ó</span>N</h1>
            <span className="tag">Agente de gastos de viaje · Hackatón TGIF</span>
          </div>
          <div className="chips">
            <span className="chip">👤 Laura Martínez · Compradora</span>
            {health && (
              <span className={'chip ' + (health.agent === 'azure' ? 'on' : 'off')}>
                <span className="dot" />
                IA: {health.agent === 'azure' ? `Azure · ${health.model}` : 'simulada'}
              </span>
            )}
            {health && (
              <span className={'chip ' + (health.db === 'aiven-postgres' ? 'on' : 'off')}>
                <span className="dot" />
                BD: {health.db === 'aiven-postgres' ? 'Aiven PostgreSQL' : 'local (dev)'}
              </span>
            )}
          </div>
        </header>

        <div className="topbar">
          <nav className="tabs">
            {VIEWS.map(([id, n, label]) => (
              <button key={id} className={'tab' + (view === id ? ' active' : '')} onClick={() => setView(id)}>
                <span className="n">{n}</span>
                {label}
              </button>
            ))}
          </nav>
          <div className="trip-pick">
            <label>Viaje</label>
            <select value={tripId ?? ''} onChange={(e) => setTripId(Number(e.target.value))}>
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  #{t.id} · {t.destination} ({t.start_date})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {view === 'solicitud' && <Solicitud trips={trips} reload={loadTrips} onGoCapture={(id) => { setTripId(id); setView('captura'); }} />}
      {view === 'captura' && trip && <Captura trip={trip} />}
      {view === 'estado' && trip && <Estado trip={trip} key={'e' + trip.id} />}
      {view === 'liquidacion' && trip && <Liquidacion trip={trip} reload={loadTrips} key={'l' + trip.id} />}
      {view === 'revision' && <Revision />}
      {!trip && view !== 'solicitud' && view !== 'revision' && (
        <p style={{ color: 'var(--cream-muted)' }}>No hay viajes todavía — crea una solicitud primero.</p>
      )}
    </div>
  );
}
