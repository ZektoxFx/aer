// Map test page (open /map.html in `npm run dev`). Lets the Map role try the map without touching App.tsx.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import './map.css';
import type { PoiFile, TerrainLayers } from '../data/files';
import type { DataPack } from '../data/types';
import type { Environment, SuitState } from '../sim/types';
import { FULL_SUIT } from '../sim/simulate';
import { makeDevPack } from './devPack';
import type { Pt } from './geo';
import { buildLayout } from './layout';
import { buildJezeroLayout } from './realData';
import { HudMap } from './HudMap';
import type { MapContent } from './realData';
import type { MapItem } from './layout';
import type { MapLayers, Ping } from './MapView';
import { MapView } from './MapView';
import { findPath, makeGrid, rangeField } from './pathfind';
import type { WalkModel } from './pathfind';
import { planRoute } from './route';
import type { RouteResult, Status } from './route';
import { RouteProfile } from './RouteProfile';
import { STORM_TAU, createExplored, exploredFraction, markSeen, newlyVisible, sightRadius } from './visibility';

/** The Data role's pack is too coarse to walk on until real height maps arrive. */
const MIN_REAL_CELLS = 32;
/** Supplies that must be left after getting home (the safe-zone edge). */
const RESERVE = 0.1;

const pct = (v: number, full: number) => Math.max(0, Math.min(100, (v / full) * 100));
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const statusVar = (s: Status) => (s === 'critical' ? 'var(--critical)' : s === 'warning' ? 'var(--warning)' : 'var(--fg)');

function scaledSuit(fraction: number): SuitState {
  return { ...FULL_SUIT, o2Kg: FULL_SUIT.o2Kg * fraction, liohKg: FULL_SUIT.liohKg * fraction, waterKg: FULL_SUIT.waterKg * fraction, batteryWh: FULL_SUIT.batteryWh * fraction };
}

function Gauge({ label, now, end, full, unit }: { label: string; now: number; end?: number; full: number; unit: string }) {
  const n = pct(now, full), e = end === undefined ? n : pct(end, full);
  const color = e < 15 ? 'var(--critical)' : e < 35 ? 'var(--warning)' : 'var(--fg)';
  const d = unit === 'Wh' ? 0 : 2;
  return (
    <div className="g">
      <div className="g-row"><span>{label}</span><span>{now.toFixed(d)} {unit}{end !== undefined && <span className="dim"> → {end.toFixed(d)}</span>}</span></div>
      <div className="g-bar"><div className="g-now" style={{ width: `${n}%`, background: 'var(--dim)' }} /><div className="g-now" style={{ width: `${e}%`, background: color }} /></div>
    </div>
  );
}

function foundMessage(t: number, f: MapItem): string {
  if (f.required) return `★ +${fmtMin(t)}: found the ROVER COMMS LINK page. Now find the rover.`;
  if (f.kind === 'rover') return `★ +${fmtMin(t)}: found the rover. Its radio can reach Earth.`;
  return `+${fmtMin(t)}: found ${f.label}${f.yields ? ` (${f.yields.join(', ')})` : ''}${f.fiction ? ' · game fiction' : ''}`;
}

/** Short chart caption naming mission, instrument and sol (team rule). */
function profileTitle(pack: DataPack, sol: number): string {
  if (pack.source.startsWith('SYNTHETIC')) return `elevation: synthetic test terrain · Sol ${sol}`;
  return `elevation: MRO HiRISE DTM (USGS Mars 2020 TRN) · weather: Perseverance MEDA · archived Sol ${sol}`;
}

const getJson = <T,>(url: string): Promise<T> => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() as Promise<T>; });

