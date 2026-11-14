import { useMemo, useState } from 'react';
import { FULL_SUIT } from '../sim/simulate';
import type { Activity } from '../sim/types';
import { dataCaption, type GameData } from './gameData';
import { StripChart } from './StripChart';
import { runTelemetry, solEnvironment } from './telemetry';
import './ui.css';

// Test walk shown until Map hands over real routes.
const TEST_WALK: Activity = { speedMS: 1, slopeDeg: 5, loadKg: 10 };
const WALK_MIN = 300;
const STEP_MIN = 5;

/** App layout: header, sol picker, suit strip charts and active warnings. */
export function Shell({ data }: { data: GameData }) {
  const { pack } = data;
  const [solIndex, setSolIndex] = useState(0);
  const sol = pack.sols[solIndex];

  const points = useMemo(
    () => runTelemetry(FULL_SUIT, solEnvironment(sol), TEST_WALK, WALK_MIN, STEP_MIN),
    [sol],
  );
  const series = (pick: (p: (typeof points)[number]) => number): [number, number][] =>
    points.map((p) => [p.min, pick(p)]);

  // Every chart names its source and sol (team rule). Archived data, never "live".
  const caption = dataCaption(pack, sol);
  const warnings = points[points.length - 1].warnings;

  return (
    <div className="shell">
      <header className="shell-head">
        <h1>AER // SUIT TELEMETRY</h1>
        <span className="shell-tag">ARCHIVED DATA · SIMULATION</span>
      </header>

      <section className="shell-bar" aria-label="Conditions">
        <div className="sol-picker" role="group" aria-label="Sol">
          {pack.sols.map((s, i) => (
            <button key={s.sol} aria-pressed={i === solIndex} onClick={() => setSolIndex(i)}>
              SOL {s.sol}
            </button>
          ))}
        </div>
        <span>{pack.area.name}</span>
        <span>P {sol.pressureKPa.toFixed(2)} kPa</span>
        <span>T {sol.tempMinC.toFixed(0)}…{sol.tempMaxC.toFixed(0)} °C</span>
        <span>Wind {sol.windMS.toFixed(1)} m/s</span>
        <span className={sol.tau > 5 ? 'warning' : undefined}>τ {sol.tau.toFixed(2)}</span>
      </section>
      {sol.label && <p className="shell-note">{sol.label}{sol.scenario ? ` · ${sol.scenario}` : ''}</p>}

      <p className="shell-note">
        Test walk: {TEST_WALK.speedMS} m/s, {TEST_WALK.slopeDeg}° uphill, {TEST_WALK.loadKg} kg carried, for{' '}
        {WALK_MIN / 60} h at {Math.round(points[1].metabolicW)} W.
      </p>

      <main className="strip-grid-layout">
        <StripChart title="O₂ LEFT" unit="g" data={series((p) => p.state.o2Kg * 1000)}
          min={0} max={FULL_SUIT.o2Kg * 1000} caption={caption} />
        <StripChart title="INSPIRED pCO₂" unit="kPa" data={series((p) => p.state.inspiredPCO2KPa)}
          min={0} max={8} warnAt={1} warnBelow={false} digits={2} caption={caption} />
        <StripChart title="BATTERY" unit="Wh" data={series((p) => p.state.batteryWh)}
          min={0} max={FULL_SUIT.batteryWh} caption={caption} />
        <StripChart title="CORE TEMP" unit="°C" data={series((p) => p.state.coreTempC)}
          min={34} max={40} warnAt={38} warnBelow={false} digits={1} caption={caption} />
      </main>

      <section className="shell-alerts" aria-live="polite" aria-label="Warnings">
        {warnings.length === 0
          ? <p className="dim">ALL SYSTEMS NOMINAL AT T+{WALK_MIN} MIN</p>
          : warnings.map((w) => <p key={w.code} className={w.level}>▲ {w.message}</p>)}
      </section>
    </div>
  );
}
