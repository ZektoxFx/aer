// The map for the in-suit HUD (Map role): the real Mars photo as the map, click to place a route, danger zones
// (slopes, rocks, sand), and items hidden until the player is close. It does NOT move the player: whoever owns
// movement passes the player's position in (`astronaut`) and gets the planned route out (`onRoute`), which already
// carries Sim's leg list (`route.simLegs`) and point of no return (`route.turnBackByMin`).
//
// For the UI role: how to put it in the HUD, and ideas (e.g. a close-up view of the base when it is clicked),
// are in src/map/NOTES_FOR_UI.md. Map does not edit src/ui/.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PoiFile, TerrainLayers } from '../data/files';
import type { DataPack } from '../data/types';
import { FULL_SUIT } from '../sim/simulate';
import type { EnvAt } from '../sim/route';
import type { Environment, SuitState } from '../sim/types';
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

/** Walking pace and carried load for route costing (design values; Sim owns the physiology). */
const WALK = { speedMS: 0.8, loadKg: 10 };
const RESERVE = 0.1;
const LAYERS: MapLayers = { slope: false, hazards: true, fog: true, grid: false, contours: false, range: true, allItems: false };
/** The safe zone is recomputed once the player has stood still this long (it takes about half a second). */
const SETTLE_MS = 700;

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const getJson = <T,>(url: string): Promise<T> => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json() as Promise<T>; });

export interface HudMapProps {
  pack: DataPack;
  suit: SuitState;
  env: Environment;
  storm: boolean;
  /** MEDA sol shown in the map caption. */
  sol: number;
  night?: boolean;
  /** The player's position in map metres (from the movement owner). Default: the lander cabin. */
  astronaut?: Pt;
  /** The route the player planned (null when cleared). Movement can walk `route.simLegs`. */
  onRoute?: (route: RouteResult | null) => void;
  /** Hidden items that just came into sight. */
  onFound?: (items: MapItem[]) => void;
  /** Optional: conditions over game time (Sim's EnvAt), so the turn-back time counts night falling or a storm. */
  envAt?: EnvAt;
  /** Change to start again at the cabin (new game). */
  resetKey?: number;
}

/** Suit levels shown in the big-map strip, so the player still sees them with the gauges covered. */
const SUIT_STRIP: { label: string; key: 'o2Kg' | 'liohKg' | 'waterKg' | 'batteryWh' }[] = [
  { label: 'O₂', key: 'o2Kg' }, { label: 'SCRUBBER', key: 'liohKg' }, { label: 'WATER', key: 'waterKg' }, { label: 'BATTERY', key: 'batteryWh' },
];

function foundLine(f: MapItem): string {
  if (f.required) return '★ Spotted the ROVER COMMS LINK page.';
  if (f.kind === 'rover') return '★ Spotted the rover.';
  return `Spotted ${f.label}${f.fiction ? ' (game fiction)' : ''}`;
}

