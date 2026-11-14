import { useEffect, useState } from 'react';
import type { DataPack } from './data/types';
import { FULL_SUIT, simulate } from './sim/simulate';

// Placeholder shell: proves data loading and the sim are wired. The UI role replaces this.
export default function App() {
  const [pack, setPack] = useState<DataPack | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/data/fake.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setPack)
      .catch((e: Error) => setError(e.message));
  }, []);

  const sol = pack?.sols[0];
  const result = sol
    ? simulate(FULL_SUIT, { pressureKPa: sol.pressureKPa, tempC: sol.tempMinC, windMS: sol.windMS, tau: sol.tau },
        { speedMS: 1, slopeDeg: 5, loadKg: 10 }, 60)
    : null;

  return (
    <main>
      <h1>AER // SYSTEM CHECK</h1>
      {error && <p className="critical">Data pack failed to load: {error}</p>}
      {pack && <p>Area: {pack.area.name} · Source: {pack.source}</p>}
      {result && (
        <>
          <p>1 h test walk at {Math.round(result.metabolicW)} W:</p>
          <ul>
            <li>O₂ left: {(result.state.o2Kg * 1000).toFixed(0)} g</li>
            <li>LiOH left: {(result.state.liohKg * 1000).toFixed(0)} g</li>
            <li>Water left: {result.state.waterKg.toFixed(2)} kg</li>
            <li>Battery: {result.state.batteryWh.toFixed(0)} Wh</li>
            <li>Inspired pCO₂: {result.state.inspiredPCO2KPa.toFixed(2)} kPa</li>
          </ul>
          {result.warnings.map((w) => <p key={w.code} className={w.level}>{w.message}</p>)}
        </>
      )}
    </main>
  );
}
