// The map inside the in-suit HUD. The player clicks waypoints, the map plans the route on the Data role's real
// Jezero terrain, and WALK hands the route to the HUD's game clock: each leg's Sim Activity (speed, slope, load)
// drives the suit while the astronaut moves along the route in game time.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoiFile, TerrainLayers } from '../data/files';
import type { DataPack } from '../data/types';
import type { Activity, Environment, Shelter, SuitState } from '../sim/types';
import type { Pt } from './geo';
import { buildLayout } from './layout';
import type { MapItem } from './layout';
import { MapView } from './MapView';
import type { MapLayers, Ping } from './MapView';
import { findPath, makeGrid, rangeField } from './pathfind';
import { buildJezeroLayout } from './realData';
import type { MapContent } from './realData';
import { planRoute } from './route';
import type { RouteResult } from './route';
import { createExplored, markSeen, newlyVisible, sightRadius } from './visibility';
import './map.css';
import './hudMap.css';

/** Walking pace and carried load for planning (design values; Sim owns the physiology). */
const WALK = { speedMS: 0.8, loadKg: 10 };
const RESERVE = 0.1;
const REST: Activity = { speedMS: 0, slopeDeg: 0, loadKg: 0 };
const LAYERS: MapLayers = { slope: false, hazards: true, fog: true, grid: false, contours: false, range: true, allItems: false };

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const getJson = <T,>(url: string): Promise<T> => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() as Promise<T>; });

export interface HudMapProps {
  pack: DataPack;
  /** Game clock (minutes); the walk advances with it, so pausing the game pauses the walk. */
  clockMin: number;
  suit: SuitState;
  env: Environment;
  night: boolean;
  storm: boolean;
  /** MEDA sol shown in the map caption. */
  sol: number;
  /** The astronaut's activity changed (a new route leg, or arrival). The HUD puts it into the game state. */
  onMove: (activity: Activity, shelter: Shelter) => void;
  /** Change to stop a walk where the astronaut is (the HUD took over the activity). */
  stopKey?: number;
  /** Change to start again at the cabin (new game). */
  resetKey?: number;
}

interface Walk { route: RouteResult; startMin: number; leg: number }

/** Point along the route at `t` game minutes from the start (between the costed samples). */
function pointAt(route: RouteResult, t: number, from: Pt): Pt {
  const s = route.samples;
  if (!s.length) return from;
  if (t <= s[0].t) return s[0].at;
  for (let i = 1; i < s.length; i++) {
    if (s[i].t >= t) {
      const f = (t - s[i - 1].t) / Math.max(1e-9, s[i].t - s[i - 1].t);
      return { x: s[i - 1].at.x + (s[i].at.x - s[i - 1].at.x) * f, y: s[i - 1].at.y + (s[i].at.y - s[i - 1].at.y) * f };
    }
  }
  return s[s.length - 1].at;
}

/** Index of the Sim leg that is under way `t` minutes into the walk. */
function legAt(route: RouteResult, t: number): number {
  let acc = 0;
  for (let i = 0; i < route.simLegs.length; i++) {
    acc += route.simLegs[i].minutes;
    if (t < acc) return i;
  }
  return route.simLegs.length - 1;
}

function foundLine(f: MapItem): string {
  if (f.required) return '★ Found the ROVER COMMS LINK page. Now find the rover.';
  if (f.kind === 'rover') return '★ Found the rover. Its radio can reach Earth.';
  return `Found ${f.label}${f.fiction ? ' (game fiction)' : ''}`;
}

