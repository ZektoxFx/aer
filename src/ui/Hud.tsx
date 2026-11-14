import { useEffect, useRef, useState } from 'react';
import { SPEED_X, forecast, newGame, tick } from '../sim/game';
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
export function Hud({ data }: { data: GameData }) {
  const { pack } = data;
  const startGame = (i: number) => newGame(pack.sols[i], skyFor(data, pack.sols[i]));
  const [solIndex, setSolIndex] = useState(0);
  const [frame, setFrame] = useState<TickResult>(() => tick(startGame(0), 0, true));
  const [paused, setPaused] = useState(false);
  const [modeId, setModeId] = useState('cabin');
  const [flow, setFlow] = useState<ShelterFlow | null>(null);
  const [summary, setSummary] = useState<ShelterSummary | null>(null);
  const [mission, setMission] = useState<Sol1State | null>(null);
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

  const setMode = (id: string) => {
    const m = MODES.find((x) => x.id === id)!;
    game.current = { ...game.current, activity: m.activity, shelter: m.shelter };
    setModeId(id);
  };
  const clearFlow = () => { flowRef.current = null; setFlow(null); setSummary(null); };
  const triggerStorm = () => { clearFlow(); game.current = { ...game.current, storm: makeStorm(game.current.clockMin) }; };
  const setMissionState = (m: Sol1State | null) => { missionRef.current = m; setMission(m); };
  const restart = (i = solIndex) => {
    clearFlow(); setMissionState(null); game.current = startGame(i); setSolIndex(i); setMode('cabin');
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

  const s = frame.state;
  const fc = frame.forecast; // from the sim, so it counts the suit charging in the cabin
  const hero = firstToRunOut(fc);
  const clock = clockLabel(s.clockMin);
  const critical = frame.warnings.some((w) => w.level === 'critical');

  const phase = s.storm ? stormPhase(s.storm, s.clockMin) : 'none';
  const stormRealSec = s.storm ? Math.ceil((stormCountdownMin(s.storm, s.clockMin) / SPEED_X.storm) * 60) : 0;
  const stormActive = phase === 'warning' || phase === 'building' || phase === 'peak' || phase === 'clearing';
  const showChoices = stormActive && !flow && s.shelter !== 'cabin' && (phase === 'warning' || phase === 'building');

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
        {phase === 'warning' && (
          <p className="storm warning">
            DUST STORM APPROACHING {Math.floor(stormRealSec / 60)}:{String(stormRealSec % 60).padStart(2, '0')}
          </p>
        )}
        {stormActive && phase !== 'warning' && <p className="storm warning">DUST STORM: {phase.toUpperCase()}</p>}

        {mission && (
          <Sol1Panel
            mission={mission} suit={s.suit} fc={fc} metabolicW={metabolicW(s.activity)} clockMin={s.clockMin}
            onBegin={missionBegin} onDiagnose={missionDiagnose} onAct={missionAct}
            onRetry={startSol1} onClose={() => setMissionState(null)}
          />
        )}
        {mission && mission.phase !== 'walkOut' && mission.phase !== 'salvage' && mission.phase !== 'walkBack' ? null : summary ? (
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
        ) : (
          <>
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
            <p className="centre-note">[ map / surface photo view ]</p>
          </>
        )}
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
