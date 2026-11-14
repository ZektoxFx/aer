import { useEffect, useRef, useState } from 'react';
import { EarthGlobe } from './EarthGlobe';
import { MarsGlobe } from './MarsGlobe';
import { SolarSystem } from './SolarSystem';
import { Rocket } from './Rocket';
import type { Orbit } from './orbit';
import { Satellite } from './Satellite';
import { CONTROLS, type Settings } from './settings';
import './title.css';

export const TEAM_NAME = 'PerformativeLarper';

/**
 * The intro, one continuous sequence:
 * title (Earth) → cruise (leaving Earth) → fault (engine alarm, tumbling) → crash (Mars rushes up, impact)
 * → pov (the astronaut comes to at the wreck) → reveal (LOCAL DRAFT: the camera pulls back to third person)
 * → blur (dissolves into the game).
 */
type Phase = 'title' | 'cruise' | 'fault' | 'crash' | 'pov' | 'reveal' | 'blur';
const NEXT: Partial<Record<Phase, { to: Phase; ms: number }>> = {
  cruise: { to: 'fault', ms: 2600 },
  fault: { to: 'crash', ms: 2200 },
  crash: { to: 'pov', ms: 2000 },
  pov: { to: 'reveal', ms: 5600 },
  reveal: { to: 'blur', ms: 3300 }, // LOCAL DRAFT: plays the 3 s pull-back video
};
const BLUR_MS = 1200;

// Satellites around Earth: two small ones and a long-truss station.
// Earth sits in the lower-right corner, so the orbits are tilted to swing up into view on its left.
const ORBITS: { orbit: Orbit; big?: boolean }[] = [
  { orbit: { rx: 70, ry: 16, tiltDeg: 24, periodS: 24, phase: 0.45 } },
  { orbit: { rx: 82, ry: 26, tiltDeg: 14, periodS: 40, phase: 0.05 } },
  { orbit: { rx: 64, ry: 12, tiltDeg: 30, periodS: 32, phase: 0.7 }, big: true },
];

/**
 * LOCAL DRAFT: the scene after the landing. 'lowpoly' = Blender render of the REAL terrain round the AER-1 cabin
 * (Data pack elevation + HiRISE tint) with the low-poly cabin, descent core and astronaut
 * (04_3d_assets/aer_landed/build_landed.py). Switch back to 'photo' for the original AI image.
 */
const LANDED_SCENES = {
  lowpoly: { src: '/intro/landed_pov.jpg', alt: 'Through the visor: the crashed AER-1 cabin and wreckage at Jezero, low-poly render' },
  photo: { src: '/data/crashed_lander_aer1.jpg', alt: 'The crashed AER-1 lander on the Martian surface' },
};
const LANDED_SCENE = LANDED_SCENES.lowpoly;

/** LOCAL DRAFT: title backdrop. 'solar' = Sun in the middle with Earth and Mars as the main pair; 'earth' = the big Earth globe. */
const TITLE_BACKDROP: 'solar' | 'earth' = 'solar';

/** LOCAL DRAFT: the globe radius (30vmin) over the old photo disc radius (49.5vmin). */
const ORBIT_SCALE = 30 / 49.5;

type Panel = 'menu' | 'settings' | 'quit';

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  /** Called when the blur starts, so the game can mount underneath and show through. */
  onReveal: () => void;
  /** Called when the intro is fully gone. */
  onDone: () => void;
}

