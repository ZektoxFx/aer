import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// Straight from the module, not the map index: the index also exports the 3D world builder, which pulls three.js
// into the first download.
import { HudMap } from '../map/HudMap';
import { RouteReplay, type ReplayMark } from '../map/RouteReplay';
import { EarthReply } from './EarthReply';
import { cameraName, loadSitePhotos, photoSiteNear, type SitePhoto } from './sitePhotos';
import { trailAdd } from '../map/replayPath';
import type { MapItem, MapWorldState, Pt, RouteResult } from '../map';
import { SPEED_X, forecast, newGame, outdoorEnv, sunElevationDeg, tick } from '../sim/game';
import { FULL_SUIT, metabolicW } from '../sim/simulate';
import { makeStorm, shelterEnvironment, stormCountdownMin, stormPhase } from '../sim/storm';
import type { Activity, Shelter, StormEvent, TickResult } from '../sim/types';
import { dataCaption, skyFor, type GameData } from './gameData';
import { CONSUMABLE_LABEL, clockLabel, firstToRunOut, formatMinutes, SPEED_LABEL, type Consumable } from './hudFormat';
import {
  SHELTER_CHOICES, chooseShelter, flowPosture, summarize, updateFlow,
  type ShelterChoice, type ShelterFlow, type ShelterSummary,
} from './shelterFlow';
import {
  SOL1_START_LIOH_KG, isHolding, isOver, sol1Act, sol1Advance, sol1Begin, sol1Diagnose, sol1Posture, sol1Start,
  type ActionId, type CauseId, type Sol1State,
} from './sol1';
import { Sol1Panel } from './Sol1Panel';
import { browserStorage, hudKeyAction } from './settings';
import { distM, planFromRoute, planHome, walkAt, type WalkPlan } from './walk';
import { activityFor, basePoint, inCabinZone, type MoveResult } from './movement';
// three.js is big: load the 3D view on demand so the title screen opens fast (#40).
const World3D = lazy(() => import('./World3D').then((m) => ({ default: m.World3D })));
import { dustDevilsInView, stormForecastAt, upcomingEvents } from './environment';
import { missionSteps, nextRelayPass } from './mission';
import {
  applySupply, BACKPACK_MAX_KG, carriedKg, drop, droppedItems, isPickable, EMPTY_PACK, entryForPickup, fits, givesLabel, HEAVY_KG, manualPage, pickUp,
  pickupTarget, SALVAGE, usable, type Pack, type PackEntry,
} from './inventory';
import {
  aboard, atStorage, canBuild, canRepair, COMMS_LINK_ID, commsLinkEntry, commsLinkJob, doBuild, doRepair, EMPTY_SHIP, hasStorageRoom, repairNeeds, REPAIRS,
  SHIP_LOCKER_KG, shipKg, shipTopUp, STORAGE_ROOM_JOB, store, storeAll, SUIT_LEAK, SUIT_PATCH_ID, SUIT_PATCH_JOB, suitLeaking, take,
  type Repair, type Ship,
} from './ship';
import { callStage, hasCommsLink, installLink, LIGHT_TIME_MIN, roverInReach, watchFailure, type FailCause, type FailWatch } from './ending';
import { COVER_RADIUS_M, coverRocks, nearestCover, stormEffort, stormStrength, underCover, type NearCover } from './cover';
import { CACHE_SITE, findingById, FINDINGS, newFindings, takeHome, type FindingId, type FindingSignals } from './findings';
import { bearing, currentQuest } from './quest';
import { compassPoint, sunPosition } from './sun';
import { SunDial } from './SunDial';
import { debrisItems } from './debris';
import { Credits } from './Credits';
import type { BaseLook } from './props3d';
import './game3d.css';
import './hud.css';

// Test controls until Map drives the activity from a planned route.
const MODES: { id: string; label: string; activity: Activity; shelter: Shelter }[] = [
  { id: 'cabin', label: 'IN CABIN', activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'cabin' },
  { id: 'rest', label: 'REST OUTSIDE', activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'none' },
  { id: 'walk', label: 'WALK', activity: { speedMS: 1, slopeDeg: 0, loadKg: 10 }, shelter: 'none' },
  { id: 'run', label: 'RUN', activity: { speedMS: 2, slopeDeg: 0, loadKg: 10 }, shelter: 'none' },
];

const SHELTER_NAME: Record<Shelter, string> = { cabin: 'CABIN', wreck: 'WRECK', builtShelter: 'BUILT SHELTER', none: 'OPEN GROUND' };

/** In-suit HUD: a visor frame of readouts around an open centre (map and photos go there later). */
/** What the end card shows about the run: distance, O₂ breathed, the route walked and where findings were made. */
interface EndStats { walkedM: number; o2UsedKg: number; trail: Pt[]; foundAt: Partial<Record<FindingId, Pt>> }
const freshStats = (): EndStats & { lastPos: Pt | null } => ({ walkedM: 0, o2UsedKg: 0, trail: [], foundAt: {}, lastPos: null });
const snapStats = (st: EndStats): EndStats => ({ walkedM: st.walkedM, o2UsedKg: st.o2UsedKg, trail: st.trail.slice(), foundAt: { ...st.foundAt } });