function MapDemo() {
  const [dataPack, setDataPack] = useState<DataPack | null>(null);
  const [pois, setPois] = useState<PoiFile | null>(null);
  const [terrainLayers, setTerrainLayers] = useState<TerrainLayers | null>(null);
  const [content, setContent] = useState<MapContent | null>(null);
  const [useSynthetic, setUseSynthetic] = useState(false);
  const [seed, setSeed] = useState(1);
  const [solIdx, setSolIdx] = useState(0);
  const [night, setNight] = useState(false);
  const [speed, setSpeed] = useState(0.8);
  const [load, setLoad] = useState(10);
  const [autoPath, setAutoPath] = useState(true);
  const [layers, setLayers] = useState<MapLayers>({ slope: true, hazards: true, fog: true, grid: false, contours: true, range: true, allItems: false });
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [suitStartPct, setSuitStartPct] = useState(50);
  const [suit, setSuit] = useState<SuitState>(() => scaledSuit(0.5));
  const [found, setFound] = useState<Set<string>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [walking, setWalking] = useState<RouteResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [tracks, setTracks] = useState<Pt[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [exVersion, setExVersion] = useState(0);
  /** NASA sites already reached this game (their clue is logged once). */
  const visitedRef = useRef(new Set<string>());

  useEffect(() => {
    // The Data role's real Jezero pack; fake.json only if it is missing.
    getJson<DataPack>('/data/jezero_pack.json').catch(() => getJson<DataPack>('/data/fake.json')).then(setDataPack).catch(() => setDataPack(null));
    getJson<PoiFile>('/data/pois.json').then(setPois).catch(() => setPois(null));
    getJson<TerrainLayers>('/data/layers_20m.json').then(setTerrainLayers).catch(() => setTerrainLayers(null));
    // content.json arrives with Data's PR #11; until then items use built-in names.
    getJson<MapContent>('/data/content.json').then(setContent).catch(() => setContent(null));
  }, []);

  const realUsable = !!dataPack && dataPack.elevation.cols >= MIN_REAL_CELLS;
  const real = realUsable && !useSynthetic && !!pois;
  const pack = useMemo<DataPack>(
    () => (realUsable && !useSynthetic && dataPack ? dataPack : makeDevPack(dataPack ?? undefined)),
    [dataPack, realUsable, useSynthetic],
  );
  const layout = useMemo(
    () => (real && dataPack && pois ? buildJezeroLayout({ pack: dataPack, pois, layers: terrainLayers, content }, seed) : buildLayout(pack.area, seed)),
    [real, dataPack, pois, terrainLayers, content, pack.area, seed],
  );
  const explored = useMemo(() => createExplored(pack.area), [pack.area]);
  const grid = useMemo(() => makeGrid(pack.elevation, layout.zones), [pack.elevation, layout.zones]);
  const [astronaut, setAstronaut] = useState<Pt>(layout.base);

  const sol = pack.sols[Math.min(solIdx, pack.sols.length - 1)];
  const storm = sol.tau > STORM_TAU;
  const sightM = sightRadius({ night, tau: sol.tau });
  const env = useMemo<Environment>(() => ({ pressureKPa: sol.pressureKPa, tempC: night ? sol.tempMinC : sol.tempMaxC, windMS: sol.windMS, tau: sol.tau }), [sol, night]);
  const model = useMemo<WalkModel>(() => ({ speedMS: speed, loadKg: load, env }), [speed, load, env]);
  const router = useMemo(() => (autoPath ? (a: Pt, b: Pt) => findPath(grid, model, a, b) : undefined), [autoPath, grid, model]);

  const reveal = useCallback((p: Pt, r: number, items: MapItem[], have: Set<string>) => {
    markSeen(explored, p, r);
    const fresh = newlyVisible(items, p, r, have);
    fresh.forEach((i) => have.add(i.id));
    return fresh;
  }, [explored]);

  // Latest settings for reset(), so a new game uses the current slider values.
  const settings = useRef({ sightM, suitStartPct, sol: sol.sol });
  useEffect(() => { settings.current = { sightM, suitStartPct, sol: sol.sol }; });

  // New game whenever the map or seed changes, or on the button.
  const reset = useCallback(() => {
    const { sightM, suitStartPct, sol: solNo } = settings.current;
    explored.seen.fill(0);
    visitedRef.current.clear();
    const have = new Set<string>();
    const first = reveal(layout.base, sightM, layout.items, have);
    setFound(have);
    setAstronaut(layout.base);
    setWaypoints([]);
    setTracks([]);
    setSuit(scaledSuit(suitStartPct / 100));
    setLog([...first.map((f) => `Nearby: ${f.label}`), `Sol ${solNo}: you wake in the lander cabin (game fiction). The radio is dead. Find the comms link page, then Perseverance.`]);
    setExVersion((v) => v + 1);
  }, [explored, layout, reveal]);
  useEffect(() => { reset(); }, [reset]);

  // Planning (paused while walking: the walk animates a frozen copy of the route).
  const planned = useMemo(
    () => (!walking && waypoints.length ? planRoute(pack.elevation, layout.zones, astronaut, layout.base, waypoints, suit, { speedMS: speed, loadKg: load, env, router }) : null),
    [walking, pack.elevation, layout, astronaut, waypoints, suit, speed, load, env, router],
  );
  const route = walking ?? planned;

  // The safe-return zone, recomputed whenever the astronaut stops.
  const range = useMemo(
    () => (walking ? null : rangeField(grid, model, astronaut, layout.base, suit)),
    [walking, grid, model, astronaut, layout.base, suit],
  );
  const lastRange = useRef(range);
  if (range) lastRange.current = range;
  const shownRange = range ?? lastRange.current;
  const safeKm2 = useMemo(() => {
    if (!shownRange) return 0;
    let n = 0;
    for (const v of shownRange.safe) if (v >= RESERVE) n++;
    return (n * pack.elevation.cellM ** 2) / 1e6;
  }, [shownRange, pack.elevation.cellM]);

  // Animate the walk along the costed route: the astronaut moves, sees, and finds things.
  const anim = useRef<number | null>(null);
  const walk = () => {
    if (!planned || walking) return;
    if (planned.legs.some((l) => l.blocked)) { setLog((l) => ['Route blocked: a slope is too steep to walk. Move a waypoint.', ...l]); return; }
    const r = planned;
    setWalking(r);
    const samples = r.samples;
    const have = new Set(found);
    const visited = visitedRef.current;
    const msPerSample = Math.max(8, Math.min(40, 5000 / samples.length));
    let i = 0, last = performance.now();
    const step = (now: number) => {
      const trail: Pt[] = [];
      while (now - last >= msPerSample && i < samples.length - 1) {
        i++; last += msPerSample;
        const s = samples[i];
        trail.push(s.at);
        const fresh = reveal(s.at, sightM, layout.items, have);
        for (const c of layout.items) {
          if ((c.kind === 'clue' || c.kind === 'science') && !visited.has(c.id) && Math.hypot(c.at.x - s.at.x, c.at.y - s.at.y) < 60) {
            visited.add(c.id);
            setLog((l) => [`◆ +${fmtMin(s.t)}: reached ${c.label} (NASA site).${c.note ? ` ${c.note}` : ''}`, ...l]);
          }
        }
        if (fresh.length) {
          setLog((l) => [...fresh.map((f) => foundMessage(s.t, f)), ...l]);
          setPings((p) => [...p.filter((x) => now - x.t0 < 2000), ...fresh.map((f) => ({ at: f.at, t0: now }))]);
        }
        setAstronaut(s.at);
        setSuit(s.state);
      }
      if (trail.length) setTracks((t) => [...t, ...trail]);
      setProgress(i);
      setFound(new Set(have));
      setExVersion((v) => v + 1);
      if (i < samples.length - 1) anim.current = requestAnimationFrame(step);
      else {
        setWalking(null);
        setProgress(0);
        setWaypoints([]);
        setLog((l) => [`Arrived after ${fmtMin(r.minutes)}, ${(r.distM / 1000).toFixed(2)} km.`, ...l]);
      }
    };
    anim.current = requestAnimationFrame(step);
  };
  useEffect(() => () => { if (anim.current) cancelAnimationFrame(anim.current); }, []);

  const toggle = (k: keyof MapLayers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const end = planned?.end;
  const hiddenTotal = layout.items.filter((i) => i.hidden).length;
  const foundHidden = layout.items.filter((i) => i.hidden && found.has(i.id)).length;
  const hasComms = layout.items.some((i) => i.required && found.has(i.id));

  return (
    <div className="md">
      <header className="md-head">
        <div><strong>AER · MARS MAP</strong> <span className="dim">/ Jezero traverse planner (map role test page)</span></div>
        <div className="md-chips">
          <span className="chip">SAFE ZONE <b>{safeKm2.toFixed(2)} km²</b></span>
          <span className="chip">SIGHT <b style={{ color: sightM < 100 ? 'var(--warning)' : undefined }}>{sightM} m</b></span>
          <span className="chip">FOUND <b>{foundHidden}/{hiddenTotal}</b></span>
          <span className="chip">COMMS PAGE <b style={{ color: hasComms ? 'var(--fg)' : 'var(--dim)' }}>{hasComms ? 'YES' : 'NO'}</b></span>
          {storm && <span className="chip crit">DUST STORM τ {sol.tau}</span>}
        </div>
        <div className="md-src">
          <span className={pack.source.startsWith('SYNTHETIC') ? 'badge warn' : 'badge'}>{pack.source}</span>
          <span className="dim">{pack.area.name} · {(pack.area.widthM / 1000).toFixed(1)} × {(pack.area.heightM / 1000).toFixed(1)} km · {pack.elevation.cols}×{pack.elevation.rows} @ {pack.elevation.cellM} m</span>
        </div>
      </header>

      <main className="md-main">
        <section className="md-left">
          <div className="md-map">
            <MapView
              pack={pack} zones={layout.zones} items={layout.items} found={found}
              explored={explored} exploredVersion={exVersion} base={layout.base}
              astronaut={astronaut} sightM={sightM} waypoints={waypoints} route={route} layers={layers}
              range={shownRange} reserve={RESERVE} crashPath={layout.crashPath} tracks={tracks} pings={pings}
              archiveTraverse={layout.archiveTraverse} roverTracks={layout.roverTracks} searchArea={layout.searchArea}
              night={night} storm={storm}
              onAddWaypoint={(p) => !walking && setWaypoints((w) => [...w, p])}
              onRemoveWaypoint={(i) => !walking && setWaypoints((w) => w.filter((_, j) => j !== i))}
            />
            <div className="md-hint dim">click = waypoint · right-click = remove · wheel = zoom · drag = pan · double-click = fit</div>
          </div>
          {route && (
            <div className="md-profile">
              <RouteProfile el={pack.elevation} route={route} full={FULL_SUIT} progress={walking ? progress : undefined}
                title={profileTitle(pack, sol.sol)} />
            </div>
          )}
        </section>

        <aside className="md-side">
          <div className="card">
            <h3>Conditions</h3>
            <label>Sol <select value={solIdx} onChange={(e) => setSolIdx(Number(e.target.value))}>
              {pack.sols.map((s, i) => <option key={s.sol} value={i}>Sol {s.sol} · τ {s.tau}{s.tau > STORM_TAU ? ' (storm)' : ''}</option>)}
            </select></label>
            <label><input type="checkbox" checked={night} onChange={() => setNight(!night)} /> Night</label>
            <div className="dim small">{env.tempC} °C · wind {env.windMS} m/s · {env.pressureKPa} kPa</div>
          </div>

          <div className="card">
            <h3>Suit {planned && <span className="dim small">(now → after route)</span>}</h3>
            <Gauge label="O₂" now={suit.o2Kg} end={end?.o2Kg} full={FULL_SUIT.o2Kg} unit="kg" />
            <Gauge label="Water" now={suit.waterKg} end={end?.waterKg} full={FULL_SUIT.waterKg} unit="kg" />
            <Gauge label="Battery" now={suit.batteryWh} end={end?.batteryWh} full={FULL_SUIT.batteryWh} unit="Wh" />
            <Gauge label="LiOH" now={suit.liohKg} end={end?.liohKg} full={FULL_SUIT.liohKg} unit="kg" />
            <div className="dim small">Core {suit.coreTempC.toFixed(1)} °C{end ? ` → ${end.coreTempC.toFixed(1)} °C` : ''}</div>
            <label className="small">Start suit <input type="range" min={10} max={100} step={5} value={suitStartPct} onChange={(e) => setSuitStartPct(Number(e.target.value))} /> {suitStartPct}% <span className="dim">(new game)</span></label>
          </div>

          <div className="card">
            <h3>Route</h3>
            <label className="small">Speed <input type="range" min={0.3} max={1.4} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /> {speed.toFixed(1)} m/s</label>
            <label className="small">Load <input type="range" min={0} max={40} step={5} value={load} onChange={(e) => setLoad(Number(e.target.value))} /> {load} kg</label>
            <label className="small"><input type="checkbox" checked={autoPath} onChange={() => setAutoPath(!autoPath)} /> Smart path (least O₂, avoids cliffs and sand)</label>
            {!route && <p className="dim small">Click the map to plan a walk from where you stand. Stay inside the green line to be sure of getting home.</p>}
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
                {route.turnBackByMin === null
                  ? <div className="small" style={{ color: 'var(--critical)' }}>Point of no return: turning back is already unsafe.</div>
                  : route.pnrIndex !== null && <div className="small" style={{ color: 'var(--critical)' }}>Point of no return after {fmtMin(route.turnBackByMin)}, before waypoint {route.pnrIndex + 1} (Sim's check: walk back the same way).</div>}
                {route.legs.some((l) => l.zones.length) && <div className="dim small">Crosses: {[...new Set(route.legs.flatMap((l) => l.zones))].map((id) => layout.zones.find((z) => z.id === id)?.label).join(', ')}</div>}
                {route.legs.flatMap((l) => l.warnings).slice(-2).map((w, i) => <div key={i} className="small" style={{ color: w.level === 'critical' ? 'var(--critical)' : 'var(--warning)' }}>⚠ {w.message}</div>)}
              </>
            )}
            <div className="btns">
              <button onClick={walk} disabled={!planned || !!walking}>{walking ? 'Walking…' : 'Walk ▶'}</button>
              <button onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length || !!walking}>Undo</button>
              <button onClick={() => setWaypoints([])} disabled={!waypoints.length || !!walking}>Clear</button>
            </div>
          </div>

          <div className="card">
            <h3>Map layers</h3>
            <div className="toggles">
              {(['range', 'contours', 'slope', 'hazards', 'fog', 'grid', 'allItems'] as const).map((k) => (
                <label key={k}><input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {{ range: 'safe zone', contours: 'contours', slope: 'slope', hazards: 'hazards', fog: 'explored', grid: 'grid', allItems: 'show hidden (dev)' }[k]}</label>
              ))}
            </div>
            <div className="legend small">
              <span><i style={{ background: 'transparent', borderColor: '#4dff88' }} />safe return</span>
              <span><i style={{ background: 'rgba(24,12,0,.6)', borderColor: '#ffb000' }} />one-way</span><span><i style={{ background: 'rgba(30,0,0,.8)' }} />out of reach</span>
              <span><i style={{ background: 'rgba(255,200,0,.5)' }} />&gt;10°</span>
              <span><i style={{ background: 'rgba(255,140,0,.7)' }} />&gt;15°</span>
              <span><i style={{ background: 'rgba(255,60,60,.8)' }} />&gt;25° blocked</span>
              <span><i className="dots" />{real ? 'loose sand likely (THEMIS)' : 'soft sand'}</span>
              <span><i className="hatch" />{real ? 'rocky (HiRISE)' : 'boulders'}</span>
            </div>
            <div className="dim small">Safe zone: estimate from steady walking rates of the team's suit model, {Math.round(RESERVE * 100)}% reserve. Route numbers are simulated step by step.</div>
            <div className="small">Explored {(exploredFraction(explored) * 100).toFixed(1)}%</div>
            <label className="small">Seed <input type="number" value={seed} min={1} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} /></label>
            {realUsable && <label className="small"><input type="checkbox" checked={useSynthetic} onChange={() => setUseSynthetic(!useSynthetic)} /> use synthetic terrain</label>}
            <div className="btns"><button onClick={reset} disabled={!!walking}>New game</button></div>
          </div>

          <div className="card log">
            <h3>Log</h3>
            {log.map((l, i) => <div key={i} className="small" style={{ color: l.startsWith('★') ? '#ffffff' : undefined }}>{l}</div>)}
          </div>
        </aside>
      </main>
    </div>
  );
}

/** /map.html?hud: the HUD map component on its own, at HUD size, to test it without editing the UI role's Hud.tsx. */
function HudMapPreview() {
  const [pack, setPack] = useState<DataPack | null>(null);
  useEffect(() => { getJson<DataPack>('/data/jezero_pack.json').then(setPack).catch(() => setPack(null)); }, []);
  if (!pack) return <p className="dim">Loading…</p>;
  const sol = pack.sols[0];
  const env: Environment = { pressureKPa: sol.pressureKPa, tempC: sol.tempMaxC, windMS: sol.windMS, tau: sol.tau };
  return (
    <div style={{ maxWidth: 760, margin: '16px auto', padding: '0 16px', display: 'flex', flexDirection: 'column', minHeight: '90vh' }}>
      <p className="dim small">Map role preview of the HUD map (no movement: the player stays at the cabin).</p>
      <HudMap pack={pack} suit={FULL_SUIT} env={env} storm={sol.tau > STORM_TAU} sol={sol.sol} />
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode>{new URLSearchParams(location.search).has('hud') ? <HudMapPreview /> : <MapDemo />}</StrictMode>);