export function TitleScreen({ settings, onSettings, onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('title');
  const [panel, setPanel] = useState<Panel>('menu');
  const [quitTried, setQuitTried] = useState(false);
  const still = settings.reducedMotion;
  const pullback = useRef<HTMLVideoElement>(null);

  // LOCAL DRAFT: the camera pull-back (Blender render, first frame = the eyes-open view) plays in the reveal phase.
  useEffect(() => {
    const v = pullback.current;
    if (phase === 'reveal' && v) { v.currentTime = 0; v.play().catch(() => {}); }
  }, [phase]);

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
    const osReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (settings.skipIntro || settings.reducedMotion || osReduced) { onReveal(); onDone(); return; }
    setPhase('cruise');
  };
  const skip = () => {
    if (phase !== 'title' && phase !== 'blur') { setPhase('blur'); onReveal(); }
  };
  const quit = () => {
    // Browsers only let a page close tabs that a script opened, so this usually does nothing.
    window.close();
    setQuitTried(true);
  };
  const toggle = (k: keyof Settings) => onSettings({ ...settings, [k]: !settings[k] });

  return (
    <div className={`intro phase-${phase}${still ? ' still' : ''}${TITLE_BACKDROP === 'solar' ? ' solar-mode' : ''}`} onClick={skip} role="dialog" aria-label="AER">
      {/* Space: Earth with satellites, the rocket, Mars */}
      <div className="space">
        <div className="stars" aria-hidden="true" />
        {TITLE_BACKDROP === 'solar' && <SolarSystem frozen={phase !== 'title'} still={still} />}
        <div className="earth-wrap" aria-hidden="true">
          {/* LOCAL DRAFT: 3D globe (EarthGlobe) instead of the flat photo + CSS night/atmosphere layers. */}
          {TITLE_BACKDROP === 'earth' && <EarthGlobe still={still} />}
          {/* LOCAL DRAFT: the launch flare where the rocket leaves Earth. */}
          <span className="launch-flash" />
          {/* LOCAL DRAFT: Earth is smaller and centred now, so the orbits shrink with it (old disc radius 49.5vmin). */}
          {ORBITS.map((o, i) => <Satellite key={i} orbit={{ ...o.orbit, rx: o.orbit.rx * ORBIT_SCALE, ry: o.orbit.ry * ORBIT_SCALE }} big={o.big} still={still || phase !== 'title'} />)}
        </div>
        {/* LOCAL DRAFT: Mars as a lit globe inside the same element, so the landing animation is unchanged. */}
        <div className="mars" aria-hidden="true">
          <MarsGlobe active={phase === 'cruise' || phase === 'fault' || phase === 'crash'} still={still} />
        </div>
        <Rocket className="rocket" />
        {/* LOCAL DRAFT: light round the rocket (launch glow, then the engine failing). Same box and motion as the rocket. */}
        <div className="rocket-fx" aria-hidden="true">
          <span className="rocket-glow" />
          <span className="engine-pop" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className={`spark s${i}`} />)}
        </div>
        <div className="alarm-wash" aria-hidden="true" />
        <div className="impact" aria-hidden="true" />
      </div>

      {/* POV: the astronaut wakes at the wreck */}
      <div className="pov" aria-hidden={phase !== 'pov' && phase !== 'reveal'}>
        <img className="pov-scene" src={LANDED_SCENE.src} alt={LANDED_SCENE.alt} />
        {LANDED_SCENE === LANDED_SCENES.lowpoly && (
          <video ref={pullback} className="pov-reveal" src="/intro/landed_pullback.mp4" muted playsInline preload="auto" aria-hidden="true" />
        )}
        {/* LOCAL DRAFT: dust drifting across the scene (CSS only; the photo and timing are unchanged). */}
        <div className="pov-dust" />
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

      {phase === 'fault' && <p className="fault-msg" role="alert">▲ MASTER ALARM · DESCENT ENGINE FAULT</p>}

      <div className="title-content">
        <p className="title-kicker">TEAM {TEAM_NAME.toUpperCase()} · NASA SPACE APPS 2026</p>
        <h1 className="title-word">AER</h1>
        <p className="title-sub">ATMOSPHERIC EQUILIBRIUM &amp; RECOVERY</p>
        <p className="title-tag">Plan a Marswalk you can survive.</p>

        {panel === 'menu' && (
          <nav className="title-menu" aria-label="Main menu">
            <button className="menu-btn primary" onClick={start} autoFocus>START</button>
            <button className="menu-btn" onClick={() => setPanel('settings')}>SETTINGS</button>
            <button className="menu-btn" onClick={() => { setQuitTried(false); setPanel('quit'); }}>QUIT</button>
          </nav>
        )}

        {panel === 'settings' && (
          <section className="menu-panel" aria-label="Settings">
            <h2>SETTINGS</h2>
            <label className="opt"><input type="checkbox" checked={settings.skipIntro} onChange={() => toggle('skipIntro')} /> Skip the intro on START</label>
            <label className="opt"><input type="checkbox" checked={settings.reducedMotion} onChange={() => toggle('reducedMotion')} /> Reduce animations</label>
            <label className="opt"><input type="checkbox" checked={settings.largeText} onChange={() => toggle('largeText')} /> Larger interface</label>
            <h3>CONTROLS</h3>
            <dl className="controls-list">
              {CONTROLS.map((c) => <div key={c.keys}><dt>{c.keys}</dt><dd>{c.action}</dd></div>)}
            </dl>
            <p className="panel-note">Settings are saved in this browser.</p>
            <button className="menu-btn" onClick={() => setPanel('menu')} autoFocus>BACK</button>
          </section>
        )}

        {panel === 'quit' && (
          <section className="menu-panel" aria-label="Quit">
            <h2>QUIT AER?</h2>
            {quitTried
              ? <p>Your browser kept this tab open. You can close the tab now.</p>
              : <p>Leave the simulation and close this tab.</p>}
            <div className="panel-actions">
              {!quitTried && <button className="menu-btn primary" onClick={quit}>QUIT</button>}
              <button className="menu-btn" onClick={() => setPanel('menu')} autoFocus>BACK</button>
            </div>
          </section>
        )}
      </div>

      <div className="title-meta">
        <p>Simulated astronaut · real archived NASA data · not live</p>
        <p>Earth: Apollo 17 (NASA, AS17-148-22727) · Mars: HiRISE, Jezero (NASA/JPL/UArizona, USGS)</p>
      </div>

      {phase !== 'title' && phase !== 'blur' && <p className="intro-skip">CLICK TO SKIP</p>}
    </div>
  );
}
