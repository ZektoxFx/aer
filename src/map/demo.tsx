// Map test page (open /map.html in `npm run dev`). Lets the Map role try the map without touching App.tsx.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './map.css';
import type { DataPack } from '../data/types';
import type { Environment, SuitState } from '../sim/types';
import { FULL_SUIT } from '../sim/simulate';
import { makeDevPack } from './devPack';
import type { Pt } from './geo';
import { buildLayout } from './layout';
import type { MapItem } from './layout';
import type { MapLayers } from './MapView';
import { MapView } from './MapView';
import { planRoute } from './route';
import type { Status } from './route';
import { createExplored, exploredFraction, markSeen, newlyVisible, sightRadius } from './visibility';

/** The Data role's pack is too coarse to walk on until real height maps arrive. */
const MIN_REAL_CELLS = 32;

const pct = (v: number, full: number) => Math.max(0, Math.min(100, (v / full) * 100));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const statusVar = (s: Status) => (s === 'critical' ? 'var(--critical)' : s === 'warning' ? 'var(--warning)' : 'var(--fg)');

function scaledSuit(fraction: number): SuitState {
  return { ...FULL_SUIT, o2Kg: FULL_SUIT.o2Kg * fraction, liohKg: FULL_SUIT.liohKg * fraction, waterKg: FULL_SUIT.waterKg * fraction, batteryWh: FULL_SUIT.batteryWh * fraction };
}

function Gauge({ label, now, end, full, unit }: { label: string; now: number; end?: number; full: number; unit: string }) {
  const n = pct(now, full), e = end === undefined ? n : pct(end, full);
  const color = e < 15 ? 'var(--critical)' : e < 35 ? 'var(--warning)' : 'var(--fg)';
  return (
    <div className="g">
      <div className="g-row"><span>{label}</span><span>{now.toFixed(unit === 'Wh' ? 0 : 2)} {unit}{end !== undefined && <span className="dim"> → {end.toFixed(unit === 'Wh' ? 0 : 2)}</span>}</span></div>
      <div className="g-bar"><div className="g-now" style={{ width: `${n}%`, background: 'var(--dim)' }} /><div className="g-now" style={{ width: `${e}%`, background: color }} /></div>
    </div>
  );
}

