import { useEffect, useState } from 'react';
import type { DataPack } from './data/types';
import { Hud } from './ui/Hud';
import { Shell } from './ui/Shell';

export default function App() {
  const [pack, setPack] = useState<DataPack | null>(null);
  const [view, setView] = useState<'hud' | 'telemetry'>('hud');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/data/fake.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setPack)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="critical">Data pack failed to load: {error}</p>;
  if (!pack) return <p>LOADING DATA PACK…</p>;
  return (
    <>
      <nav className="view-nav" aria-label="Views">
        {(['hud', 'telemetry'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v.toUpperCase()}</button>
        ))}
      </nav>
      {view === 'hud' ? <Hud pack={pack} /> : <Shell pack={pack} />}
    </>
  );
}
