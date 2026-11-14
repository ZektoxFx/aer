import { useEffect, useRef, useState } from 'react';
import type { DataPack } from '../data/types';
import { SPEED_X, forecast, newGame, tick } from '../sim/game';
import { FULL_SUIT } from '../sim/simulate';
import { makeStorm, shelterEnvironment, stormCountdownMin, stormPhase } from '../sim/storm';
import type { Activity, Shelter, TickResult } from '../sim/types';
import { CONSUMABLE_LABEL, clockLabel, firstToRunOut, formatMinutes, SPEED_LABEL, type Consumable } from './hudFormat';
import './hud.css';

// Test controls until Map drives the activity from a planned route.
const MODES: { id: string; label: string; activity: Activity; shelter: Shelter }[] = [
  { id: 'cabin', label: 'IN CABIN', activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'cabin' },
  { id: 'rest', label: 'REST OUTSIDE', activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'none' },
  { id: 'walk', label: 'WALK', activity: { speedMS: 1, slopeDeg: 0, loadKg: 10 }, shelter: 'none' },
  { id: 'run', label: 'RUN', activity: { speedMS: 2, slopeDeg: 0, loadKg: 10 }, shelter: 'none' },
];

/** In-suit HUD: a visor frame of readouts around an open centre (map and photos go there later). */
export function Hud({ pack }: { pack: DataPack }) {
  const [frame, setFrame] = useState<TickResult>(() => tick(newGame(pack.sols[0]), 0, true));
  const [paused, setPaused] = useState(false);
  const [modeId, setModeId] = useState('cabin');
  const game = useRef(frame.state);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Game loop: advance the sim by real elapsed time every animation frame.
  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(now) {
      const dt = Math.min(0.25, (now - last) / 1000); // cap so a hidden tab doesn't jump hours
      last = now;
      const r = tick(game.current, dt, pausedRef.current);
      game.current = r.state;
      setFrame(r);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const setMode = (id: string) => {
    const m = MODES.find((x) => x.id === id)!;
    game.current = { ...game.current, activity: m.activity, shelter: m.shelter };
    setModeId(id);
  };
  const triggerStorm = () => { game.current = { ...game.current, storm: makeStorm(game.current.clockMin) }; };
  const restart = () => { game.current = newGame(pack.sols[0]); setMode('cabin'); };

  const s = frame.state;
  const fc = forecast(s.suit, shelterEnvironment(frame.env, s.shelter), s.activity);
  const hero = firstToRunOut(fc);
  const clock = clockLabel(s.clockMin);
  const critical = frame.warnings.some((w) => w.level === 'critical');

  const phase = s.storm ? stormPhase(s.storm, s.clockMin) : 'none';
  const stormRealSec = s.storm ? Math.ceil((stormCountdownMin(s.storm, s.clockMin) / SPEED_X.storm) * 60) : 0;

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
    <div className={critical ? 'visor critical-frame' : 'visor'}>
      <header className="visor-top">
        <span>SOL {clock.sol} · {clock.time} LMST</span>
        <span className={frame.speed === 'emergency' ? 'critical' : frame.speed === 'storm' ? 'warning' : undefined}>
          {SPEED_LABEL[frame.speed]}
        </span>
        <span>OUT {frame.env.tempC.toFixed(0)} °C · τ {frame.env.tau.toFixed(1)}</span>
      </header>

      <div className="visor-left">
        {gauge('o2Min', s.suit.o2Kg * 1000, FULL_SUIT.o2Kg * 1000, 'g')}
        {gauge('scrubberMin', s.suit.liohKg * 1000, FULL_SUIT.liohKg * 1000, 'g')}
      </div>

      <div className="visor-centre">
        {hero ? (
          <div className={hero.min < 30 ? 'hero warning' : 'hero'}>
            <span className="hero-label">{CONSUMABLE_LABEL[hero.key]} OUT IN</span>
            <span className="hero-num">{formatMinutes(hero.min)}</span>
          </div>
        ) : (
          <div className="hero"><span className="hero-label">NO CONSUMABLES IN USE</span></div>
        )}
        {phase === 'warning' && (
          <p className="storm warning">
            DUST STORM APPROACHING {Math.floor(stormRealSec / 60)}:{String(stormRealSec % 60).padStart(2, '0')}
          </p>
        )}
        {(phase === 'building' || phase === 'peak' || phase === 'clearing') && (
          <p className="storm warning">DUST STORM: {phase.toUpperCase()}</p>
        )}
        <p className="centre-note">[ map / surface photo view ]</p>
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
          {MODES.map((m) => (
            <button key={m.id} aria-pressed={modeId === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
          ))}
          <button aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? 'RESUME' : 'PAUSE'}</button>
          <button onClick={triggerStorm} disabled={phase !== 'none' && phase !== 'over'}>TRIGGER STORM</button>
          <button onClick={restart}>RESTART</button>
        </div>
        <p className="source dim">Simulated suit · weather inputs: {pack.source} · Sol {s.weather.sol}</p>
      </footer>
    </div>
  );
}