export function HudMap({ pack, clockMin, suit, env, night, storm, sol, onMove, stopKey, resetKey }: HudMapProps) {
  // undefined = still loading, null = missing (then the synthetic test layout is used).
  const [pois, setPois] = useState<PoiFile | null | undefined>(undefined);
  const [terrainLayers, setTerrainLayers] = useState<TerrainLayers | null>(null);
  const [content, setContent] = useState<MapContent | null>(null);
  const [mapCaption, setMapCaption] = useState('Base map: MRO HiRISE (USGS Mars 2020 TRN mosaic)');

  useEffect(() => {
    getJson<PoiFile>('/data/pois.json').then(setPois).catch(() => setPois(null));
    getJson<TerrainLayers>('/data/layers_20m.json').then(setTerrainLayers).catch(() => setTerrainLayers(null));
    // content.json and credits.json come with Data's PR #11; the map works without them.
    getJson<MapContent>('/data/content.json').then(setContent).catch(() => setContent(null));
    getJson<{ chartLabels?: { map?: string } }>('/data/credits.json').then((c) => { if (c.chartLabels?.map) setMapCaption(c.chartLabels.map); }).catch(() => {});
  }, []);

  const real = !!pois && pack.elevation.cols >= 32;
  const loading = pois === undefined;
  const layout = useMemo(
    () => (real && pois ? buildJezeroLayout({ pack, pois, layers: terrainLayers, content }, 1)
      : loading ? { ...buildLayout(pack.area, 1), items: [], zones: [], crashPath: [] } : buildLayout(pack.area, 1)),
    [real, loading, pack, pois, terrainLayers, content],
  );
  const explored = useMemo(() => createExplored(pack.area), [pack.area]);
  const grid = useMemo(() => makeGrid(pack.elevation, layout.zones), [pack.elevation, layout.zones]);
  const sightM = sightRadius({ night, tau: env.tau });

  const [astronaut, setAstronaut] = useState<Pt>(layout.base);
  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [walk, setWalk] = useState<Walk | null>(null);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [tracks, setTracks] = useState<Pt[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [exVersion, setExVersion] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  // Snapshots of the suit and weather: planning uses the moment of the last click, the safe zone the last stop,
  // so routes are not re-planned on every HUD frame.
  const live = useRef({ suit, env });
  useEffect(() => { live.current = { suit, env }; });
  const [planAt, setPlanAt] = useState(() => ({ suit, env }));
  const [stopAt, setStopAt] = useState(() => ({ suit, env }));
  const visited = useRef(new Set<string>());

  // New game: back to the cabin with only the nearby ground seen.
  useEffect(() => {
    explored.seen.fill(0);
    visited.current.clear();
    markSeen(explored, layout.base, sightM);
    const have = new Set(newlyVisible(layout.items, layout.base, sightM, new Set()).map((i) => i.id));
    setFound(have);
    setAstronaut(layout.base);
    setWaypoints([]);
    setWalk(null);
    setTracks([]);
    setStopAt(live.current);
    setLog(['You wake in the lander cabin (game fiction). Find the comms link page, then Perseverance.']);
    setExVersion((v) => v + 1);
    // sightM is read once at the start; later changes apply as the astronaut moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, explored, resetKey]);

  const planModel = useMemo(() => ({ ...WALK, env: planAt.env }), [planAt.env]);
  const planned = useMemo(() => {
    if (walk || !waypoints.length) return null;
    const router = (a: Pt, b: Pt) => findPath(grid, planModel, a, b);
    return planRoute(pack.elevation, layout.zones, astronaut, layout.base, waypoints, planAt.suit, { ...planModel, router });
  }, [walk, waypoints, grid, planModel, pack.elevation, layout, astronaut, planAt.suit]);
  const route = walk?.route ?? planned;

  const range = useMemo(
    () => (walk ? null : rangeField(grid, { ...WALK, env: stopAt.env }, astronaut, layout.base, stopAt.suit)),
    [walk, grid, stopAt, astronaut, layout.base],
  );
  const lastRange = useRef(range);
  if (range) lastRange.current = range;

  // The walk runs on the game clock: position, current leg and what the astronaut sees.
  const t = walk ? Math.max(0, clockMin - walk.startMin) : 0;
  const leg = walk ? legAt(walk.route, t) : -1;
  const done = !!walk && t >= walk.route.minutes;
  const pos = walk ? pointAt(walk.route, Math.min(t, walk.route.minutes), astronaut) : astronaut;

  useEffect(() => {
    if (!walk) return;
    if (done) {
      const end = walk.route.samples.at(-1)?.at ?? pos;
      const home = Math.hypot(end.x - layout.base.x, end.y - layout.base.y) < 30;
      setAstronaut(end);
      setWalk(null);
      setWaypoints([]);
      setStopAt(live.current);
      setLog((l) => [`Arrived after ${fmtMin(walk.route.minutes)}, ${(walk.route.distM / 1000).toFixed(2)} km.${home ? ' Back in the cabin.' : ''}`, ...l].slice(0, 6));
      onMove(REST, home ? 'cabin' : 'none');
      return;
    }
    if (leg !== walk.leg) {
      setWalk({ ...walk, leg });
      onMove(walk.route.simLegs[leg]?.activity ?? REST, 'none');
    }
  }, [walk, done, leg, pos, layout.base, onMove]);

  // Reveal the ground and items around the moving astronaut.
  const lastPos = useRef<Pt | null>(null);
  useEffect(() => {
    if (!walk) { lastPos.current = null; return; }
    const prev = lastPos.current;
    if (prev && Math.hypot(prev.x - pos.x, prev.y - pos.y) < 5) return;
    lastPos.current = pos;
    markSeen(explored, pos, sightM);
    const fresh = newlyVisible(layout.items, pos, sightM, found);
    const notes: string[] = [];
    for (const c of layout.items) {
      if ((c.kind === 'clue' || c.kind === 'science') && !visited.current.has(c.id) && Math.hypot(c.at.x - pos.x, c.at.y - pos.y) < 60) {
        visited.current.add(c.id);
        notes.push(`◆ Reached ${c.label} (NASA site).${c.note ? ` ${c.note}` : ''}`);
      }
    }
    if (fresh.length) {
      setFound((f) => new Set([...f, ...fresh.map((i) => i.id)]));
      const now = performance.now();
      setPings((p) => [...p.filter((x) => now - x.t0 < 2000), ...fresh.map((i) => ({ at: i.at, t0: now }))]);
    }
    if (fresh.length || notes.length) setLog((l) => [...fresh.map(foundLine), ...notes, ...l].slice(0, 6));
    setTracks((tr) => [...tr, pos]);
    setExVersion((v) => v + 1);
  }, [walk, pos, explored, sightM, layout.items, found]);

  // The HUD took over (a test mode or the storm shelter flow): stop where the astronaut is.
  const stopRef = useRef(stopKey);
  useEffect(() => {
    if (stopRef.current === stopKey) return;
    stopRef.current = stopKey;
    if (!walk) return;
    setAstronaut(pos);
    setWalk(null);
    setWaypoints([]);
    setStopAt(live.current);
    setLog((l) => ['Walk stopped.', ...l].slice(0, 6));
  }, [stopKey, walk, pos]);

  const start = () => {
    if (!planned || walk) return;
    if (planned.legs.some((l) => l.blocked)) { setLog((l) => ['Route blocked: a slope is too steep to walk. Move a waypoint.', ...l].slice(0, 6)); return; }
    setWalk({ route: planned, startMin: clockMin, leg: 0 });
    onMove(planned.simLegs[0]?.activity ?? REST, 'none');
  };
  const addWaypoint = (p: Pt) => {
    if (walk) return;
    setPlanAt(live.current);
    setWaypoints((w) => [...w, p]);
  };

  const status = route ? route.status.toUpperCase() : '';
  return (
    <div className="hud-map">
      <div className="hud-map-canvas">
        <MapView
          pack={pack} zones={layout.zones} items={layout.items} found={found}
          explored={explored} exploredVersion={exVersion} base={layout.base}
          astronaut={pos} sightM={sightM} waypoints={waypoints} route={route} layers={LAYERS}
          range={range ?? lastRange.current} reserve={RESERVE} crashPath={layout.crashPath} tracks={tracks} pings={pings}
          archiveTraverse={layout.archiveTraverse} roverTracks={layout.roverTracks} searchArea={layout.searchArea}
          night={night} storm={storm}
          onAddWaypoint={addWaypoint}
          onRemoveWaypoint={(i) => !walk && setWaypoints((w) => w.filter((_, j) => j !== i))}
        />
      </div>
      <div className="hud-map-bar">
        {walk ? (
          <span>WALKING · {fmtMin(Math.min(t, walk.route.minutes))} / {fmtMin(walk.route.minutes)} · LEG {leg + 1}/{walk.route.simLegs.length}</span>
        ) : route ? (
          <span>
            ROUTE {(route.distM / 1000).toFixed(2)} km · {fmtMin(route.minutes)} · <b className={route.status === 'nominal' ? undefined : route.status}>{status}</b>
            {route.turnBackByMin === null ? <b className="critical"> · NO SAFE TURN-BACK</b>
              : route.pnrIndex !== null ? <b className="critical"> · TURN BACK BY {fmtMin(route.turnBackByMin)}</b> : null}
          </span>
        ) : (
          <span className="dim">CLICK THE MAP TO PLAN A WALK · STAY INSIDE THE GREEN LINE TO GET HOME</span>
        )}
        <span className="hud-map-btns">
          <button onClick={start} disabled={!planned || !!walk}>WALK ▶</button>
          <button onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length || !!walk}>UNDO</button>
          <button onClick={() => setWaypoints([])} disabled={!waypoints.length || !!walk}>CLEAR</button>
        </span>
      </div>
      {log[0] && <p className="hud-map-log">{log[0]}</p>}
      <p className="hud-map-src dim">
        {loading ? 'Loading the Jezero map files…' : real ? `${mapCaption} · elevation: HiRISE DTM · soft ground: Mars Odyssey THEMIS · weather: Perseverance MEDA sol ${sol} (archived)` : `Synthetic test terrain · sol ${sol}`}
      </p>
    </div>
  );
}
