import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import Solicitud from './screens/Solicitud.jsx';
import Captura from './screens/Captura.jsx';
import Estado from './screens/Estado.jsx';
import Liquidacion from './screens/Liquidacion.jsx';
import Revision from './screens/Revision.jsx';
import Chat from './screens/Chat.jsx';

const VIEWS = [
  ['solicitud', '✈️', 'Solicitud'],
  ['captura', '📷', 'Capturar gasto'],
  ['chat', '💬', 'Chat'],
  ['estado', '📊', 'Estado'],
  ['liquidacion', '🧾', 'Liquidación'],
];

const isRevisor = () => window.location.hash === '#revisor';

export default function App() {
  const [mode, setMode] = useState(isRevisor() ? 'revisor' : 'empleado');
  const [view, setView] = useState('solicitud');
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const h = () => setMode(isRevisor() ? 'revisor' : 'empleado');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

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

  const healthChips = health && (
    <>
      <span className={'chip ' + (health.agent === 'azure' ? 'on' : 'off')}>
        <span className="dot" />IA: {health.agent === 'azure' ? `Azure · ${health.model}` : 'simulada'}
      </span>
      <span className={'chip ' + (health.db === 'aiven-postgres' ? 'on' : 'off')}>
        <span className="dot" />BD: {health.db === 'aiven-postgres' ? 'Aiven PostgreSQL' : 'local (dev)'}
      </span>
    </>
  );

  // ── Vista del REVISOR (se abre en su propia pestaña con #revisor) ──
  if (mode === 'revisor') {
    return (
      <div className="app revisor-mode">
        <div className="app-chrome">
          <header className="masthead">
            <div className="brand">
              <h1>TAL<span className="tld">Ó</span>N</h1>
              <span className="tag">Mesa de revisión · Finanzas</span>
            </div>
            <div className="chips">
              <span className="chip">🧑‍💼 Marco Ruiz · Revisor</span>
              {healthChips}
              <a className="chip" href="#" style={{ textDecoration: 'none' }}>← Vista empleado</a>
            </div>
          </header>
        </div>
        <Revision />
      </div>
    );
  }

  // ── Vista del EMPLEADO ──────────────────────────────────────────
  return (
    <div className="app">
      <div className="app-chrome">
        <header className="masthead">
          <div className="brand">
            <h1>TAL<span className="tld">Ó</span>N</h1>
            <span className="tag">Agente de gastos de viaje</span>
          </div>
          <div className="chips">
            <span className="chip">👤 Laura Martínez · Compras</span>
            {healthChips}
            <a className="chip" href="#revisor" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
              🧑‍💼 Mesa de revisión ↗
            </a>
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
            <label>Viaje activo</label>
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

      {view === 'solicitud' && (
        <Solicitud
          trips={trips}
          reload={loadTrips}
          onCreated={(id) => setTripId(id)}
          onGoCapture={(id) => { setTripId(id); setView('captura'); }}
        />
      )}
      {view === 'captura' && trip && <Captura trip={trip} onGoEstado={() => setView('estado')} />}
      {view === 'chat' && trip && <Chat trip={trip} key={'c' + trip.id} />}
      {view === 'estado' && trip && <Estado trip={trip} key={'e' + trip.id} />}
      {view === 'liquidacion' && trip && <Liquidacion trip={trip} reload={loadTrips} key={'l' + trip.id} />}
      {!trip && view !== 'solicitud' && (
        <p style={{ color: 'var(--cream-muted)' }}>No hay viajes todavía — crea una solicitud primero.</p>
      )}
    </div>
  );
}
