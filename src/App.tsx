import { useCallback, useEffect, useState } from 'react';
import { loadGameData, type GameData } from './ui/gameData';
import { Hud } from './ui/Hud';
import { Shell } from './ui/Shell';
import { TitleScreen } from './ui/TitleScreen';

export default function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'hud' | 'telemetry'>('hud');
  // The title screen sits on top; the game mounts when the crash ends, so its clock starts then.
  const [showGame, setShowGame] = useState(false);
  const [showTitle, setShowTitle] = useState(true);
  const reveal = useCallback(() => setShowGame(true), []);
  const titleDone = useCallback(() => setShowTitle(false), []);

  useEffect(() => {
    loadGameData().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      {showGame && (
        <div className="game-enter">
          {error && <p className="critical">Data pack failed to load: {error}</p>}
          {!error && !data && <p>LOADING DATA PACK…</p>}
          {data && (
            <>
              <nav className="view-nav" aria-label="Views">
                {(['hud', 'telemetry'] as const).map((v) => (
                  <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v.toUpperCase()}</button>
                ))}
              </nav>
              {view === 'hud' ? <Hud data={data} /> : <Shell data={data} />}
            </>
          )}
        </div>
      )}
      {showTitle && <TitleScreen onReveal={reveal} onDone={titleDone} />}
    </>
  );
}