export function HudMap({ pack, suit, env, storm, sol, night = false, astronaut, onRoute, onFound, envAt, resetKey }: HudMapProps) {
  // undefined = still loading, null = missing (then the synthetic test layout is used).
  const [pois, setPois] = useState<PoiFile | null | undefined>(undefined);
  const [terrainLayers, setTerrainLayers] = useState<TerrainLayers | null | undefined>(undefined);
  const [content, setContent] = useState<MapContent | null | undefined>(undefined);
  const [mapCaption, setMapCaption] = useState('Base map: MRO HiRISE (USGS Mars 2020 TRN mosaic)');

  useEffect(() => {
    getJson<PoiFile>('/data/pois.json').then(setPois).catch(() => setPois(null));
    getJson<TerrainLayers>('/data/layers_20m.json').then(setTerrainLayers).catch(() => setTerrainLayers(null));
    // content.json and credits.json come with Data's PR #11; the map works without them.
    getJson<MapContent>('/data/content.json').then(setContent).catch(() => setContent(null));
    getJson<{ chartLabels?: { map?: string } }>('/data/credits.json').then((c) => { if (c.chartLabels?.map) setMapCaption(c.chartLabels.map); }).catch(() => {});
  }, []);

  const real = !!pois && pack.elevation.cols >= 32;
  // Wait for all three files, so the layout (and the game) is built once, not reset as each file lands.
  const loading = pois === undefined || terrainLayers === undefined || content === undefined;
  const layout = useMemo(
    () => (real && pois && !loading ? buildJezeroLayout({ pack, pois, layers: terrainLayers ?? null, content }, 1)
      : loading ? { ...buildLayout(pack.area, 1), items: [], zones: [], crashPath: [] } : buildLayout(pack.area, 1)),
    [real, loading, pack, pois, terrainLayers, content],
  );
  const explored = useMemo(() => createExplored(pack.area), [pack.area]);
  const grid = useMemo(() => makeGrid(pack.elevation, layout.zones), [pack.elevation, layout.zones]);
  const sightM = sightRadius({ night, tau: env.tau });
  const ax = astronaut?.x ?? layout.base.x, ay = astronaut?.y ?? layout.base.y;
  const pos = useMemo<Pt>(() => ({ x: ax, y: ay }), [ax, ay]);

  const [waypoints, setWaypoints] = useState<Pt[]>([]);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [tracks, setTracks] = useState<Pt[]>([]);
  const [pings, setPings] = useState<Ping[]>([]);
  const [exVersion, setExVersion] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  // Suit and weather snapshots: the route uses the moment of the last click and the safe zone the moment the player
  // last stood still, so neither is recomputed on every HUD frame.
  const live = useRef({ suit, env });
  useEffect(() => { live.current = { suit, env }; });
  const [planAt, setPlanAt] = useState(() => ({ suit, env }));
  const [rest, setRest] = useState(() => ({ at: pos, suit, env }));
  const visited = useRef(new Set<string>());
  const lastPos = useRef<Pt | null>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [big]);

  // New game: only the ground around the cabin is seen.
  useEffect(() => {
    explored.seen.fill(0);
    visited.current.clear();
    lastPos.current = astronaut ?? layout.base;
    markSeen(explored, layout.base, sightM);
    setFound(new Set(newlyVisible(layout.items, layout.base, sightM, new Set()).map((i) => i.id)));
    setWaypoints([]);
    setTracks([]);
    setLog(['Click the map to plan a route. Items show up when you get close.']);
    setExVersion((v) => v + 1);
    // sightM is read once here; later changes apply as the player moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, explored, resetKey]);

  // Reveal the ground and hidden items around the player as the position changes.
  useEffect(() => {
    const prev = lastPos.current;
    if (prev && Math.hypot(prev.x - pos.x, prev.y - pos.y) < 5) return;
    lastPos.current = pos;
    if (!prev) return; // the start is handled by the new-game reset
    markSeen(explored, pos, sightM);
    const fresh = newlyVisible(layout.items, pos, sightM, found);
    const notes: string[] = [];
    for (const c of layout.items) {
      if ((c.kind === 'clue' || c.kind === 'science') && !visited.current.has(c.id) && Math.hypot(c.at.x - pos.x, c.at.y - pos.y) < 60) {
        visited.current.add(c.id);
        notes.push(`◆ ${c.label} (NASA site).${c.note ? ` ${c.note}` : ''}`);
      }
    }
    if (fresh.length) {
      setFound((f) => new Set([...f, ...fresh.map((i) => i.id)]));
      const now = performance.now();
      setPings((p) => [...p.filter((x) => now - x.t0 < 2000), ...fresh.map((i) => ({ at: i.at, t0: now }))]);
      onFound?.(fresh);
    }
    if (fresh.length || notes.length) setLog((l) => [...fresh.map(foundLine), ...notes, ...l].slice(0, 6));
    setTracks((tr) => [...tr, pos]);
    setExVersion((v) => v + 1);
  }, [pos, explored, sightM, layout.items, found, onFound]);

  // Safe zone: recomputed once the player has stood still for a moment.
  useEffect(() => {
    if (rest.at.x === pos.x && rest.at.y === pos.y) return;
    const id = setTimeout(() => setRest({ at: pos, ...live.current }), SETTLE_MS);
    return () => clearTimeout(id);
  }, [pos, rest.at]);
  const range = useMemo(
    () => rangeField(grid, { ...WALK, env: rest.env }, rest.at, layout.base, rest.suit),
    [grid, rest, layout.base],
  );

  // The route is planned from where the player is now.
  const planModel = useMemo(() => ({ ...WALK, env: planAt.env }), [planAt.env]);
  // Paths are cached per (from, to), so adding a waypoint only searches the new leg.
  const router = useMemo(() => {
    const cache = new Map<string, Pt[] | null>();
    return (a: Pt, b: Pt) => {
      const k = `${a.x.toFixed(1)},${a.y.toFixed(1)}>${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      if (!cache.has(k)) cache.set(k, findPath(grid, planModel, a, b));
      return cache.get(k) ?? null;
    };
  }, [grid, planModel]);
  const route = useMemo(() => {
    if (!waypoints.length) return null;
    return planRoute(pack.elevation, layout.zones, pos, layout.base, waypoints, planAt.suit, { ...planModel, router, envAt });
  }, [waypoints, router, planModel, pack.elevation, layout, pos, planAt.suit, envAt]);
  useEffect(() => { onRoute?.(route); }, [route, onRoute]);

  const addWaypoint = (p: Pt) => { setPlanAt(live.current); setWaypoints((w) => [...w, p]); };

  return (
    <div className={big ? 'hud-map big' : 'hud-map'}>
      {big && (
        <div className="hud-map-suit" aria-label="Suit levels">
          {SUIT_STRIP.map(({ label, key }) => {
            const pct = Math.max(0, Math.min(100, (suit[key] / FULL_SUIT[key]) * 100));
            return (
              <span key={key} className={pct < 30 ? 'warning' : undefined}>
                {label} {pct.toFixed(0)}%<i><b style={{ width: `${pct}%` }} /></i>
              </span>
            );
          })}
          <span className={storm ? 'warning' : 'dim'}>{storm ? 'DUST STORM' : night ? 'NIGHT' : 'DAY'} · SIGHT {sightM} m</span>
        </div>
      )}
      <div className="hud-map-canvas">
        <MapView
          pack={pack} zones={layout.zones} items={layout.items} found={found}
          explored={explored} exploredVersion={exVersion} base={layout.base}
          astronaut={pos} sightM={sightM} waypoints={waypoints} route={route} layers={LAYERS}
          range={range} reserve={RESERVE} crashPath={layout.crashPath} tracks={tracks} pings={pings}
          archiveTraverse={layout.archiveTraverse} roverTracks={layout.roverTracks} searchArea={layout.searchArea}
          night={night} storm={storm}
          onAddWaypoint={addWaypoint}
          onRemoveWaypoint={(i) => setWaypoints((w) => w.filter((_, j) => j !== i))}
        />
      </div>
      <div className="hud-map-bar">
        {route ? (
          <span>
            ROUTE {(route.distM / 1000).toFixed(2)} km · {fmtMin(route.minutes)} · <b className={route.status === 'nominal' ? undefined : route.status}>{route.status.toUpperCase()}</b>
            {route.legs.some((l) => l.blocked) ? <b className="critical"> · TOO STEEP: MOVE A WAYPOINT</b>
              : route.turnBackByMin === null ? <b className="critical"> · NO SAFE TURN-BACK</b>
                : route.pnrIndex !== null ? <b className="critical"> · TURN BACK BY {fmtMin(route.turnBackByMin)}</b> : null}
          </span>
        ) : (
          <span className="dim">CLICK THE MAP TO PLACE A ROUTE · STAY INSIDE THE GREEN LINE TO GET HOME</span>
        )}
        <span className="hud-map-btns">
          <button onClick={() => setWaypoints((w) => w.slice(0, -1))} disabled={!waypoints.length}>UNDO</button>
          <button onClick={() => setWaypoints([])} disabled={!waypoints.length}>CLEAR</button>
          <button onClick={() => setBig((b) => !b)} aria-pressed={big} title={big ? 'Back to the HUD (Esc)' : 'Show the map over the whole window'}>
            {big ? '✕ SMALL MAP' : '⤢ BIG MAP'}
          </button>
        </span>
      </div>
      {log[0] && <p className="hud-map-log">{log[0]}</p>}
      <p className="hud-map-src dim">
        {loading ? 'Loading the Jezero map files…' : real ? `${mapCaption} · elevation: HiRISE DTM · soft ground: Mars Odyssey THEMIS · weather: Perseverance MEDA sol ${sol} (archived)` : `Synthetic test terrain · sol ${sol}`}
      </p>
    </div>
  );
}
