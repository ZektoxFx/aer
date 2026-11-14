import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HudMap, type Pt, type RouteResult } from '../map';
import { SPEED_X, forecast, newGame, sunElevationDeg, tick } from '../sim/game';
import { FULL_SUIT, metabolicW } from '../sim/simulate';
import { makeStorm, shelterEnvironment, stormCountdownMin, stormPhase } from '../sim/storm';
import type { Activity, Shelter, TickResult } from '../sim/types';
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
import { hudKeyAction } from './settings';
import { distM, planFromRoute, planHome, walkAt, type WalkPlan } from './walk';
import { activityFor, basePoint, inCabinZone, type MoveResult } from './movement';
import { World3D } from './World3D';
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
export function Hud({ data, mode = '2d', onView }: { data: GameData; mode?: '2d' | '3d'; onView?: (v: 'hud' | 'telemetry') => void }) {
  const { pack } = data;
  const base = useMemo(() => basePoint(pack), [pack]);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  // 3D free walking: the latest movement from the 3D view, and a key to put the astronaut back at the cabin.
  const moveRef = useRef<MoveResult | null>(null);
  const [placeKey, setPlaceKey] = useState(0);
  const [suitOpen, setSuitOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const startGame = (i: number) => newGame(pack.sols[i], skyFor(data, pack.sols[i]));
  const [solIndex, setSolIndex] = useState(0);
  const [frame, setFrame] = useState<TickResult>(() => tick(startGame(0), 0, true));
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
  const homeAfterRef = useRef<WalkPlan | null>(null);
  const postedRef = useRef<Pt | null>(null);
  const game = useRef(frame.state);
  const flowRef = useRef<ShelterFlow | null>(null);
  const missionRef = useRef<Sol1State | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  /** One step of the game: the sim tick plus the shelter flow (arrival, then the summary once the storm is over). */
  const step = (dt: number, isPaused: boolean): TickResult => {
    const m = missionRef.current;
    const holding = m !== null && (isHolding(m) || isOver(m));
    const r = tick(game.current, dt, isPaused || holding);
    let state = r.state;
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
    const mv = moveRef.current;
    if (modeRef.current === '3d' && mv && !walkRef.current && !missionRef.current && !flowRef.current) {
      state = { ...state, activity: activityFor(mv), shelter: !mv.moving && inCabinZone(mv.pos, base) ? 'cabin' : 'none' };
    }
    const wk = walkRef.current;
    if (wk && wk.stoppedAt === null) {
      const w = walkAt(wk.plan, state.clockMin - wk.startMin);
      state = { ...state, activity: w.activity, shelter: 'none' };
      // Move the map's astronaut every 20 m, not every frame (the map re-plans from the new spot each time).
      if (!postedRef.current || distM(postedRef.current, w.at) > 20 || w.done) {
        postedRef.current = w.at;
        setAstronaut(w.at);
      }
      if (w.done) {
        walkRef.current = null;
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
    game.current = state;
    return { ...r, state };
  };
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; });

  // Game loop: advance the sim by real elapsed time every animation frame.
  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      const dt = Math.min(0.25, (now - last) / 1000); // cap so a hidden tab doesn't jump hours
      last = now;
      setFrame(stepRef.current(dt, pausedRef.current));
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const onMove3d = useCallback((m: MoveResult) => {
    moveRef.current = m;
    if (walkRef.current) return; // the route walker owns the position
    const atCabin = inCabinZone(m.pos, base);
    if (atCabin ? postedRef.current !== null : !postedRef.current || distM(postedRef.current, m.pos) > 20) {
      postedRef.current = atCabin ? null : m.pos;
      setAstronaut(atCabin ? undefined : m.pos);
    }
  }, [base]);
  const stopWalking = (atCabin: boolean) => {
    walkRef.current = null; setWalk(null); homeAfterRef.current = null;
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
  const triggerStorm = () => { clearFlow(); game.current = { ...game.current, storm: makeStorm(game.current.clockMin) }; };
  const setMissionState = (m: Sol1State | null) => { missionRef.current = m; setMission(m); };
  const restart = (i = solIndex) => {
    clearFlow(); setMissionState(null); stopWalking(true); game.current = startGame(i); setSolIndex(i); setMode('cabin');
    setMapReset((n) => n + 1);
  };

  // Sol 1: Scrubber Saturation runs on the pack's Sol 1 scenario day, with the crash-damaged scrubber.
  const sol1Index = Math.max(0, pack.sols.findIndex((x) => x.scenario?.startsWith('Sol 1')));
  const startSol1 = () => {
    restart(sol1Index);
    game.current = { ...game.current, suit: { ...game.current.suit, liohKg: SOL1_START_LIOH_KG } };
    setMissionState(sol1Start(game.current.clockMin));
    setModeId('');
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
  const skipHour = () => {
    const target = game.current.clockMin + 60;
    let r = frame;
    for (let i = 0; i < 4000 && game.current.clockMin < target; i++) r = step(1, false);
    setFrame(r);
  };

  // Keyboard controls (listed in Settings). The ref always holds this render's handlers.
  const onKey = (e: KeyboardEvent) => {
    const t = e.target;
    if (e.metaKey || e.ctrlKey || e.altKey || (t instanceof Element && t.closest('input, select, textarea'))) return;
    // Space on a focused button presses that button, as browsers do; don't also pause.
    if (e.key === ' ' && t instanceof Element && t.closest('button')) return;
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
  const fc = frame.forecast; // from the sim, so it counts the suit charging in the cabin
  const hero = firstToRunOut(fc);
  const clock = clockLabel(s.clockMin);
  const critical = frame.warnings.some((w) => w.level === 'critical');

  const phase = s.storm ? stormPhase(s.storm, s.clockMin) : 'none';
  const stormRealSec = s.storm ? Math.ceil((stormCountdownMin(s.storm, s.clockMin) / SPEED_X.storm) * 60) : 0;
  const stormActive = phase === 'warning' || phase === 'building' || phase === 'peak' || phase === 'clearing';
  const showChoices = stormActive && !flow && s.shelter !== 'cabin' && (phase === 'warning' || phase === 'building');

  const menuAction = (id: string) => {
    if (id === 'pause') setPaused((p) => !p);
    else if (id === 'sol1') startSol1();
    else if (id === 'storm') triggerStorm();
    else if (id === 'skip') skipHour();
    else if (id === 'restart') restart();
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
  const overlay = missionCard ? sol1Panel : summary ? (
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
    <div className="shelter-choices" role="group" aria-label="Where to wait out the storm">
      {SHELTER_CHOICES.map((c) => (
        <button key={c.id} className="shelter-card" onClick={() => pick(c)}>
          <strong>{c.label}</strong>
          <span>+ {c.benefit}</span>
          <span className="dim">− {c.cost}</span>
          <span className="dim">{c.travelMin ? `${formatMinutes(c.travelMin)} to cover` : 'No cover'}</span>
        </button>
      ))}
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
    const holding = paused || (mission !== null && (isHolding(mission) || isOver(mission)));
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
    return (
      <div className="game3d">
        <World3D
          pack={pack} base={base} timeScale={timeScale} followPos={walk ? astronaut : undefined} placeKey={placeKey}
          tau={frame.env.tau} sunElevationDeg={sunElevationDeg(s.clockMin, s.sky)} onMove={onMove3d}
        />
        <div className={critical ? 'visor-frame critical' : 'visor-frame'} aria-hidden="true" />

        {/* Top left: time, conditions, oxygen and the first thing to run out. */}
        <header className="v-top">
          <div className="v-clock">
            <span className="v-time">{clock.time}</span>
            <span className="v-sub">LTST · DAY {clock.sol} · MEDA SOL {s.weather.sol}</span>
            <span className={frame.speed === 'emergency' ? 'v-sub critical' : frame.speed === 'storm' ? 'v-sub warning' : 'v-sub'}>
              {SPEED_LABEL[frame.speed]} · {frame.env.tempC.toFixed(0)} °C · τ {frame.env.tau.toFixed(2)}
            </span>
          </div>
          <div className="v-o2">
            {vbar('o2Min', 'O₂', s.suit.o2Kg, FULL_SUIT.o2Kg)}
            {hero && (
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
          {flow && !flow.arrived && (
            <p className="warning">EN ROUTE: {SHELTER_NAME[flow.choice.shelter]} · {formatMinutes(flow.choice.travelMin - (s.clockMin - flow.chosenAtMin))} TO COVER</p>
          )}
          {flow?.arrived && <p>{flow.choice.id === 'search' ? 'SEARCHING IN THE STORM' : `SHELTERED: ${SHELTER_NAME[s.shelter]}`}</p>}
          {mission && !missionCard && <div className="v-pill">{sol1Panel}</div>}
          {walkLine && <div className="v-pill">{walkLine}</div>}
          {frame.warnings.map((w) => <p key={w.code} className={w.level}>▲ {w.message}</p>)}
        </div>

        {/* Top right: the minimap, with suit details under it. */}
        <aside className="v-map">
          <HudMap
            pack={pack} suit={s.suit} env={frame.env} storm={stormActive} sol={s.weather.sol}
            night={sunElevationDeg(s.clockMin, s.sky) < 0} resetKey={mapReset}
            astronaut={astronaut} onRoute={onRoute}
          />
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
            {s.shelter === 'cabin' ? 'IN CABIN · CHARGING' : 'OUTSIDE'} · pCO₂ {s.suit.inspiredPCO2KPa.toFixed(2)} · CORE {s.suit.coreTempC.toFixed(1)} °C
          </span>
          <button className="v-menu-btn" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>☰ MENU</button>
        </footer>
        <p className="v-hint">WASD move · SHIFT run · Q/E or drag to look · scroll to zoom · SPACE pause</p>
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
              ...(onView ? [['SWITCH TO 2D HUD', 'hud', false], ['TELEMETRY CHARTS', 'telemetry', false]] as const : []),
            ] as const).map(([label, id, disabled]) => (
              <button key={id} disabled={disabled} onClick={() => { menuAction(id); setMenuOpen(false); }}>{label}</button>
            ))}
            <button className="v-menu-close" onClick={() => setMenuOpen(false)}>CLOSE</button>
          </nav>
        )}

        {overlay && <div className="g3-overlay">{overlay}</div>}
      </div>
    );
  }

  return (
    <>
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
          <HudMap
            pack={pack} suit={s.suit} env={frame.env} storm={stormActive} sol={s.weather.sol}
            night={sunElevationDeg(s.clockMin, s.sky) < 0} resetKey={mapReset}
            astronaut={astronaut} onRoute={onRoute}
          />
          {overlay && <div className="centre-overlay">{overlay}</div>}
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
