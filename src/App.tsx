import { useEffect, useState } from 'react';
import { loadGameData, type GameData } from './ui/gameData';
import { Hud } from './ui/Hud';
import { Shell } from './ui/Shell';

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'hud' | 'telemetry'>('hud');

  useEffect(() => {
    loadGameData().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="critical">Data pack failed to load: {error}</p>;
  if (!data) return <p>LOADING DATA PACK…</p>;
  return (
    <>
      <nav className="view-nav" aria-label="Views">
        {(['hud', 'telemetry'] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v.toUpperCase()}</button>
        ))}
      </nav>
      {view === 'hud' ? <Hud data={data} /> : <Shell data={data} />}
    </>
  );
}