function MapDemo() {
  const [dataPack, setDataPack] = useState<DataPack | null>(null);
  const [useSynthetic, setUseSynthetic] = useState(true);
  const [seed, setSeed] = useState(1);
  const [solIdx, setSolIdx] = useState(0);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0.8);
  const [load, setLoad] = useState(10);
  const [layers, setLayers] = useState<MapLayers>({ slope: true, hazards: true, fog: true, grid: false, allItems: false });
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [suit, setSuit] = useState<SuitState>(() => scaledSuit(0.5));
  const [suitStartPct, setSuitStartPct] = useState(50);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [walking, setWalking] = useState(false);
  const [exVersion, setExVersion] = useState(0);

  useEffect(() => {
    fetch('/data/fake.json').then((r) => r.json()).then((p: DataPack) => setDataPack(p)).catch(() => setDataPack(null));
  }, []);

  const realUsable = !!dataPack && dataPack.elevation.cols >= MIN_REAL_CELLS;
  const pack = useMemo<DataPack>(
    () => (realUsable && !useSynthetic && dataPack ? dataPack : makeDevPack(dataPack ?? undefined)),
    [dataPack, realUsable, useSynthetic],
  );
  const layout = useMemo(() => buildLayout(pack.area, seed), [pack.area, seed]);
  const explored = useMemo(() => createExplored(pack.area), [pack.area]);
  const [astronaut, setAstronaut] = useState<Pt>(layout.base);

  const sol = pack.sols[Math.min(solIdx, pack.sols.length - 1)];
  const sightM = sightRadius({ night, tau: sol.tau });
  const env = useMemo<Environment>(() => ({ pressureKPa: sol.pressureKPa, tempC: night ? sol.tempMinC : sol.tempMaxC, windMS: sol.windMS, tau: sol.tau }), [sol, night]);

  const reveal = useCallback((p: Pt, r: number, items: MapItem[], have: Set<string>) => {
    markSeen(explored, p, r);
    const fresh = newlyVisible(items, p, r, have);
    fresh.forEach((i) => have.add(i.id));
    return fresh;
  }, [explored]);

  // New game whenever the map or seed changes.
  const reset = useCallback(() => {
    explored.seen.fill(0);
    const have = new Set<string>();
    const first = reveal(layout.base, sightM, layout.items, have);
    setFound(have);
    setAstronaut(layout.base);
    setWaypoints([]);
    setSuit(scaledSuit(suitStartPct / 100));
    setLog([...first.map((f) => `Nearby: ${f.label}`), `Sol ${sol.sol}: you wake beside the crashed lander. Find O₂, parts and the comms page.`]);
    setExVersion((v) => v + 1);
    // sightM/sol/suitStartPct are read once at reset time on purpose.
  }, [explored, layout, reveal]);
  useEffect(() => { reset(); }, [reset]);

  const route = useMemo(
    () => (waypoints.length ? planRoute(pack.elevation, layout.zones, astronaut, layout.base, waypoints, suit, { speedMS: speed, loadKg: load, env }) : null),
    [pack.elevation, layout, astronaut, waypoints, suit, speed, load, env],
  );

  // Animate the walk along the costed route: the astronaut moves, sees, and finds things.
  const anim = useRef<number | null>(null);
  const walk = () => {
    if (!route || walking) return;
    if (route.legs.some((l) => l.blocked)) { setLog((l) => ['Route blocked: a slope is too steep to walk. Move a waypoint.', ...l]); return; }
    setWalking(true);
    const samples = route.samples;
    const have = new Set(found);
    const msPerSample = Math.max(8, Math.min(40, 4000 / samples.length));
    let i = 0, last = performance.now();
    const step = (now: number) => {
      while (now - last >= msPerSample && i < samples.length - 1) {
        i++; last += msPerSample;
        const s = samples[i];
        const fresh = reveal(s.at, sightM, layout.items, have);
        if (fresh.length) setLog((l) => [...fresh.map((f) => `+${fmtMin(s.t)}: found ${f.label}`), ...l]);
        setAstronaut(s.at);
        setSuit(s.state);
      }
      setFound(new Set(have));
      setExVersion((v) => v + 1);
      if (i < samples.length - 1) anim.current = requestAnimationFrame(step);
      else {
        setWalking(false);
        setWaypoints([]);
        setLog((l) => [`Arrived after ${fmtMin(route.minutes)}, ${(route.distM / 1000).toFixed(2)} km.`, ...l]);
      }
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);

  const toggle = (k: keyof MapLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const exploredPct = (exploredFraction(explored) * 100).toFixed(1);
  const end = route?.end;

  return (
    <div className="md">
      <header className="md-head">
        <div>
          <strong>AER · MARS MAP</strong> <span className="dim">/ map role test page</span>
        </div>
        <div className="md-src">
          <span className={pack.source.startsWith('SYNTHETIC') ? 'badge warn' : 'badge'}>{pack.source}</span>
          <span className="dim">{pack.area.name} · {(pack.area.widthM / 1000).toFixed(1)} × {(pack.area.heightM / 1000).toFixed(1)} km · {pack.elevation.cols}×{pack.elevation.rows} @ {pack.elevation.cellM} m</span>
        </div>
      </header>

      <main className="md-main">
        <section className="md-map">
          <MapView
            pack={pack} zones={layout.zones} items={layout.items} found={found}
            explored={explored} exploredVersion={exVersion} base={layout.base}
            astronaut={astronaut} sightM={sightM} waypoints={waypoints} route={route} layers={layers}
            onAddWaypoint={(p) => !walking && setWaypoints((w) => [...w, p])}
            onRemoveWaypoint={(i) => !walking && setWaypoints((w) => w.filter((_, j) => j !== i))}
          />
          <div className="md-hint dim">click = waypoint · right-click waypoint = remove · wheel = zoom · drag = pan</div>
        </section>

        <aside className="md-side">
          <div className="card">
            <h3>Conditions</h3>
            <label>Sol <select value={solIdx} onChange={(e) => setSolIdx(Number(e.target.value))}>
              {pack.sols.map((s, i) => <option key={s.sol} value={i}>Sol {s.sol} · τ {s.tau}{s.tau > 5 ? ' (storm)' : ''}</option>)}
            </select></label>
            <label><input type="checkbox" checked={night} onChange={() => setNight(!night)} /> Night</label>
            <div className="dim small">{env.tempC} °C · wind {env.windMS} m/s · {env.pressureKPa} kPa · sight <b style={{ color: sightM < 100 ? 'var(--warning)' : 'var(--fg)' }}>{sightM} m</b></div>
          </div>

          <div className="card">
            <h3>Suit {route && <span className="dim small">(now → after route)</span>}</h3>
            <Gauge label="O₂" now={suit.o2Kg} end={end?.o2Kg} full={FULL_SUIT.o2Kg} unit="kg" />
            <Gauge label="Water" now={suit.waterKg} end={end?.waterKg} full={FULL_SUIT.waterKg} unit="kg" />
            <Gauge label="Battery" now={suit.batteryWh} end={end?.batteryWh} full={FULL_SUIT.batteryWh} unit="Wh" />
            <Gauge label="LiOH" now={suit.liohKg} end={end?.liohKg} full={FULL_SUIT.liohKg} unit="kg" />
            <label className="small">Start suit at <input type="range" min={10} max={100} step={5} value={suitStartPct} onChange={(e) => setSuitStartPct(Number(e.target.value))} /> {suitStartPct}% <span className="dim">(on reset)</span></label>
          </div>

          <div className="card">
            <h3>Route</h3>
            <label className="small">Speed <input type="range" min={0.3} max={1.4} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> {speed.toFixed(1)} m/s</label>
            <label className="small">Load <input type="range" min={0} max={40} step={5} value={load} onChange={(e) => setLoad(Number(e.target.value))} /> {load} kg</label>
            {!route && <p className="dim small">Click the map to plan a walk from where you stand.</p>}
            {route && (
              <>
                <table className="legs">
                  <thead><tr><th>#</th><th>km</th><th>climb</th><th>max°</th><th>time</th></tr></thead>
                  <tbody>
                    {route.legs.map((l, i) => (
                      <tr key={i} style={{ color: statusVar(l.status) }}>
                        <td>{i + 1}</td><td>{(l.distM / 1000).toFixed(2)}</td><td>{l.climbM.toFixed(0)} m</td>
                        <td>{l.maxSlopeDeg.toFixed(0)}{l.blocked ? ' ✕' : ''}</td><td>{fmtMin(l.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="small">Total {(route.distM / 1000).toFixed(2)} km · {fmtMin(route.minutes)} · <b style={{ color: statusVar(route.status) }}>{route.status.toUpperCase()}</b></div>
                <div className="small" style={{ color: route.home.ok ? 'var(--fg)' : 'var(--critical)' }}>
                  Walk home from last point: {fmtMin(route.home.minutes)} · {route.home.ok ? 'OK with reserve' : 'NOT ENOUGH SUPPLIES'}
                </div>
                {route.pnrIndex !== null && <div className="small" style={{ color: 'var(--critical)' }}>Point of no return at waypoint {route.pnrIndex + 1}.</div>}
                {route.legs.some((l) => l.zones.length) && <div className="dim small">Crosses: {[...new Set(route.legs.flatMap((l) => l.zones))].map((id) => layout.zones.find((z) => z.id === id)?.label).join(', ')}</div>}
                {route.legs.flatMap((l) => l.warnings).slice(-2).map((w, i) => <div key={i} className="small" style={{ color: w.level === 'critical' ? 'var(--critical)' : 'var(--warning)' }}>⚠ {w.message}</div>)}
              </>
            )}
            <div className="btns">
              <button onClick={walk} disabled={!route || walking}>{walking ? 'Walking…' : 'Walk ▶'}</button>
              <button onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length || walking}>Undo</button>
              <button onClick={() => setWaypoints([])} disabled={!waypoints.length || walking}>Clear</button>
            </div>
          </div>

          <div className="card">
            <h3>Map</h3>
            <div className="toggles">
              {(['slope', 'hazards', 'fog', 'grid', 'allItems'] as const).map((k) => (
                <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {k === 'allItems' ? 'show hidden (dev)' : k === 'fog' ? 'explored' : k}</label>
              ))}
            </div>
            <div className="legend small">
              <span><i style={{ background: 'rgba(255,200,0,.5)' }} />slope &gt;10°</span>
              <span><i style={{ background: 'rgba(255,140,0,.7)' }} />&gt;18°</span>
              <span><i style={{ background: 'rgba(255,60,60,.8)' }} />&gt;25° blocked</span>
              <span><i className="dots" />soft sand</span>
              <span><i className="hatch" />boulders</span>
            </div>
            <div className="small">Explored {exploredPct}% · found {[...found].length} / {layout.items.filter((i) => i.hidden).length}</div>
            <label className="small">Seed <input type="number" value={seed} min={1} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} /></label>
            {realUsable && <label className="small"><input type="checkbox" checked={useSynthetic} onChange={() => setUseSynthetic(!useSynthetic)} /> use synthetic terrain</label>}
            <div className="btns"><button onClick={reset} disabled={walking}>New game</button></div>
          </div>

          <div className="card log">
            <h3>Log</h3>
            {log.map((l, i) => <div key={i} className="small">{l}</div>)}
          </div>
        </aside>
      </main>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><MapDemo /></StrictMode>);