export function Hud({ data, mode = '2d', onView }: { data: GameData; mode?: '2d' | '3d'; onView?: (v: 'hud' | 'telemetry') => void }) {
  const { pack } = data;
  const base = useMemo(() => basePoint(pack), [pack]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  // 3D free walking: the latest movement from the 3D view, and a key to put the astronaut back at the cabin.
  const moveRef = useRef<MoveResult | null>(null);
  // LOCAL DRAFT (Map): the map's items, zones, safe zone and route, so the 3D world shows the same world.
  const [mapWorld, setMapWorld] = useState<MapWorldState | null>(null);
  const [placeKey, setPlaceKey] = useState(0);
  const [suitOpen, setSuitOpen] = useState(false);
  // The mission card shows only the next step; the full list opens on demand (keeps the view clear).
  const [goalOpen, setGoalOpen] = useState(false);
  /** The low-O₂ alert was closed: at which level, and until which game minute (it comes back if things get worse). */
  /** The credits scene: 'won' after the call reaches Earth, 'menu' when opened from the menu. */
  const [credits, setCredits] = useState<'won' | 'menu' | null>(null);
  const [o2Hidden, setO2Hidden] = useState<{ level: 'low' | 'critical'; untilMin: number } | null>(null);
  // Pickups and the pack (3D): what is in reach, what is carried, and which manual page is open.
  const [bag, setBagState] = useState<Pack>(EMPTY_PACK);
  const bagRef = useRef<Pack>(EMPTY_PACK);
  const setBag = (b: Pack) => { bagRef.current = b; setBagState(b); };
  const [near, setNear] = useState<MapItem | null>(null);
  // Then and now: the archived Perseverance photo of the NASA site the astronaut is standing at (sitePhotos.ts).
  const [sitePhoto, setSitePhoto] = useState<{ item: MapItem; photo: SitePhoto } | null>(null);
  const [photosShut, setPhotosShut] = useState<string[]>([]);
  const photosRef = useRef<Map<string, SitePhoto>>(new Map());
  useEffect(() => { loadSitePhotos().then((m) => { photosRef.current = m; }).catch(() => {}); }, []);
  const nearRef = useRef<MapItem | null>(null);
  // The ending: Perseverance in reach, the comms link plugged in, the call sent, and the end card.
  const [nearRover, setNearRover] = useState(false);
  const nearRoverRef = useRef(false);
  const [linked, setLinkedState] = useState(false);
  const linkedRef = useRef(false);
  const setLinked = (v: boolean) => { linkedRef.current = v; setLinkedState(v); };
  const [called, setCalled] = useState(false);
  const [endCard, setEndCard] = useState<{ result: 'won' | 'lost'; atMin: number; onMarsMin: number; orbiter?: string; cause?: FailCause; stats?: EndStats } | null>(null);
  const endRef = useRef(false);
  const failRef = useRef<FailWatch | null>(null);
  const runStartRef = useRef<number | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [packTab, setPackTab] = useState<'pack' | 'ship' | 'repairs'>('pack');
  // The lander as a base: storage and repairs (used while standing at it).
  const [ship, setShipState] = useState<Ship>(EMPTY_SHIP);
  const shipRef = useRef<Ship>(EMPTY_SHIP);
  const setShip = (x: Ship) => { shipRef.current = x; setShipState(x); };
  /** At the lander (the cabin zone): a repaired ship refills the suit here. */
  const atShipRef = useRef(true);
  /** Where the storage can be used: inside the lander, or in the storage room once it is built (null = neither). */
  const [storeAt, setStoreAt] = useState<'aboard' | 'room' | null>(null);
  const inStore = storeAt !== null;
  const [readPage, setReadPage] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Act 5 of docs/STORY.md: the field journal of habitability findings, and the numbers for the take-home report.
  const [found, setFoundState] = useState<FindingId[]>([]);
  const foundRef = useRef<FindingId[]>([]);
  const setFound = (f: FindingId[]) => { foundRef.current = f; setFoundState(f); };
  const [journalOpen, setJournalOpen] = useState(false);
  const statsRef = useRef<EndStats & { lastPos: Pt | null }>(freshStats());
  /** Add whatever these signals unlock to the journal, with a toast for the first new one. */
  const unlockFindings = (sig: FindingSignals) => {
    const fresh = newFindings(foundRef.current, sig);
    if (!fresh.length) return;
    // Remember where each finding was made, for the route replay's markers at the end.
    const at = sig.pos ?? statsRef.current.lastPos;
    if (at) for (const id of fresh) statsRef.current.foundAt[id] = { ...at };
    setFound([...foundRef.current, ...fresh]);
    setToast(`New finding: ${findingById(fresh[0]).title}. Press J for the field journal.`);
  };
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  // One map for both views (#40): it renders into a host element that moves between the 2D and 3D layouts, so
  // switching views doesn't rebuild it (and recompute the safe zone).
  const [mapHost] = useState(() => { const d = document.createElement('div'); d.className = 'hud-map-host'; return d; });
  const mapSlot = useCallback((el: HTMLDivElement | null) => { if (el && mapHost.parentElement !== el) el.appendChild(mapHost); }, [mapHost]);
  const mapWorldRef = useRef<MapWorldState | null>(null);
  useEffect(() => { mapWorldRef.current = mapWorld; }, [mapWorld]);
  // Taken items leave the 3D world.
  // Taken items leave the 3D world; dropped ones lie where they were put down.
  // Perseverance is drawn by the UI's own rover model (props3d), so the map's simple one is left out of the 3D world.
  // AER-1's own scattered parts and the storage-room blueprint (UI items, debris.ts) join the map's items in the 3D
  // world and for picking up.
  const debris = useMemo(() => debrisItems(base, pack.area), [base, pack.area]);
  const pickWorld = useMemo(() => (mapWorld ? { ...mapWorld, items: [...mapWorld.items, ...debris] } : { items: debris, found: new Set<string>() }), [mapWorld, debris]);
  const pickWorldRef = useRef(pickWorld);
  useEffect(() => { pickWorldRef.current = pickWorld; }, [pickWorld]);
  const world3d = useMemo(() => {
    if (!mapWorld) return mapWorld;
    // Taken items leave the 3D world. Salvage sites stay (the hardware is still there), except the Three Forks cache:
    // once its tubes are in the backpack there is nothing left to show (the 3D view animates them into the hands).
    const gone = (i: MapItem) => bag.taken.includes(i.id) || (i.id === CACHE_SITE && bag.salvaged.includes(i.id));
    const items = [...mapWorld.items.filter((i) => i.kind !== 'rover'), ...debris].filter((i) => !gone(i));
    return { ...mapWorld, items: [...items, ...droppedItems(bag)] };
  }, [mapWorld, bag, debris]);
  const roverItem = mapWorld?.items.find((i) => i.kind === 'rover') ?? null;
  const roverSeen = !!roverItem && (!roverItem.hidden || !!mapWorld?.found.has(roverItem.id));
  // Rock overhangs to shelter under in a dust storm (the same ones the 3D view draws).
  const covers = useMemo(() => coverRocks(base, pack.area), [base, pack.area]);
  const [cover, setCover] = useState<NearCover | null>(() => nearestCover(base, covers));
  const coversRef = useRef(covers);
  useEffect(() => { coversRef.current = covers; }, [covers]);
  /** The storm the player chose to ride out under a rock (the shelter cards stay closed for it). */
  const [coverFor, setCoverFor] = useState<StormEvent | null>(null);
  // Repairs and builds play out as a short animation before the clock jumps (the astronaut at work, sparks).
  const [work, setWork] = useState<{ label: string; minutes: number } | null>(null);
  const workRef = useRef(false);
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (workTimer.current) clearTimeout(workTimer.current); }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lookLocked, setLookLocked] = useState(false);
  // How to play: shown once per browser on the first 3D visit (the clock holds while it is open); MENU reopens it.
  const [howToOpen, setHowToOpen] = useState(() => {
    try { return mode === '3d' && browserStorage()?.getItem('aer.howto.seen') !== '1'; } catch { return mode === '3d'; }
  });
  const closeHowTo = () => {
    setHowToOpen(false);
    setPaused(false);
    try { browserStorage()?.setItem('aer.howto.seen', '1'); } catch { /* private window: show again next time */ }
  };
  // The controls hint fades out once the player starts walking (or after 15 s).
  const [hintOn, setHintOn] = useState(true);
  const hintOnRef = useRef(true);
  useEffect(() => {
    if (howToOpen) return; // count from when the player can actually play
    const id = setTimeout(() => { hintOnRef.current = false; setHintOn(false); }, 15000);
    return () => clearTimeout(id);
  }, [howToOpen]);
  // LOCAL DRAFT (Map/Aiman): first- or third-person camera in the 3D view; V switches.
  // LOCAL DRAFT: start in first person (the eyes open through the visor at the end of the intro), then the camera
  // pulls back to third person after a few seconds, unless the player has already picked a view.
  const [view, setView] = useState<'first' | 'third'>(mode === '3d' ? 'first' : 'third');
  const viewPicked = useRef(false);
  useEffect(() => {
    const id = setTimeout(() => { if (!viewPicked.current) setView('third'); }, 8000);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    if (mode !== '3d') return;
    const onV = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('input, select, textarea')) return;
      viewPicked.current = true;
      setView((v) => (v === 'first' ? 'third' : 'first'));
    };
    window.addEventListener('keydown', onV);
    return () => window.removeEventListener('keydown', onV);
  }, [mode]);
  const startGame = (i: number) => newGame(pack.sols[i], skyFor(data, pack.sols[i]));
  const [solIndex, setSolIndex] = useState(0);
  const [frame, setFrame] = useState<TickResult>(() => tick(startGame(0), 0, true));
  // Conditions over game time, so the map's TURN BACK BY counts nightfall and storms (#40, from #24). Rebuilt only
  // when the weather day, the storm or the sun data changes, so the map doesn't re-plan every frame.
  const { weather: envWeather, storm: envStorm, sky: envSky } = frame.state;
  const envAt = useMemo(() => {
    const snap = { ...frame.state, weather: envWeather, storm: envStorm, sky: envSky };
    return (t: number) => outdoorEnv({ ...snap, clockMin: t });
  }, [envWeather, envStorm, envSky]); // eslint-disable-line react-hooks/exhaustive-deps
  // Free-play environment timeline: the storm forecast for this run (null once it has arrived, or in Sol 1).
  const [stormAt, setStormAt] = useState<number | null>(() => stormForecastAt(frame.state.clockMin));
  const stormAtRef = useRef(stormAt);
  useEffect(() => { stormAtRef.current = stormAt; }, [stormAt]);
  const [paused, setPaused] = useState(false);
  const [modeId, setModeId] = useState('cabin');
  const [flow, setFlow] = useState<ShelterFlow | null>(null);
  const [summary, setSummary] = useState<ShelterSummary | null>(null);
  const [mission, setMission] = useState<Sol1State | null>(null);
  /** Bumped on restart so the map starts again at the cabin with fresh fog. */
  const [mapReset, setMapReset] = useState(0);
  // Walking a planned route: the Map plans it, the HUD moves the astronaut along it in game time.
  const [route, setRoute] = useState<RouteResult | null>(null);
  const onRoute = useCallback((r: RouteResult | null) => setRoute(r), []);
  const [astronaut, setAstronaut] = useState<Pt | undefined>(undefined); // undefined = at the cabin
  const [walk, setWalk] = useState<{ plan: WalkPlan; startMin: number; stoppedAt: number | null } | null>(null);
  const [homePlan, setHomePlan] = useState<WalkPlan | null>(null); // the way back, once out at the destination
  const walkRef = useRef(walk);
  /** A route walk that is moving (not stopped). */
  const walkActive = () => !!walkRef.current && walkRef.current.stoppedAt === null;
  /** The route walker's position every frame, for the 3D view (#40: no 20 m jumps). */
  const walkPosRef = useRef<Pt | null>(null);
  const followWalk = useCallback(() => walkPosRef.current, []);
  const homeAfterRef = useRef<WalkPlan | null>(null);
  const postedRef = useRef<Pt | null>(null);
  const game = useRef(frame.state);
  const flowRef = useRef<ShelterFlow | null>(null);
  const missionRef = useRef<Sol1State | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { if (howToOpen) setPaused(true); }, [howToOpen]);

  /** One step of the game: the sim tick plus the shelter flow (arrival, then the summary once the storm is over). */
  // Switching views stops whatever the last view was doing (#40): no running on in the 2D HUD after leaving 3D.
  const stepMode = useRef(mode);
  const step = (dt: number, isPaused: boolean): TickResult => {
    if (stepMode.current !== modeRef.current) {
      stepMode.current = modeRef.current;
      moveRef.current = null;
      if (!walkActive()) game.current = { ...game.current, activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 } };
    }
    const m = missionRef.current;
    const holding = m !== null && (isHolding(m) || isOver(m));
    const r = tick(game.current, dt, isPaused || holding);
    let state = r.state;
    // The suit was torn in the crash: until it is patched, it leaks extra O₂ on top of breathing (free play only).
    if (!missionRef.current && suitLeaking(shipRef.current)) {
      const used = game.current.suit.o2Kg - state.suit.o2Kg;
      if (used > 0) state = { ...state, suit: { ...state.suit, o2Kg: Math.max(0, state.suit.o2Kg - used * SUIT_LEAK) } };
    }
    if (m && !holding) {
      const fcNow = forecast(state.suit, shelterEnvironment(r.env, state.shelter), state.activity);
      const next = sol1Advance(m, state.clockMin, state.suit, fcNow);
      state = { ...state, ...sol1Posture(next) };
      missionRef.current = next;
      setMission(next);
    }
    const f = flowRef.current;
    if (f) {
      const next = updateFlow(f, state.clockMin, state.suit);
      if (next.arrived && !f.arrived) state = { ...state, ...flowPosture(next) };
      if (state.storm && stormPhase(state.storm, state.clockMin) === 'over') {
        setSummary(summarize(next, state.clockMin, state.suit));
        flowRef.current = null;
      } else {
        flowRef.current = next;
      }
      setFlow(flowRef.current);
    }
    // The forecast storm arrives on schedule (free play only).
    const due = stormAtRef.current;
    if (due !== null && !missionRef.current && state.clockMin >= due) {
      if (!state.storm || stormPhase(state.storm, state.clockMin) === 'over') state = { ...state, storm: makeStorm(state.clockMin) };
      stormAtRef.current = null;
      setStormAt(null);
    }
    const mv = moveRef.current;
    // Dust storm in 3D: in the open, blowing grit, near-zero visibility and hidden footing make every step (and
    // standing) harder work, so more O₂ (a design value, not a wind-force model); under a rock overhang it doesn't, and
    // resting there counts as partial shelter (the sim's 'wreck' level).
    const stormy = modeRef.current === '3d' ? stormStrength(r.env.tau) : 0;
    if (modeRef.current === '3d' && mv && !walkActive() && !missionRef.current && !flowRef.current) {
      const inCabin = !mv.moving && inCabinZone(mv.pos, base);
      const covered = underCover(mv.pos, coversRef.current);
      state = {
        ...state,
        activity: inCabin ? activityFor(mv, carriedKg(bagRef.current)) : stormEffort(activityFor(mv, carriedKg(bagRef.current)), stormy, covered),
        shelter: inCabin ? 'cabin' : covered && !mv.moving && stormy > 0 ? 'wreck' : 'none',
      };
    }
    // A repaired ship refills the suit while the astronaut is at the lander.
    if (modeRef.current === '3d' && atShipRef.current && shipRef.current.repaired.length) {
      state = { ...state, suit: shipTopUp(shipRef.current, state.suit, FULL_SUIT) };
    }
    // Plugged into Perseverance: its nuclear power source (MMRTG, about 110 W) keeps the suit battery charged
    // while the astronaut waits for a pass (proposal §6.2; topping up to full is a game simplification).
    if (modeRef.current === '3d' && linkedRef.current && nearRoverRef.current) {
      state = { ...state, suit: { ...state.suit, batteryWh: Math.max(state.suit.batteryWh, FULL_SUIT.batteryWh) } };
    }
    if (runStartRef.current === null) runStartRef.current = state.clockMin;
    // The other ending: no O₂, or CO₂ past the unconsciousness line, for too long (free play; Sol 1 has its own end).
    if (!missionRef.current && !endRef.current && !isPaused) {
      const f = watchFailure(failRef.current, state.suit, state.clockMin);
      failRef.current = f.watch;
      if (f.failed) {
        endRef.current = true;
        setEndCard({ result: 'lost', atMin: state.clockMin, onMarsMin: state.clockMin - runStartRef.current, cause: f.failed, stats: snapStats(statsRef.current) });
        setPaused(true);
      }
    }
    const wk = walkRef.current;
    if (wk && wk.stoppedAt === null) {
      const w = walkAt(wk.plan, state.clockMin - wk.startMin);
      walkPosRef.current = w.at;
      state = { ...state, activity: stormEffort(w.activity, stormy, underCover(w.at, coversRef.current)), shelter: 'none' };
      // Move the map's astronaut every 20 m, not every frame (the map re-plans from the new spot each time).
      if (!postedRef.current || distM(postedRef.current, w.at) > 20 || w.done) {
        postedRef.current = w.at;
        setAstronaut(w.at);
      }
      if (w.done) {
        walkRef.current = null;
        walkPosRef.current = null;
        setWalk(null);
        if (wk.plan.toBase) {
          state = { ...state, shelter: 'cabin' };
          setAstronaut(undefined);
          postedRef.current = null;
          setHomePlan(null);
          setModeId('cabin');
        } else {
          setHomePlan(homeAfterRef.current);
        }
      }
    }
    // Field journal + take-home report: O₂ breathed, metres walked, and what this frame unlocks.
    if (!isPaused) {
      const prev = game.current;
      const st = statsRef.current;
      const dO2 = prev.suit.o2Kg - state.suit.o2Kg;
      if (dO2 > 0) st.o2UsedKg += dO2;
      const pos = (modeRef.current === '3d' ? moveRef.current?.pos : null) ?? walkPosRef.current ?? null;
      if (pos && st.lastPos) { const d = distM(st.lastPos, pos); if (d < 50) st.walkedM += d; }
      st.lastPos = pos ? { ...pos } : st.lastPos;
      if (pos) trailAdd(st.trail, pos);
      const phase = (g: typeof state) => (g.storm ? stormPhase(g.storm, g.clockMin) : null);
      const was = phase(prev), now = phase(state);
      unlockFindings({
        o2Refilled: state.suit.o2Kg > prev.suit.o2Kg + 1e-4,
        underCover: !!pos && modeRef.current === '3d' && underCover(pos, coversRef.current),
        stormOver: was !== null && was !== 'over' && (now === null || now === 'over'),
        tempC: r.env.tempC,
        pos,
        lakeAt: mapWorldRef.current?.items.find((i) => i.kind === 'science')?.at ?? null,
        salvaged: bagRef.current.salvaged,
      });
    }
    game.current = state;
    return { ...r, state };
  };
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; });

  // Game loop: advance the sim by real elapsed time every animation frame.
  useEffect(() => {
    let last = performance.now();
    let lastDraw = 0;
    let raf = requestAnimationFrame(function loop(now) {
      const dt = Math.min(0.25, (now - last) / 1000); // cap so a hidden tab doesn't jump hours
      last = now;
      const r = stepRef.current(dt, pausedRef.current || workRef.current);
      // In 3D the scene draws itself every frame; the HUD text only needs ~15 updates a second.
      if (modeRef.current !== '3d' || now - lastDraw > 66) { lastDraw = now; setFrame(r); }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove3d = useCallback((m: MoveResult) => {
    moveRef.current = m;
    if (m.moving && hintOnRef.current) { hintOnRef.current = false; setHintOn(false); }
    const target = pickupTarget(pickWorldRef.current, m.pos, bagRef.current);
    const where = aboard(m.pos, base) ? 'aboard' : atStorage(m.pos, base, shipRef.current) ? 'room' : null;
    setStoreAt((old) => (old === where ? old : where));
    if ((target?.id ?? null) !== (nearRef.current?.id ?? null)) { nearRef.current = target; setNear(target); }
    const sp = photoSiteNear(mapWorldRef.current?.items ?? [], m.pos, photosRef.current);
    setSitePhoto((old) => ((old?.item.id ?? null) === (sp?.item.id ?? null) ? old : sp));
    const here = inCabinZone(m.pos, base);
    atShipRef.current = here;
    const nc = nearestCover(m.pos, coversRef.current);
    setCover((old) => (old && nc && old.rock.id === nc.rock.id && Math.abs(old.distM - nc.distM) < 5 && (old.distM <= 7) === (nc.distM <= 7) ? old : nc));
    const rover = !!roverInReach(mapWorldRef.current, m.pos);
    if (rover !== nearRoverRef.current) { nearRoverRef.current = rover; setNearRover(rover); }
    if (walkActive()) return; // the route walker owns the position
    // After STOP on a route walk, walking with the keys takes over (#40) and the stopped walk is dropped.
    if (walkRef.current && m.moving) { walkRef.current = null; walkPosRef.current = null; homeAfterRef.current = null; setWalk(null); }
    const atCabin = inCabinZone(m.pos, base);
    if (atCabin ? postedRef.current !== null : !postedRef.current || distM(postedRef.current, m.pos) > 20) {
      postedRef.current = atCabin ? null : m.pos;
      setAstronaut(atCabin ? undefined : m.pos);
    }
  }, [base, setHintOn, setNear, setWalk, setNearRover, setCover, setStoreAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const stopWalking = (atCabin: boolean) => {
    walkRef.current = null; walkPosRef.current = null; setWalk(null); homeAfterRef.current = null;
    if (atCabin) { setAstronaut(undefined); postedRef.current = null; setHomePlan(null); setPlaceKey((k) => k + 1); }
  };
  const setMode = (id: string) => {
    const m = MODES.find((x) => x.id === id)!;
    // The test modes override walking; IN CABIN puts the astronaut back at the cabin.
    stopWalking(id === 'cabin');
    game.current = { ...game.current, activity: m.activity, shelter: m.shelter };
    setModeId(id);
  };
  const startWalk = (plan: WalkPlan, homeAfter: WalkPlan | null) => {
    homeAfterRef.current = homeAfter;
    setHomePlan(null);
    const w = { plan, startMin: game.current.clockMin, stoppedAt: null };
    walkRef.current = w; setWalk(w); setModeId('');
  };
  const walkRoute = () => {
    const plan = route && planFromRoute(route);
    if (plan && route) startWalk(plan, planHome(route.home));
  };
  const toggleStop = () => {
    const w = walkRef.current;
    if (!w) return;
    const now = game.current.clockMin;
    // Stop: stand still outside. Resume: carry on from the same point along the route.
    const next = w.stoppedAt === null
      ? { ...w, stoppedAt: now }
      : { ...w, startMin: w.startMin + (now - w.stoppedAt), stoppedAt: null };
    if (next.stoppedAt !== null) game.current = { ...game.current, activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'none' };
    walkRef.current = next; setWalk(next);
  };
  const clearFlow = () => { flowRef.current = null; setFlow(null); setSummary(null); };
  const triggerStorm = () => {
    clearFlow(); stormAtRef.current = null; setStormAt(null);
    game.current = { ...game.current, storm: makeStorm(game.current.clockMin) };
  };
  const setMissionState = (m: Sol1State | null) => { missionRef.current = m; setMission(m); };
  const restart = (i = solIndex) => {
    clearFlow(); setMissionState(null); stopWalking(true); game.current = startGame(i); setSolIndex(i); setMode('cabin');
    setMapReset((n) => n + 1);
    setBag(EMPTY_PACK); setShip(EMPTY_SHIP); nearRef.current = null; setNear(null); setReadPage(null);
    setFound([]); statsRef.current = freshStats();
    setLinked(false); setCalled(false); setEndCard(null); endRef.current = false; failRef.current = null; setO2Hidden(null); setCredits(null);
    runStartRef.current = game.current.clockMin; setPaused(false);
    const forecast = stormForecastAt(game.current.clockMin);
    stormAtRef.current = forecast; setStormAt(forecast);
  };

  // Sol 1: Scrubber Saturation runs on the pack's Sol 1 scenario day, with the crash-damaged scrubber.
  const sol1Index = Math.max(0, pack.sols.findIndex((x) => x.scenario?.startsWith('Sol 1')));
  const startSol1 = () => {
    restart(sol1Index);
    game.current = { ...game.current, suit: { ...game.current.suit, liohKg: SOL1_START_LIOH_KG } };
    setMissionState(sol1Start(game.current.clockMin));
    setModeId('');
    stormAtRef.current = null; setStormAt(null); // Sol 1 is about the scrubber; no storm
  };
  const missionBegin = () => {
    const m = sol1Begin(missionRef.current!, game.current.clockMin);
    game.current = { ...game.current, ...sol1Posture(m) };
    setMissionState(m);
  };
  const missionDiagnose = (c: CauseId) => setMissionState(sol1Diagnose(missionRef.current!, c));
  const missionAct = (a: ActionId) => {
    const r = sol1Act(missionRef.current!, a);
    const suit = game.current.suit;
    game.current = { ...game.current, ...sol1Posture(r.state), suit: { ...suit, liohKg: suit.liohKg + r.addLiohKg } };
    setMissionState({ ...r.state, lastClockMin: game.current.clockMin });
  };
  const pick = (c: ShelterChoice) => {
    stopWalking(false);
    const f = chooseShelter(c, game.current.clockMin, game.current.suit);
    flowRef.current = f;
    setFlow(f);
    game.current = { ...game.current, ...flowPosture(f) };
    setModeId('');
  };
  // Test-only: jump one game hour ahead in 1-second ticks (tick() must not take big jumps).
  const passMinutes = (min: number) => {
    const target = game.current.clockMin + min;
    let r = frame;
    for (let i = 0; i < min * 70 && game.current.clockMin < target; i++) r = step(1, false);
    setFrame(r);
  };
  const skipHour = () => passMinutes(60);

  // Pickups: take what is in reach; use a supply on the suit; put something down; read a manual page.
  const pickUpNear = () => {
    const it = nearRef.current;
    if (!it) return;
    const r = pickUp(bagRef.current, it, data.content);
    if (!r.ok) { setToast(`Backpack full (${BACKPACK_MAX_KG} kg). Drop something, or store it at the ship.`); return; }
    setBag(r.pack);
    nearRef.current = null; setNear(null);
    const e = r.entry;
    setToast(e.blueprint ? `Found the ${e.name.toLowerCase()}. Build it beside the lander: PACK → REPAIRS.`
      : e.kind === 'page' ? `Picked up ${e.name}. Press I to read it.`
      : e.id === CACHE_SITE ? `Secured the ${e.name.toLowerCase()} · ${e.massKg.toFixed(1)} kg · Perseverance's samples, going home with you`
      : e.kind === 'part' ? `Salvaged ${e.name} · ${e.massKg.toFixed(1)} kg · a NASA part for ship repairs`
      : `Picked up ${e.name} · ${e.massKg.toFixed(1)} kg${e.gives && usable(e) ? ` · ${givesLabel(e.gives)} when used` : ''}`);
  };
  /** Use a supply from the backpack or the ship's storage on the suit. */
  const applyFrom = (where: 'pack' | 'ship', id: string) => {
    const list = where === 'pack' ? bagRef.current.entries : shipRef.current.stored;
    const e = list.find((x) => x.id === id);
    const r = applySupply(list, id, game.current.suit, FULL_SUIT);
    if (!e || !r) return;
    const got = givesLabel(r.added);
    if (!got) { setToast(`The suit is already full. Kept the ${e.name.toLowerCase()} for later.`); return; }
    game.current = { ...game.current, suit: r.suit };
    if (where === 'pack') setBag({ ...bagRef.current, entries: r.entries });
    else setShip({ ...shipRef.current, stored: r.entries });
    const rest = r.entries.find((x) => x.id === id);
    setToast(`Used ${e.name}: ${got}${rest ? ` · ${givesLabel(rest.gives).replace(/\+/g, '')} left` : ''}`);
    if ((r.added.o2Kg ?? 0) > 0) unlockFindings({ o2Refilled: true });
  };
  const dropFromBag = (id: string) => {
    const e = bagRef.current.entries.find((x) => x.id === id);
    setBag(drop(bagRef.current, id, moveRef.current?.pos ?? astronaut ?? base));
    if (e) setToast(`Put ${e.name} down here. Walk up to it and press F to take it again.`);
  };
  const lockerFull = `The lander's locker is full (${SHIP_LOCKER_KG} kg). Find the storage-room blueprint and build the storage room, or use things up.`;
  const storeInShip = (id?: string) => {
    const r = id ? store(bagRef.current, shipRef.current, id) : storeAll(bagRef.current, shipRef.current);
    const left = r.pack.entries.length;
    setBag(r.pack); setShip(r.ship);
    if (id) setToast(r.pack === bagRef.current ? lockerFull : 'Stored in the ship.');
    else setToast(left ? `Stored what fits. ${lockerFull}` : 'Everything is stored in the ship. Rocket pieces were broken down into materials.');
  };
  const takeFromShip = (id: string) => {
    const r = take(bagRef.current, shipRef.current, id);
    if (!r) { setToast(`That won't fit: the backpack holds ${BACKPACK_MAX_KG} kg.`); return; }
    setBag(r.pack); setShip(r.ship);
  };
  // The ending: build the comms link, plug it into Perseverance, wait for an orbiter, send the call.
  const commsJob = useMemo(() => commsLinkJob(data.content), [data.content]);
  const baseLook = useMemo<BaseLook>(() => ({
    stored: ship.stored.length,
    materialsKg: Object.values(ship.materials).reduce((a, b) => a + b, 0),
    repaired: ship.repaired, built: ship.built, room: hasStorageRoom(ship),
  }), [ship]);
  const WORK_MS = 4200;
  /** Play the work animation, then do the job (the clock holds while it plays, then jumps by the job's minutes). */
  const startWork = (label: string, minutes: number, finish: () => void) => {
    if (workRef.current) return;
    workRef.current = true;
    setPackOpen(false);
    setWork({ label, minutes });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      finish();
      workRef.current = false;
      setWork(null);
    }, WORK_MS);
  };
  /** The workbench jobs, made from AER-1's scattered parts: patch the suit, the storage room, the rover radio kit. */
  const jobs = [SUIT_PATCH_JOB, STORAGE_ROOM_JOB, commsJob];
  const buildJob = (job: Repair) => {
    if (!canBuild(job, bagRef.current, shipRef.current)) return;
    startWork(`${job.id === SUIT_PATCH_ID ? 'PATCHING' : 'BUILDING'} · ${job.name.toUpperCase()}`, job.minutes, () => buildJobNow(job));
  };
  const buildJobNow = (job: Repair) => {
    const kit = job.id === COMMS_LINK_ID;
    const r = doBuild(job, bagRef.current, shipRef.current, kit ? commsLinkEntry(job.name) : undefined);
    if (!r) return;
    setBag(r.pack); setShip(r.ship);
    passMinutes(job.minutes);
    if (!kit) setToast(`${job.name}: done after ${job.minutes} min. ${job.does}`);
    else setToast(r.inPack
      ? `Built the ${job.name.toLowerCase()} after ${job.minutes} min. Take it to Perseverance, about 2 km west.`
      : `Built the ${job.name.toLowerCase()}. It is in the ship's storage: TAKE it once the backpack has room.`);
  };
  /** The next orbiter pass (without relay data, any time counts as a pass). */
  const passNow = (clockMin: number) => nextRelayPass(clockMin, data.relay) ?? (data.relay ? null : { orbiter: 'an orbiter', centre: '', inMin: 0 });
  const orbiterName = (id?: string) => data.relay?.orbiters.find((o) => o.id === id)?.name ?? id ?? 'an orbiter';
  const roverAction = () => {
    if (called) return;
    const pass = passNow(game.current.clockMin);
    const stage = callStage(linkedRef.current, hasCommsLink(bagRef.current), pass);
    if (stage === 'connect') {
      setBag(installLink(bagRef.current)); setLinked(true);
      passMinutes(5);
      setToast("Perseverance's radio link is repaired. Now wait for an orbiter to pass overhead.");
    } else if (stage === 'wait' && pass) {
      passMinutes(Math.ceil(pass.inMin) + 1);
    } else if (stage === 'send' && pass) {
      endRef.current = true;
      setCalled(true);
      setEndCard({ result: 'won', atMin: game.current.clockMin, onMarsMin: game.current.clockMin - (runStartRef.current ?? game.current.clockMin), orbiter: pass.orbiter, stats: snapStats(statsRef.current) });
      setPaused(true);
    }
  };
  const closeEnd = () => { setEndCard(null); setPaused(false); };
  // The ending: the credits roll by themselves a little while after "EARTH HEARD YOU" (or at once with CREDITS).
  const won = endCard?.result === 'won';
  useEffect(() => {
    if (!won) return;
    const t = setTimeout(() => setCredits((c) => c ?? 'won'), 12000);
    return () => clearTimeout(t);
  }, [won]);
  const closeCredits = () => { if (credits === 'menu') setPaused(false); setCredits(null); };
  const creditsNode = credits && <Credits won={credits === 'won'} onClose={closeCredits} />;

  const repairShip = (rp: Repair) => {
    if (!canRepair(rp, bagRef.current, shipRef.current)) return;
    startWork(`REPAIRING · ${rp.name.toUpperCase()}`, rp.minutes, () => repairNow(rp));
  };
  const repairNow = (rp: Repair) => {
    const r = doRepair(rp, bagRef.current, shipRef.current);
    if (!r) return;
    setBag(r.pack); setShip(r.ship);
    passMinutes(rp.minutes); // the work takes time, in the cabin
    setToast(`${rp.name}: done after ${rp.minutes} min. ${rp.does}`);
  };
  const openPage = (n: number | undefined) => { if (n === undefined) return; setPackOpen(false); setReadPage(n); setPaused(true); };
  const closePage = () => { setReadPage(null); setPaused(false); };

  // Keyboard controls (listed in Settings). The ref always holds this render's handlers.
  const onKey = (e: KeyboardEvent) => {
    if (credits) return; // the credits scene has the keyboard
    const t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey || (t instanceof Element && t.closest('input, select, textarea'))) return;
    // Space on a focused button presses that button, as browsers do; don't also pause.
    if (e.key === ' ' && t instanceof Element && t.closest('button')) return;
    if (modeRef.current === '3d') {
      const k = e.key.toLowerCase();
      if (workRef.current && (k === 'f' || k === 'i')) return;
      if (k === 'f') { if (nearRef.current) pickUpNear(); else if (nearRoverRef.current) roverAction(); return; }
      if (k === 'i') { setPackOpen((o) => !o); setMenuOpen(false); return; }
      if (k === 'j') { setJournalOpen((o) => !o); return; }
      if (k === 'escape' && readPage !== null) { closePage(); return; }
    }
    const action = hudKeyAction(e.key);
    if (!action) return;
    if (modeRef.current === '3d' && action !== 'pause') return;
    if (action === 'pause') { e.preventDefault(); setPaused((p) => !p); return; }
    const busy = missionRef.current !== null;
    if (action.startsWith('mode:') && !busy) setMode(action.slice(5));
    else if (action === 'sol1') startSol1();
    else if (action === 'storm' && !busy && !(game.current.storm && stormPhase(game.current.storm, game.current.clockMin) !== 'over')) triggerStorm();
    else if (action === 'skip') skipHour();
    else if (action === 'restart') restart();
  };
  const keyRef = useRef(onKey);
  useEffect(() => { keyRef.current = onKey; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const s = frame.state;
  // From the sim, so it counts the suit charging in the cabin; the crash leak (applied in step) shortens the O₂ time.
  const leaking = !mission && suitLeaking(ship);
  const fc = leaking ? { ...frame.forecast, o2Min: frame.forecast.o2Min / (1 + SUIT_LEAK) } : frame.forecast;
  const hero = firstToRunOut(fc);
  const clock = clockLabel(s.clockMin);
  const critical = frame.warnings.some((w) => w.level === 'critical');

  const phase = s.storm ? stormPhase(s.storm, s.clockMin) : 'none';
  const stormRealSec = s.storm ? Math.ceil((stormCountdownMin(s.storm, s.clockMin) / SPEED_X.storm) * 60) : 0;
  const stormActive = phase === 'warning' || phase === 'building' || phase === 'peak' || phase === 'clearing';
  const showChoices = stormActive && !flow && s.shelter !== 'cabin' && coverFor !== s.storm && (phase === 'warning' || phase === 'building');
  const stormy = mode === '3d' ? stormStrength(frame.env.tau) : 0;
  // Under an overhang while a storm is on (the cover list is updated as the astronaut walks).
  const underRock = mode === '3d' && !flow && stormActive && s.shelter !== 'cabin' && !!cover && cover.distM <= COVER_RADIUS_M;
  const coverDir = cover ? `${Math.round(cover.distM)} m ${compassPoint(cover.bearingDeg)}` : '';
  /** How much more O₂ a walk costs in the open right now (×), for the warning line. */
  const stormCost = stormy > 0 ? metabolicW(stormEffort({ speedMS: 0.8, slopeDeg: 0, loadKg: 10 }, stormy, false)) / metabolicW({ speedMS: 0.8, slopeDeg: 0, loadKg: 10 }) : 1;
  const mapPortal = createPortal(
    <HudMap
      pack={pack} suit={s.suit} env={frame.env} storm={stormActive} sol={s.weather.sol}
      night={sunElevationDeg(s.clockMin, s.sky) < 0} resetKey={mapReset}
      astronaut={astronaut} onRoute={onRoute} onWorld={setMapWorld} envAt={envAt}
    />,
    mapHost,
  );

  const menuAction = (id: string) => {
    if (id === 'pause') setPaused((p) => !p);
    else if (id === 'sol1') startSol1();
    else if (id === 'storm') triggerStorm();
    else if (id === 'skip') skipHour();
    else if (id === 'restart') restart();
    else if (id === 'credits') { setPaused(true); setCredits('menu'); }
    else if (id === 'howto') { setHowToOpen(true); hintOnRef.current = true; setHintOn(true); }
    else if ((id === 'hud' || id === 'telemetry') && onView) onView(id);
  };
  const missionCard = mission !== null && (isHolding(mission) || isOver(mission));
  const sol1Panel = mission && (
    <Sol1Panel
      mission={mission} suit={s.suit} fc={fc} metabolicW={metabolicW(s.activity)} clockMin={s.clockMin}
      onBegin={missionBegin} onDiagnose={missionDiagnose} onAct={missionAct}
      onRetry={startSol1} onClose={() => setMissionState(null)}
    />
  );
  // The route replay at the top of the end card: the camera rises off the astronaut over the HiRISE map while the
  // route walked draws itself; NASA sites salvaged, findings and Perseverance appear as markers (Map: RouteReplay).
  const endReplay = endCard && pack.imageUrl && (() => {
    const st = endCard.stats ?? freshStats();
    const items = mapWorld?.items ?? [];
    const rover = items.find((i) => i.kind === 'rover');
    const marks: ReplayMark[] = [
      { at: base, label: 'AER-1 CRASH SITE', tone: 'start' },
      ...bag.salvaged.map((id) => items.find((i) => i.id === id)).filter((i): i is MapItem => !!i).map((i) => ({ at: i.at, label: i.label.toUpperCase(), tone: 'site' as const })),
      ...(Object.entries(st.foundAt) as [FindingId, Pt][]).map(([id, at]) => ({ at, label: findingById(id).title, tone: 'finding' as const })),
      ...(rover && (mapWorld?.found.has(rover.id) || endCard.result === 'won') ? [{ at: rover.at, label: 'PERSEVERANCE', tone: 'goal' as const }] : []),
    ];
    const t = takeHome(st, found, bag.salvaged);
    return (
      <RouteReplay
        imageUrl={pack.imageUrl} area={pack.area} trail={st.trail} walkedM={st.walkedM} end={st.trail[st.trail.length - 1] ?? base} marks={marks}
        credit="Your route on HiRISE orbital imagery of Jezero crater (USGS Mars 2020 TRN mosaic, archived)"
        guide={endCard.result === 'won' ? {
          title: `${t.walkedM >= 1000 ? `${(t.walkedM / 1000).toFixed(2)} km` : `${t.walkedM} m`} walked · rescued on day ${clockLabel(endCard.atMin).sol}`,
          rows: [
            ['Time on Mars', formatMinutes(endCard.onMarsMin)],
            ['Suit O₂ breathed', `${(t.o2UsedKg * 1000).toFixed(0)} g`],
            ['NASA sites salvaged', String(t.sites)],
            ['Sample tubes', t.tubes ? `${t.tubes} from Three Forks` : 'none'],
            ['Findings', `${t.findings}/${t.of}`],
          ],
          findings: found.map((id) => findingById(id).title),
          note: 'The survival guide the next crew takes back to Mars.',
        } : undefined}
      />
    );
  })();
  const endNode = endCard && (
    <section className={endCard.result === 'won' ? 'end-card won' : 'end-card lost'} aria-label={endCard.result === 'won' ? 'Mission complete' : 'Suit failure'}>
      <p className="end-kicker">{endCard.result === 'won' ? 'MISSION COMPLETE' : 'MISSION OVER'} · DAY {clockLabel(endCard.atMin).sol} · {clockLabel(endCard.atMin).time} LTST</p>
      <h2>{endCard.result === 'won' ? 'EARTH HEARD YOU' : 'SUIT FAILURE'}</h2>
      {endReplay}
      {endCard.result === 'won' ? (
        <p>
          Your distress call went from Perseverance's UHF radio to {orbiterName(endCard.orbiter)} passing overhead, which relays it
          to NASA's Deep Space Network on Earth. Radio takes {LIGHT_TIME_MIN[0]} to {LIGHT_TIME_MIN[1]} minutes to cross between Mars and
          Earth, depending on where the planets are, so the reply comes on a later pass. Help is on its way (game fiction; the radio
          path is how Perseverance really talks to Earth).
        </p>
      ) : (
        <p>
          {endCard.cause === 'o2'
            ? 'Your oxygen ran out.'
            : 'CO₂ built up in your suit faster than the scrubber could remove it: on Mars, the danger is your own breath.'}
          {' '}Next time, watch the countdown top left, carry spare O₂ and LiOH, and turn back by the map's TURN BACK BY time.
        </p>
      )}
      {endCard.result === 'won' && <EarthReply orbiter={orbiterName(endCard.orbiter)} />}
      <dl>
        <dt>Time on Mars</dt><dd>{formatMinutes(endCard.onMarsMin)}</dd>
        <dt>Ship repairs</dt><dd>{ship.repaired.length}/{REPAIRS.length}</dd>
        <dt>Items found</dt><dd>{bag.taken.length + bag.salvaged.length}</dd>
        <dt>O₂ left</dt><dd>{Math.round((s.suit.o2Kg / FULL_SUIT.o2Kg) * 100)}%</dd>
      </dl>
      {endCard.result === 'won' && (() => {
        const t = takeHome(endCard.stats ?? { walkedM: 0, o2UsedKg: 0 }, found, bag.salvaged);
        return (
          <div className="end-takehome">
            <h3>TAKE-HOME REPORT · FOR THE NEXT MISSION</h3>
            <p>Earth diverts a cargo lander already on its way to Mars to pick you up (game fiction). You fly home with:</p>
            <dl>
              <dt>Distance walked</dt><dd>{t.walkedM >= 1000 ? `${(t.walkedM / 1000).toFixed(2)} km` : `${t.walkedM} m`}</dd>
              <dt>Suit O₂ breathed</dt><dd>{(t.o2UsedKg * 1000).toFixed(0)} g</dd>
              <dt>NASA sites salvaged</dt><dd>{t.sites}</dd>
              <dt>Sample tubes</dt><dd>{t.tubes ? `${t.tubes} from Three Forks` : 'none (left at Three Forks)'}</dd>
              <dt>Findings</dt><dd>{t.findings}/{t.of}</dd>
            </dl>
            {found.length > 0 && <ul>{found.map((id) => <li key={id}>{findingById(id).title}</li>)}</ul>}
            <p className="end-takehome-note">This is the survival guide the next crew takes back to Mars.</p>
          </div>
        );
      })()}
      <div className="end-actions">
        <button className="choice-btn" onClick={() => restart()} autoFocus>{endCard.result === 'won' ? 'PLAY AGAIN' : 'TRY AGAIN'}</button>
        {endCard.result === 'won' && <button className="choice-btn" onClick={() => setCredits('won')}>CREDITS</button>}
        {endCard.result === 'won' && <button className="choice-btn" onClick={closeEnd}>KEEP EXPLORING</button>}
      </div>
    </section>
  );
  const overlay = endNode ? endNode : missionCard ? sol1Panel : summary ? (
    <section className="storm-summary" aria-label="Storm outcome">
      <h2>STORM OVER</h2>
      <p>{summary.label} · {summary.hours.toFixed(1)} h</p>
      <dl>
        <dt>O₂ used</dt><dd>{summary.o2UsedG.toFixed(0)} g</dd>
        <dt>Water used</dt><dd>{summary.waterUsedKg.toFixed(2)} kg</dd>
        <dt>Battery used</dt><dd>{summary.batteryUsedWh.toFixed(0)} Wh</dd>
        <dt>Core temp</dt><dd>{summary.minCoreTempC.toFixed(1)}–{summary.maxCoreTempC.toFixed(1)} °C</dd>
      </dl>
      <button className="choice-btn" onClick={() => setSummary(null)}>CONTINUE</button>
    </section>
  ) : showChoices ? (
    <div className="shelter-pick">
    <h2 className="shelter-title warning">
      ▲ DUST STORM {phase === 'warning' ? `IN ${Math.floor(stormRealSec / 60)}:${String(stormRealSec % 60).padStart(2, '0')}` : 'IS HERE'} · WHERE WILL YOU WAIT IT OUT?
    </h2>
    <div className="shelter-choices" role="group" aria-label="Where to wait out the storm">
      {SHELTER_CHOICES.map((c) => (
        <button key={c.id} className="shelter-card" onClick={() => pick(c)}>
          <strong>{c.label}</strong>
          <span>+ {c.benefit}</span>
          <span className="dim">− {c.cost}</span>
          <span className="dim">{c.travelMin ? `${formatMinutes(c.travelMin)} to cover` : 'No cover'}</span>
        </button>
      ))}
      {mode === '3d' && cover && s.storm && (
        <button className="shelter-card" onClick={() => { stopWalking(false); setCoverFor(s.storm); }}>
          <strong>TAKE COVER UNDER A ROCK</strong>
          <span>+ Out of the blowing dust: O₂ use back to normal</span>
          <span className="dim">− Walk there yourself: follow the orange beacons</span>
          <span className="dim">Nearest overhang {coverDir}</span>
        </button>
      )}
    </div>
    </div>
  ) : null;

  const walkBusy = mission !== null || flow !== null;
  const walkLeft = walk ? walk.plan.minutes - ((walk.stoppedAt ?? s.clockMin) - walk.startMin) : 0;
  const walkLine = walk ? (
    <p className="walk-line">
      {walk.stoppedAt === null
        ? <>{walk.plan.toBase ? 'WALKING HOME' : 'WALKING THE ROUTE'} · {formatMinutes(walkLeft)} LEFT </>
        : <>STOPPED · {formatMinutes(walkLeft)} TO GO </>}
      <button className="choice-btn" onClick={toggleStop}>{walk.stoppedAt === null ? 'STOP' : 'RESUME'}</button>
    </p>
  ) : homePlan && !walkBusy ? (
    <p className="walk-line">
      AT DESTINATION <button className="choice-btn" onClick={() => startWalk(homePlan, null)}>
        RETURN TO CABIN · {formatMinutes(homePlan.minutes)}
      </button>
    </p>
  ) : route && !walkBusy && !astronaut ? (
    <p className="walk-line">
      <button className="choice-btn walk-go" onClick={walkRoute} disabled={route.status === 'critical'}>
        ▶ WALK ROUTE · {(route.distM / 1000).toFixed(2)} km · {formatMinutes(route.minutes)}
      </button>
      {route.turnBackByMin !== null
        ? <span className="dim"> TURN BACK BY {formatMinutes(route.turnBackByMin)}</span>
        : <span className="critical"> NO SAFE RETURN</span>}
    </p>
  ) : null;

  const gauge = (key: Consumable, value: number, full: number, unit: string, digits = 0) => {
    const pct = Math.max(0, Math.min(100, (value / full) * 100));
    const low = fc[key] < 30;
    return (
      <div className={low ? 'gauge warning' : 'gauge'}>
        <span className="gauge-name">{CONSUMABLE_LABEL[key]}</span>
        <span className="gauge-val">{value.toFixed(digits)} {unit}</span>
        <span className="gauge-bar" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
          aria-label={`${CONSUMABLE_LABEL[key]} remaining`}>
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="gauge-out">OUT IN {formatMinutes(fc[key])}</span>
      </div>
    );
  };

  if (mode === '3d') {
    const holding = paused || work !== null || endCard !== null || (mission !== null && (isHolding(mission) || isOver(mission)));
    const sun = sunPosition(s.clockMin, s.sky);
    // Low-oxygen alert: pops up under 30 min left (critical under 10 or when empty). Closing it hides it for 20 game
    // minutes, unless it gets worse.
    const o2Level: 'low' | 'critical' | null = s.suit.o2Kg <= 0 || fc.o2Min < 10 ? 'critical' : fc.o2Min < 30 ? 'low' : null;
    const o2Shown = !!o2Level && !endCard && !(o2Hidden && o2Hidden.untilMin > s.clockMin && (o2Hidden.level === 'critical' || o2Level === 'low'));
    const o2Bottle = bag.entries.find((e) => !!e.gives?.o2Kg && usable(e));
    const atLander = s.shelter === 'cabin';
    const o2Advice = o2Bottle ? 'Use the O₂ bottle in your pack now.'
      : ship.stored.some((e) => !!e.gives?.o2Kg) ? 'There is an O₂ bottle in the ship: go aboard, TAKE it or USE it.'
      : ship.repaired.includes('life') ? (atLander ? 'Stay at the lander: life support is refilling your suit.' : 'Head back to the lander: life support refills your suit.')
      : 'Find an O₂ bottle, or restart the ship\'s life support (PACK → REPAIRS) so it refills your suit.';
    const timeScale = holding ? 0 : SPEED_X[frame.speed];
    // A slim bar along the visor edge: see-through track, soft glow, minutes left.
    const vbar = (key: Consumable, label: string, value: number, full: number) => {
      const pct = Math.max(0, Math.min(100, (value / full) * 100));
      return (
        <div className={fc[key] < 30 ? 'vbar warning' : 'vbar'} key={key} title={`${CONSUMABLE_LABEL[key]} ${pct.toFixed(0)}%`}>
          <span className="vbar-label">{label}</span>
          <span className="vbar-track" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
            aria-label={`${CONSUMABLE_LABEL[key]} remaining`}><span style={{ width: `${pct}%` }} /></span>
          <span className="vbar-time">{formatMinutes(fc[key])}</span>
        </div>
      );
    };
    // The mission under the minimap: why, the steps ticked off from what the map has found, and the next relay pass.
    const steps = missionSteps(mapWorld, astronaut ?? base, nextRelayPass(s.clockMin, data.relay), formatMinutes, bag.taken, { done: ship.repaired.length, of: REPAIRS.length },
      { linkBuilt: ship.built.includes(COMMS_LINK_ID) || linked, called, suitPatched: !suitLeaking(ship) });
    const nextStep = steps.findIndex((x) => !x.done);
    const next = steps[nextStep];
    // The quest guide: the current step as one next action, where to go, and why (and a beacon in 3D).
    const questItems = [...pickWorld.items.filter((i) => isPickable(i, bag.salvaged) && !bag.taken.includes(i.id)), ...droppedItems(bag)];
    const quest = currentQuest({
      steps, items: questItems, pack: bag, ship, content: data.content, base, me: astronaut ?? base, suitJob: SUIT_PATCH_JOB, linkJob: commsJob,
      rover: roverItem, linked, pass: nextRelayPass(s.clockMin, data.relay), fmtMin: formatMinutes, found, allItems: mapWorld?.items ?? [],
    });
    const questWay = quest.target ? bearing(astronaut ?? base, quest.target.at) : null;
    const questWayLabel = quest.target && questWay
      ? `${quest.target.label} · ${questWay.m < 8 ? 'here' : `${questWay.m >= 1000 ? `${(questWay.m / 1000).toFixed(1)} km` : `${Math.round(questWay.m / 5) * 5} m`} ${questWay.dir}`}`
      : null;
    const goalPanel = (
      <section className={goalOpen ? 'v-mission open' : 'v-mission'} aria-label="Mission">
        <button className="v-mission-head" aria-expanded={goalOpen} onClick={() => setGoalOpen((o) => !o)}
          title={goalOpen ? 'Hide the steps' : 'Show every step'}>
          <span>MISSION {steps.filter((x) => x.done).length}/{steps.length}</span><span className="v-mission-more">{goalOpen ? 'LESS ▴' : 'ALL STEPS ▾'}</span>
        </button>
        {!goalOpen && (
          <p className="v-mission-next">
            <span className="v-check" aria-hidden="true">▸</span>
            <span>{next ? next.label : 'Mission complete'}{next?.detail && <em>{next.detail}</em>}</span>
          </p>
        )}
        <div className="v-quest" aria-label="What to do now">
          <p className="v-quest-task"><span className="v-quest-tag">NOW</span>{quest.task}</p>
          {questWayLabel && <p className="v-quest-way">◆ {questWayLabel}</p>}
        </div>
        {goalOpen && (
          <>
            <p className="v-mission-why">Your lander's radio died in the crash. Perseverance's radio can still reach Earth through the orbiters.</p>
            <p className="v-mission-why"><b>{quest.title}.</b> {quest.why}</p>
            {quest.needs.length > 0 && (
              <ul className="v-quest-needs">
                {quest.needs.map((n) => <li key={n.label} className={n.done ? 'done' : undefined}>{n.done ? '✓' : '○'} {n.label}</li>)}
              </ul>
            )}
            <ol className="v-mission-steps">
              {steps.map((st, i) => (
                <li key={st.id} className={st.done ? 'done' : i === nextStep ? 'next' : undefined}>
                  <span className="v-check" aria-hidden="true">{st.done ? '✓' : i === nextStep ? '▸' : '○'}</span>
                  <span>{st.label}{st.detail && <em>{st.detail}</em>}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    );
    return (
      <>
      {mapPortal}
      <div className="game3d">
        <Suspense fallback={<p className="v-loading">LOADING 3D VIEW…</p>}>
        <World3D
          pack={pack} base={base} timeScale={timeScale} follow={walk && walk.stoppedAt === null ? followWalk : undefined} placeKey={placeKey}
          startPos={astronaut} moveLocked={mission !== null || flow !== null || work !== null}
          sunDir={sun.dir} baseLook={baseLook} working={work !== null}
          rover={roverItem ? { at: roverItem.at, visible: roverSeen, linked, called } : null}
          tau={frame.env.tau} sunElevationDeg={sunElevationDeg(s.clockMin, s.sky)} onMove={onMove3d}
          onLookChange={setLookLocked} view={view} dustDevils={stormActive ? 0 : dustDevilsInView(s.clockMin, data.devils)}
          map={world3d} questTarget={quest.target}
        />
        </Suspense>
        <div className={critical ? 'visor-frame critical' : 'visor-frame'} aria-hidden="true" />

        {/* Top left: time, conditions, oxygen and the first thing to run out. */}
        <header className="v-top">
          <div className="v-clockrow">
            <SunDial sun={sun} tau={frame.env.tau} />
            <div className="v-clock">
              <span className="v-time">{clock.time}</span>
              <span className="v-sub">LTST · DAY {clock.sol} · MEDA SOL {s.weather.sol}</span>
              <span className={frame.speed === 'emergency' ? 'v-sub critical' : frame.speed === 'storm' ? 'v-sub warning' : 'v-sub'}>
                {SPEED_LABEL[frame.speed]} · {frame.env.tempC.toFixed(0)} °C · τ {frame.env.tau.toFixed(2)}
              </span>
            </div>
          </div>
          <ul className="v-forecast" aria-label="Environment forecast">
            {upcomingEvents(s.clockMin, stormActive ? null : stormAt, s.sky, data.devils).filter((e, i) => i === 0 || e.hazard).map((e) => (
              <li key={e.id} className={e.hazard ? 'warning' : undefined}>
                <span>{e.label}</span><b>{e.inMin === 0 ? 'NOW' : formatMinutes(e.inMin)}</b>
              </li>
            ))}
          </ul>
          <div className="v-o2">
            {vbar('o2Min', 'O₂', s.suit.o2Kg, FULL_SUIT.o2Kg)}
            {hero && hero.key !== 'o2Min' && hero.min < 180 && (
              <span className={hero.min < 30 ? 'v-hero warning' : 'v-hero'}>
                {CONSUMABLE_LABEL[hero.key]} OUT IN <b>{formatMinutes(hero.min)}</b>
              </span>
            )}
          </div>
        </header>

        {/* Top centre: what is happening right now. */}
        <div className="v-status">
          {phase === 'warning' && (
            <p className="warning">DUST STORM APPROACHING {Math.floor(stormRealSec / 60)}:{String(stormRealSec % 60).padStart(2, '0')}</p>
          )}
          {stormActive && phase !== 'warning' && <p className="warning">DUST STORM: {phase.toUpperCase()}</p>}
          {underRock && <p>SHELTERED UNDER A ROCK OVERHANG · OUT OF THE BLOWING DUST</p>}
          {stormActive && !flow && !underRock && s.shelter !== 'cabin' && cover && (
            <p className="warning">
              {stormy > 0.05 ? `▲ IN THE OPEN: THE STORM RAISES O₂ USE ×${stormCost.toFixed(1)} · ` : ''}TAKE COVER: ROCK OVERHANG {coverDir} (ORANGE BEACON)
            </p>
          )}
          {flow && !flow.arrived && (
            <p className="warning">EN ROUTE: {SHELTER_NAME[flow.choice.shelter]} · {formatMinutes(flow.choice.travelMin - (s.clockMin - flow.chosenAtMin))} TO COVER</p>
          )}
          {flow?.arrived && <p>{flow.choice.id === 'search' ? 'SEARCHING IN THE STORM' : `SHELTERED: ${SHELTER_NAME[s.shelter]}`}</p>}
          {mission && !missionCard && <div className="v-pill">{sol1Panel}</div>}
          {walkLine && <div className="v-pill">{walkLine}</div>}
          {o2Shown && o2Level && (
            <div className={`v-alert ${o2Level}`} role="alert">
              <p className="v-alert-title">⚠ OXYGEN {o2Level === 'critical' ? 'CRITICAL' : 'LOW'}</p>
              <p>
                {s.suit.o2Kg <= 0 ? 'Your suit is out of O₂.' : <><b>{formatMinutes(fc.o2Min)}</b> of O₂ left at this pace.</>} {o2Advice}
                {leaking ? ' The suit leak makes it worse.' : ''}
              </p>
              <div className="v-alert-acts">
                {o2Bottle && <button onClick={() => applyFrom('pack', o2Bottle.id)}>USE {o2Bottle.name.toUpperCase()}</button>}
                <button onClick={() => setO2Hidden({ level: o2Level, untilMin: s.clockMin + 20 })}>OK</button>
              </div>
            </div>
          )}
          {/* After closing the alert, a one-line reminder with the same (leak-aware) number replaces the sim's O₂ line. */}
          {o2Level && !o2Shown && <p className={o2Level === 'critical' ? 'critical' : 'warning'}>▲ O₂ {s.suit.o2Kg <= 0 ? 'EXHAUSTED' : `LOW · ${formatMinutes(fc.o2Min)} LEFT`}</p>}
          {frame.warnings.filter((w) => !w.code.startsWith('O2')).map((w) => <p key={w.code} className={w.level}>▲ {w.message}</p>)}
          {toast && <p className="v-toast" role="status">{toast}</p>}
        </div>

        {/* Top right: the minimap, with suit details under it. */}
        <aside className="v-map">
          <div ref={mapSlot} className="hud-map-slot" />
          {goalPanel}
          <button className="v-toggle" aria-expanded={journalOpen} onClick={() => setJournalOpen((o) => !o)} title="Field journal (J)">
            FIELD JOURNAL {found.length}/{FINDINGS.length} {journalOpen ? '▴' : '▾'}
          </button>
          {journalOpen && (
            <section className="v-journal" aria-label="Field journal">
              <p className="v-journal-why">While you wait for help, learn how people could live here. Each finding goes home with you.</p>
              <ol>
                {FINDINGS.map((f) => found.includes(f.id) ? (
                  <li key={f.id} className="done"><b>✓ {f.title}</b><span>{f.text}</span><em>Data: {f.source}</em></li>
                ) : (
                  <li key={f.id}><b>○ {f.title}</b><span>{f.how}</span></li>
                ))}
              </ol>
            </section>
          )}
          <button className="v-toggle" aria-expanded={suitOpen} onClick={() => setSuitOpen((o) => !o)}>
            SUIT DETAILS {suitOpen ? '▴' : '▾'}
          </button>
          {suitOpen && (
            <dl className="v-details">
              <dt>O₂</dt><dd>{(s.suit.o2Kg * 1000).toFixed(0)} g · {formatMinutes(fc.o2Min)}</dd>
              <dt>Scrubber</dt><dd>{(s.suit.liohKg * 1000).toFixed(0)} g · {formatMinutes(fc.scrubberMin)}</dd>
              <dt>Water</dt><dd>{s.suit.waterKg.toFixed(2)} kg · {formatMinutes(fc.waterMin)}</dd>
              <dt>Battery</dt><dd>{s.suit.batteryWh.toFixed(0)} Wh · {formatMinutes(fc.batteryMin)}</dd>
              <dt>Inspired pCO₂</dt><dd className={s.suit.inspiredPCO2KPa > 1 ? 'warning' : undefined}>{s.suit.inspiredPCO2KPa.toFixed(2)} kPa</dd>
              <dt>Core temp</dt><dd className={s.suit.coreTempC > 38 || s.suit.coreTempC < 36 ? 'warning' : undefined}>{s.suit.coreTempC.toFixed(1)} °C</dd>
              <dt>Effort</dt><dd>{Math.round(metabolicW(s.activity))} W</dd>
            </dl>
          )}
        </aside>

        {/* Bottom edge: the other consumables, where you are, and the menu. */}
        <footer className="v-bottom">
          <div className="v-bars">
            {vbar('scrubberMin', 'SCRUB', s.suit.liohKg, FULL_SUIT.liohKg)}
            {vbar('waterMin', 'H₂O', s.suit.waterKg, FULL_SUIT.waterKg)}
            {vbar('batteryMin', 'BAT', s.suit.batteryWh, FULL_SUIT.batteryWh)}
          </div>
          <span className="v-where">
            {storeAt === 'aboard' ? 'ABOARD AER-1 · ' : storeAt === 'room' ? 'IN THE STORAGE ROOM · ' : ''}
            {s.shelter === 'cabin' ? 'IN CABIN · CHARGING' : underRock ? 'UNDER ROCK COVER' : 'OUTSIDE'}{leaking ? ' · SUIT LEAKING' : ''}
          </span>
          <button className="v-menu-btn v-pack-btn" aria-expanded={packOpen} onClick={() => { setPackOpen((o) => !o); setMenuOpen(false); }}
            title="Backpack, ship storage and repairs (I)">▣ PACK {carriedKg(bag).toFixed(1)}/{BACKPACK_MAX_KG} kg</button>
          {/* LOCAL DRAFT: camera switch. */}
          <button className="v-menu-btn v-view-btn" aria-pressed={view === 'first'} onClick={() => { viewPicked.current = true; setView((v) => (v === 'first' ? 'third' : 'first')); }}
            title="Switch camera (V)">{view === 'first' ? '◉ 1ST PERSON' : '◎ 3RD PERSON'}</button>
          <button className="v-menu-btn" aria-expanded={menuOpen} onClick={() => { setMenuOpen((o) => !o); setPackOpen(false); }}>☰ MENU</button>
        </footer>
        <p className={hintOn ? 'v-hint' : 'v-hint off'} aria-hidden={!hintOn}>
          {lookLocked
            ? `MOUSE LOOK ON · WASD move · SHIFT run · ${view === 'first' ? '' : 'scroll to zoom · '}V view · ESC frees the cursor`
            : 'CLICK THE VIEW TO LOOK AROUND WITH THE MOUSE · WASD move · SHIFT run · V first/third person · SPACE pause'}
        </p>
        <p className="v-credit">Simulated astronaut · {dataCaption(pack, s.weather)} · terrain: HiRISE DTM, height ×1.6 · not live</p>

        {menuOpen && (
          <nav className="v-menu" aria-label="Game menu">
            <h2>MENU</h2>
            {([
              [paused ? 'RESUME' : 'PAUSE', 'pause', false],
              [mission ? 'RESTART SOL 1' : 'START SOL 1: SCRUBBER SATURATION', 'sol1', false],
              ['TRIGGER DUST STORM', 'storm', stormActive || mission !== null],
              ['SKIP +1 HOUR (TEST)', 'skip', false],
              ['RESTART AT THE CABIN', 'restart', false],
              ['HOW TO PLAY', 'howto', false],
              ['CREDITS', 'credits', false],
              ...(onView ? [['SWITCH TO 2D HUD', 'hud', false], ['TELEMETRY CHARTS', 'telemetry', false]] as const : []),
            ] as const).map(([label, id, disabled]) => (
              <button key={id} disabled={disabled} onClick={() => { menuAction(id); setMenuOpen(false); }}>{label}</button>
            ))}
            <button className="v-menu-close" onClick={() => setMenuOpen(false)}>CLOSE</button>
          </nav>
        )}

        {overlay && <div className="g3-overlay">{overlay}</div>}
        {creditsNode}
        {work && (
          <section className="v-work" role="status" aria-label="Work in progress">
            <p className="v-work-title">{work.label}</p>
            <span className="v-work-bar" style={{ animationDuration: `${WORK_MS}ms` }} aria-hidden="true" />
            <p className="v-work-sub">{formatMinutes(work.minutes)} OF WORK · THE CLOCK JUMPS WHEN IT IS DONE</p>
          </section>
        )}

        {nearRover && !near && readPage === null && !endCard && (() => {
          const pass = passNow(s.clockMin);
          const stage = callStage(linked, hasCommsLink(bag), pass);
          return (
            <section className="v-rover" aria-label="Perseverance">
              <h3>PERSEVERANCE · NASA MARS 2020 ROVER</h3>
              {called ? (
                <p>Distress call sent. Earth will answer on a later pass.</p>
              ) : stage === 'need-link' ? (
                <p>Its radio link was damaged in the dust. It can still reach Earth through the orbiters once repaired: find manual page 4 and build the <b>rover radio repair kit</b> at the ship from AER-1's parts.</p>
              ) : stage === 'connect' ? (
                <button className="v-pickup-btn" onClick={roverAction}><kbd>F</kbd> REPAIR THE ROVER'S RADIO</button>
              ) : stage === 'wait' ? (
                <>
                  <p>Radio repaired. {pass ? <>Next orbiter pass: <b>{pass.orbiter} ≈{pass.centre}</b>, in {formatMinutes(pass.inMin)}.</> : 'No pass times known.'} The rover's nuclear power keeps your battery charged.</p>
                  {pass && <button className="v-pickup-btn" onClick={roverAction}><kbd>F</kbd> WAIT FOR THE PASS</button>}
                </>
              ) : (
                <>
                  <p className="warning">{orbiterName(pass?.orbiter)} is overhead now.</p>
                  <button className="v-pickup-btn" onClick={roverAction}><kbd>F</kbd> SEND THE DISTRESS CALL</button>
                </>
              )}
            </section>
          );
        })()}

        {sitePhoto && !photosShut.includes(sitePhoto.item.id) && readPage === null && !endCard && (() => {
          const { item, photo } = sitePhoto;
          const d = photo.date_taken_utc ? new Date(`${photo.date_taken_utc.slice(0, 10)}T12:00:00Z`) : null;
          const when = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
          return (
            <aside className="v-thennow" aria-label={`Then and now: ${item.label}`}>
              <p className="v-thennow-head">
                <span>THEN</span>{Number.isFinite(photo.sol) ? ` · PERSEVERANCE SOL ${photo.sol}` : ' · NASA ARCHIVE'}{when ? ` · ${when}` : ''}
                <button onClick={() => setPhotosShut((l) => [...l, item.id])} aria-label="Hide photo">×</button>
              </p>
              <img src={`/data/photos/${photo.file}`} alt={`${item.label}, archived NASA photo`} />
              <p className="v-thennow-cap">{photo.instrument ? `${cameraName(photo.instrument)} · ` : ''}{photo.credit} · archived, not live</p>
              <p className="v-thennow-now"><span>NOW</span> · you are standing at {item.label}</p>
            </aside>
          );
        })()}

        {near && readPage === null && (() => {
          const e = entryForPickup(bag, near, data.content, () => 0);
          const ok = fits(bag, e.massKg);
          const verb = e.kind === 'page' ? 'TAKE' : e.kind === 'part' || (near.id in SALVAGE) ? 'SALVAGE' : 'PICK UP';
          return (
            <button className={ok ? 'v-pickup' : 'v-pickup full'} onClick={pickUpNear}>
              <kbd>F</kbd> {verb} {e.name.toUpperCase()}
              {e.massKg > 0 && <span> · {e.massKg.toFixed(1)} kg</span>}
              {!ok && <span className="warning"> · BACKPACK FULL</span>}
            </button>
          );
        })()}

        {packOpen && (() => {
          const kg = carriedKg(bag);
          const matName = (m: string) => data.content?.materials.find((x) => x.id === m)?.name ?? m;
          const partName = (id: string) => SALVAGE[id]?.name ?? id;
          const row = (e: PackEntry, where: 'pack' | 'ship') => (
            <li key={e.id}>
              <span className="v-pack-name">
                {e.name}
                <em>
                  {e.kind === 'supply' && (usable(e) ? givesLabel(e.gives) : e.repairs ? 'tools for repairs' : '')}
                  {e.kind === 'scrap' && Object.entries(e.yields ?? {}).map(([m, v]) => `${matName(m).toLowerCase()} ${v} kg`).join(' · ')}
                  {e.kind === 'part' && (e.id === CACHE_SITE ? 'Perseverance samples · going home with you' : 'NASA part for ship repairs')}
                  {e.kind === 'page' && (e.blueprint ? 'build it in REPAIRS' : 'read to learn how')}
                  {e.massKg > 0 && ` · ${e.massKg.toFixed(1)} kg`}
                </em>
              </span>
              <span className="v-pack-acts">
                {usable(e) && (where === 'pack' || inStore) && <button onClick={() => applyFrom(where, e.id)}>USE</button>}
                {e.kind === 'page' && !e.blueprint && <button onClick={() => openPage(e.page)}>READ</button>}
                {where === 'pack' && inStore && <button onClick={() => storeInShip(e.id)} title="Keep it in the ship">STORE</button>}
                {where === 'pack' && e.kind !== 'page' && <button onClick={() => dropFromBag(e.id)} title="Put it down here">DROP</button>}
                {where === 'ship' && inStore && <button onClick={() => takeFromShip(e.id)} title="Into the backpack">TAKE</button>}
              </span>
            </li>
          );
          const groups = (list: PackEntry[], where: 'pack' | 'ship') => (['supply', 'part', 'scrap', 'page'] as const).map((kind) => {
            const items = list.filter((e) => e.kind === kind);
            if (!items.length) return null;
            return (
              <div key={kind} className="v-pack-group">
                <h3>{kind === 'supply' ? 'SUPPLIES AND TOOLS' : kind === 'part' ? 'NASA PARTS' : kind === 'scrap' ? 'SCRAP' : 'MANUAL PAGES'}</h3>
                <ul>{items.map((e) => row(e, where))}</ul>
              </div>
            );
          });
          return (
            <section className="v-pack" aria-label="Backpack, ship and repairs">
              <div className="v-pack-tabs" role="tablist">
                {([['pack', 'BACKPACK'], ['ship', 'SHIP'], ['repairs', `REPAIRS ${ship.repaired.length}/${REPAIRS.length}`]] as const).map(([id, label]) => (
                  <button key={id} role="tab" aria-selected={packTab === id} className={packTab === id ? 'on' : undefined} onClick={() => setPackTab(id)}>{label}</button>
                ))}
                <button className="v-pack-close" onClick={() => setPackOpen(false)} aria-label="Close">×</button>
              </div>

              {packTab === 'pack' && (
                <>
                  <div className={kg > HEAVY_KG ? 'v-load warning' : 'v-load'}>
                    <span>{kg.toFixed(1)} / {BACKPACK_MAX_KG} kg{kg > HEAVY_KG ? ' · HEAVY' : ''}</span>
                    <span className="v-load-bar"><span style={{ width: `${Math.min(100, (kg / BACKPACK_MAX_KG) * 100)}%` }} /></span>
                  </div>
                  {bag.entries.length === 0 && (
                    <p className="v-pack-empty">Empty. Walk up to supplies, rocket pieces, manual pages or NASA hardware you have spotted and press <kbd>F</kbd>.</p>
                  )}
                  {groups(bag.entries, 'pack')}
                  {inStore && bag.entries.length > 0 && <button className="v-pack-wide" onClick={() => storeInShip()}>STORE EVERYTHING IN THE SHIP</button>}
                  <p className="v-pack-note">
                    {inStore ? 'You are inside: store things here to free the backpack.' : 'Carried mass raises your effort. Go inside the lander (through the hatch) to store things.'}
                    {' '}DROP puts an item down where you stand.
                  </p>
                </>
              )}

              {packTab === 'ship' && (
                <>
                  <p className="v-pack-note">
                    {hasStorageRoom(ship)
                      ? `STORAGE ROOM · ${shipKg(ship).toFixed(1)} kg stored · no weight limit`
                      : `LOCKER INSIDE THE LANDER · ${shipKg(ship).toFixed(1)}/${SHIP_LOCKER_KG} kg · ${[...bag.entries, ...ship.stored].some((x) => x.blueprint)
                        ? 'build the storage room (REPAIRS) for more room'
                        : 'find the storage-room blueprint among the AER-1 debris to build more room'}`}
                  </p>
                  {!inStore && <p className="v-pack-note warning">The storage is inside the lander{hasStorageRoom(ship) ? ' and in the storage room' : ''}. Go in to store or take things.</p>}
                  {Object.keys(ship.materials).length > 0 && (
                    <div className="v-pack-group">
                      <h3>MATERIALS (FROM SCRAP)</h3>
                      <p className="v-chips">{Object.entries(ship.materials).map(([m, v]) => <span key={m}>{matName(m)} {Math.round(v * 10) / 10} kg</span>)}</p>
                    </div>
                  )}
                  {groups(ship.stored, 'ship')}
                  {ship.stored.length === 0 && Object.keys(ship.materials).length === 0 && (
                    <p className="v-pack-empty">The ship's storage is empty. Bring supplies, scrap and parts back inside the lander and STORE them.</p>
                  )}
                </>
              )}

              {packTab === 'repairs' && (
                <>
                  <p className="v-pack-note">Repair the lander into a base you can survive from. Repairs use stored materials and NASA parts; tools and manual pages are kept. Recipes are game design values.</p>
                  {REPAIRS.map((rp) => {
                    const done = (ship.repaired as string[]).includes(rp.id);
                    const needs = repairNeeds(rp, bag, ship, matName, partName);
                    const ready = canRepair(rp, bag, ship);
                    return (
                      <div key={rp.id} className={done ? 'v-repair done' : 'v-repair'}>
                        <h3>{done ? '✓ ' : ''}{rp.name.toUpperCase()} <span>{rp.minutes} min</span></h3>
                        <p className="v-repair-does">{rp.does}</p>
                        {!done && (
                          <ul className="v-needs">
                            {needs.map((n) => <li key={n.label} className={n.have ? 'have' : undefined}>{n.have ? '✓' : '○'} {n.label}</li>)}
                          </ul>
                        )}
                        {!done && (
                          <button className="v-pack-wide" disabled={!ready || !inStore} onClick={() => repairShip(rp)}>
                            {!inStore ? 'GO INSIDE THE LANDER TO REPAIR' : ready ? `REPAIR (${rp.minutes} MIN)` : 'MISSING PARTS'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <p className="v-pack-note">WORKBENCH · made from AER-1's scattered parts (hull panels, straps, blankets, wiring, boxes)</p>
                  {jobs.map((job) => {
                    const done = ship.built.includes(job.id) || (job.id === COMMS_LINK_ID && linked);
                    const needs = repairNeeds(job, bag, ship, matName, partName);
                    const ready = canBuild(job, bag, ship);
                    const verb = job.id === SUIT_PATCH_ID ? 'PATCH' : 'BUILD';
                    return (
                      <div key={job.id} className={done ? 'v-repair v-build done' : 'v-repair v-build'}>
                        <h3>{done ? '✓ ' : ''}{verb}: {job.name.toUpperCase()} <span>{job.minutes} min</span></h3>
                        <p className="v-repair-does">{job.does}{job.id === COMMS_LINK_ID ? ' Take it to Perseverance, fix its radio, and call Earth during an orbiter pass.' : ''}</p>
                        {!done && (
                          <ul className="v-needs">
                            {needs.map((n) => <li key={n.label} className={n.have ? 'have' : undefined}>{n.have ? '✓' : '○'} {n.label}</li>)}
                          </ul>
                        )}
                        {!done && (
                          <button className="v-pack-wide" disabled={!ready || !inStore} onClick={() => buildJob(job)}>
                            {!inStore ? `GO INSIDE THE LANDER TO ${verb}` : ready ? `${verb} (${job.minutes} MIN)` : 'MISSING PARTS'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          );
        })()}

        {readPage !== null && (() => {
          const pg = manualPage(pack.fieldManualPages, readPage);
          const recipe = data.content?.recipes.find((r) => r.id === pg?.unlocksRecipe);
          return (
            <div className="g3-overlay">
              <article className="howto v-manual" aria-label="Field manual page">
                <p className="v-manual-kicker">FIELD MANUAL · PAGE {readPage}{pg?.category ? ` · ${pg.category.toUpperCase()}` : ''}</p>
                <h2>{pg?.title ?? 'Page'}</h2>
                {pg?.sciencePrinciple && <p className="howto-goal">{pg.sciencePrinciple}</p>}
                {pg?.diagram && <pre className="v-manual-diagram">{pg.diagram}</pre>}
                {recipe && (
                  <p className="v-manual-build">
                    <b>Unlocks: {recipe.name}.</b> {recipe.does}. Needs {Object.entries(recipe.needs).map(([m, kg]) => `${m} ${kg} kg`).join(', ')}.
                  </p>
                )}
                {pg?.source && <p className="v-manual-source">Source: {pg.source}</p>}
                <button className="choice-btn howto-go" onClick={closePage} autoFocus>CLOSE</button>
              </article>
            </div>
          );
        })()}

        {howToOpen && (
          <div className="g3-overlay">
            <section className="howto" aria-label="How to play">
              <h2>HOW TO PLAY</h2>
              <p className="howto-goal">You crash-landed in Jezero Crater and your suit is leaking. Collect AER-1's scattered parts to patch the suit, repair your ship and build the rover radio repair kit, then find Perseverance (about 2 km west), fix its radio and call Earth while an orbiter passes overhead. Watch your oxygen, and get under cover when a dust storm comes.</p>
              <dl>
                <dt>Walk</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · hold <kbd>Shift</kbd> to run</dd>
                <dt>Look</dt><dd>Click the view, then move the mouse · <kbd>Esc</kbd> frees the cursor · <kbd>V</kbd> first/third person</dd>
                <dt>Map</dt><dd>Top right. Click it to plan a route, then press WALK ROUTE. Stay inside the green line to get home.</dd>
                <dt>Suit</dt><dd>Bars along the bottom; the big countdown top left is what runs out first. Stand at the lander to recharge.</dd>
                <dt>Pick up</dt><dd>Walk up to something you have spotted and press <kbd>F</kbd>. The backpack holds {BACKPACK_MAX_KG} kg; <kbd>I</kbd> opens it.</dd>
                <dt>Ship</dt><dd>At the lander, store what you found and repair the ship with tools, manual pages, scrap and parts from NASA hardware. A repaired ship refills your suit.</dd>
                <dt>Weather</dt><dd>Top-left forecast: dust devils, the storm warning, nightfall.</dd>
                <dt>Menu</dt><dd>☰ MENU: start the Sol 1 mission, pause, or switch to the 2D view.</dd>
              </dl>
              <button className="choice-btn howto-go" onClick={closeHowTo} autoFocus>LET'S GO</button>
            </section>
          </div>
        )}
      </div>
      </>
    );
  }

  return (
    <>
    {mapPortal}
    <p className="hud-note">
      SIMULATED ASTRONAUT · REAL ARCHIVED NASA WEATHER (PERSEVERANCE MEDA, MEDA SOL {s.weather.sol}) · NOT LIVE
    </p>
    <div className={critical ? 'visor critical-frame' : 'visor'}>
      <header className="visor-top">
        <span>DAY {clock.sol} · {clock.time} LTST · MEDA SOL {s.weather.sol}</span>
        <span className={frame.speed === 'emergency' ? 'critical' : frame.speed === 'storm' ? 'warning' : undefined}>
          {SPEED_LABEL[frame.speed]}
        </span>
        <span>OUT {frame.env.tempC.toFixed(0)} °C · τ {frame.env.tau.toFixed(2)}</span>
      </header>

      <div className="visor-left">
        {gauge('o2Min', s.suit.o2Kg * 1000, FULL_SUIT.o2Kg * 1000, 'g')}
        {gauge('scrubberMin', s.suit.liohKg * 1000, FULL_SUIT.liohKg * 1000, 'g')}
      </div>

      <div className="visor-centre">
        {/* Status above the map: storm countdown, the first consumable to run out, travel and mission progress. */}
        <div className="centre-status">
          {phase === 'warning' && (
            <p className="storm warning">
              DUST STORM APPROACHING {Math.floor(stormRealSec / 60)}:{String(stormRealSec % 60).padStart(2, '0')}
            </p>
          )}
          {stormActive && phase !== 'warning' && <p className="storm warning">DUST STORM: {phase.toUpperCase()}</p>}
          {hero ? (
            <div className={hero.min < 30 ? 'hero warning' : 'hero'}>
              <span className="hero-label">{CONSUMABLE_LABEL[hero.key]} OUT IN</span>
              <span className="hero-num">{formatMinutes(hero.min)}</span>
            </div>
          ) : (
            <div className="hero"><span className="hero-label">NO CONSUMABLES IN USE</span></div>
          )}
          {flow && !flow.arrived && (
            <p className="warning">
              EN ROUTE: {SHELTER_NAME[flow.choice.shelter]} · {formatMinutes(flow.choice.travelMin - (s.clockMin - flow.chosenAtMin))} TO COVER
            </p>
          )}
          {flow?.arrived && <p>{flow.choice.id === 'search' ? 'SEARCHING IN THE STORM' : `SHELTERED: ${SHELTER_NAME[s.shelter]}`}</p>}
          {stormActive && !flow && s.shelter === 'cabin' && <p>SHELTERED: CABIN</p>}
          {mission && !missionCard && sol1Panel}
          {walkLine}
        </div>

        {/* The map stays mounted (it keeps the explored fog and the planned route); cards float over it. */}
        <div className="centre-map">
          <div ref={mapSlot} className="hud-map-slot" />
          {overlay && <div className="centre-overlay">{overlay}</div>}
          {creditsNode}
        </div>
      </div>

      <div className="visor-right">
        {gauge('waterMin', s.suit.waterKg, FULL_SUIT.waterKg, 'kg', 2)}
        {gauge('batteryMin', s.suit.batteryWh, FULL_SUIT.batteryWh, 'Wh')}
        <div className="readouts">
          <span className={s.suit.inspiredPCO2KPa > 1 ? 'warning' : undefined}>
            pCO₂ {s.suit.inspiredPCO2KPa.toFixed(2)} kPa
          </span>
          <span className={s.suit.coreTempC > 38 || s.suit.coreTempC < 36 ? 'warning' : undefined}>
            CORE {s.suit.coreTempC.toFixed(1)} °C
          </span>
        </div>
      </div>

      <footer className="visor-bottom">
        <div className="alarms" aria-live="polite">
          {frame.warnings.length === 0
            ? <span className="dim">NO ALARMS</span>
            : frame.warnings.map((w) => <span key={w.code} className={w.level}>▲ {w.message}</span>)}
        </div>
        <div className="controls" role="group" aria-label="Test controls">
          <button className="start-sol1" onClick={startSol1}>{mission ? 'RESTART SOL 1' : 'START SOL 1'}</button>
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={modeId === m.id} onClick={() => setMode(m.id)} disabled={mission !== null}>{m.label}</button>
          ))}
          <button aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? 'RESUME' : 'PAUSE'}</button>
          <button onClick={triggerStorm} disabled={stormActive || mission !== null}>TRIGGER STORM</button>
          <button onClick={skipHour}>SKIP +1 H</button>
          <button onClick={() => restart()}>RESTART</button>
          <label className="scenario">
            <span className="dim">SCENARIO</span>
            <select value={solIndex} onChange={(e) => restart(Number(e.target.value))}>
              {pack.sols.map((sol, i) => (
                <option key={sol.sol} value={i}>{sol.scenario ?? `Sol ${sol.sol}`} (MEDA sol {sol.sol})</option>
              ))}
            </select>
          </label>
        </div>
        <p className="source dim">{dataCaption(pack, s.weather)}</p>
      </footer>
    </div>
    </>
  );
}
