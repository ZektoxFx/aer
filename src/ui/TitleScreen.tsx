import { useEffect, useState } from 'react';
import './title.css';

export const TEAM_NAME = 'PerformativeLarper';

/**
 * The intro, one continuous sequence:
 * title (Earth) → cruise (leaving Earth) → fault (engine alarm, tumbling) → crash (Mars rushes up, impact)
 * → pov (the astronaut comes to at the wreck) → blur (dissolves into the game).
 */
type Phase = 'title' | 'cruise' | 'fault' | 'crash' | 'pov' | 'blur';
const NEXT: Partial<Record<Phase, { to: Phase; ms: number }>> = {
  cruise: { to: 'fault', ms: 2600 },
  fault: { to: 'crash', ms: 2200 },
  crash: { to: 'pov', ms: 2000 },
  pov: { to: 'blur', ms: 5600 },
};
const BLUR_MS = 1200;

interface Props {
  /** Called when the blur starts, so the game can mount underneath and show through. */
  onReveal: () => void;
  /** Called when the intro is fully gone. */
  onDone: () => void;
}

export function TitleScreen({ onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('title');

  useEffect(() => {
    const step = NEXT[phase];
    if (step) {
      const t = setTimeout(() => {
        setPhase(step.to);
        if (step.to === 'blur') onReveal();
      }, step.ms);
      return () => clearTimeout(t);
    }
    if (phase === 'blur') {
      const t = setTimeout(onDone, BLUR_MS);
      return () => clearTimeout(t);
    }
  }, [phase, onReveal, onDone]);

  const start = () => {
    // Reduced motion: skip the whole intro.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onReveal(); onDone(); return; }
    setPhase('cruise');
  };
  const skip = () => {
    if (phase !== 'title' && phase !== 'blur') { setPhase('blur'); onReveal(); }
  };

  return (
    <div className={`intro phase-${phase}`} onClick={skip} role="dialog" aria-label="AER intro">
      {/* Space: Earth, the rocket, Mars */}
      <div className="space">
        <div className="stars" aria-hidden="true" />
        <img className="earth" src="/data/earth_apollo17.jpg" alt="" aria-hidden="true" />
        <div className="mars" aria-hidden="true" />
        <svg className="rocket" viewBox="0 0 40 100" aria-hidden="true">
          <path className="rocket-flame" d="M14 78 L20 100 L26 78 Z" />
          <path className="rocket-fin" d="M10 60 L2 80 L12 76 Z M30 60 L38 80 L28 76 Z" />
          <path className="rocket-body" d="M12 78 L12 30 Q20 4 28 30 L28 78 Z" />
          <rect className="rocket-band" x="12" y="54" width="16" height="5" />
          <circle className="rocket-window" cx="20" cy="38" r="4" />
          <path className="rocket-smoke" d="M20 80 q-6 10 0 20 q6 10 0 20" />
        </svg>
        <div className="alarm-wash" aria-hidden="true" />
        <div className="impact" aria-hidden="true" />
      </div>

      {/* POV: the astronaut wakes at the wreck */}
      <div className="pov" aria-hidden={phase !== 'pov'}>
        <img className="pov-scene" src="/data/crashed_lander_aer1.jpg" alt="The crashed AER-1 lander on the Martian surface" />
        <div className="pov-visor" />
        <div className="eyelid top" />
        <div className="eyelid bottom" />
        <div className="pov-hud">
          <p>SUIT PRESSURE ········ OK</p>
          <p>O₂ ··················· OK</p>
          <p className="alert">LANDER AER-1 ········ DESTROYED</p>
          <p className="alert">RADIO ················ NO SIGNAL</p>
        </div>
        <p className="ai-mark">AER SIMULATION // AI GENERATED ASSET</p>
      </div>

      {phase === 'fault' && (
        <p className="fault-msg" role="alert">▲ MASTER ALARM · DESCENT ENGINE FAULT</p>
      )}

      <div className="title-content">
        <p className="title-kicker">TEAM {TEAM_NAME.toUpperCase()} · NASA SPACE APPS 2026</p>
        <h1 className="title-word">AER</h1>
        <p className="title-sub">ATMOSPHERIC EQUILIBRIUM &amp; RECOVERY</p>
        <p className="title-tag">Plan a Marswalk you can survive.</p>
        <button className="title-start" onClick={start} autoFocus>START</button>
      </div>

      <div className="title-meta">
        <p>Simulated astronaut · real archived NASA data · not live</p>
        <p>Earth: Apollo 17 (NASA, AS17-148-22727) · Mars: HiRISE, Jezero (NASA/JPL/UArizona, USGS)</p>
      </div>

      {phase !== 'title' && phase !== 'blur' && <p className="intro-skip">CLICK TO SKIP</p>}
    </div>
  );
}
