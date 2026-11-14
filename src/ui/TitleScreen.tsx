import { useEffect, useState } from 'react';
import './title.css';

export const TEAM_NAME = 'PerformativeLarper';

/** title → crash (descent and impact) → blur (title dissolves into the game) → done. */
type Phase = 'title' | 'crash' | 'blur';
const CRASH_MS = 3300;
const BLUR_MS = 1100;

interface Props {
  /** Called when the blur starts, so the game can mount underneath and show through. */
  onReveal: () => void;
  /** Called when the title screen is fully gone. */
  onDone: () => void;
}

/** Title screen. START plays the crash into Mars, then blurs out into the game. */
export function TitleScreen({ onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('title');

  useEffect(() => {
    if (phase === 'crash') {
      const t = setTimeout(() => { setPhase('blur'); onReveal(); }, CRASH_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'blur') {
      const t = setTimeout(onDone, BLUR_MS);
      return () => clearTimeout(t);
    }
  }, [phase, onReveal, onDone]);

  const start = () => {
    // Respect reduced-motion settings: skip straight to the game.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onReveal(); onDone(); return; }
    setPhase('crash');
  };
  const skip = () => { if (phase === 'crash') { setPhase('blur'); onReveal(); } };

  return (
    <div className={`title-screen phase-${phase}`} onClick={skip} role="dialog" aria-label="AER title screen">
      <div className="title-stage">
        <div className="stars" aria-hidden="true" />
        <div className="planet" aria-hidden="true" />
        <svg className="lander" viewBox="0 0 60 90" aria-hidden="true">
          <path className="lander-flame" d="M18 62 L30 90 L42 62 Z" />
          <path className="lander-shield" d="M10 58 Q30 70 50 58 Z" />
          <path className="lander-body" d="M18 58 L22 22 L30 10 L38 22 L42 58 Z" />
          <circle className="lander-window" cx="30" cy="32" r="4" />
        </svg>
        <div className="impact-flash" aria-hidden="true" />
      </div>

      <div className="title-content">
        <p className="title-kicker">TEAM {TEAM_NAME.toUpperCase()} · NASA SPACE APPS 2026</p>
        <h1 className="title-word">AER</h1>
        <p className="title-sub">ATMOSPHERIC EQUILIBRIUM &amp; RECOVERY</p>
        <p className="title-tag">Plan a Marswalk you can survive.</p>
        <button className="title-start" onClick={start} autoFocus>START</button>
      </div>

      <div className="title-meta">
        <p>Simulated astronaut · real archived NASA data · not live</p>
        <p>Surface: HiRISE, Jezero Crater (NASA/JPL/UArizona, USGS)</p>
      </div>

      {phase === 'crash' && <p className="title-skip">CLICK TO SKIP</p>}
    </div>
  );
}
