import { useEffect, useRef, useState } from 'react';
import { createIntroAudio, RADIO, readingMs, type IntroAudio, type RadioLine } from './introAudio';
import { Rocket } from './Rocket';
import type { Orbit } from './orbit';
import { Satellite } from './Satellite';
import { CONTROLS, type Settings } from './settings';
import './title.css';

import { TEAM_NAME } from './team';
import { Credits } from './Credits';

export { TEAM_NAME };

/**
 * The intro, one continuous sequence:
 * title (Earth) → cruise (leaving Earth) → meteor (a meteor strikes the engine) → fault (master alarm, Control radios
 * to divert to Mars) → crash (Mars rushes up, impact) → door (the cabin hatch opens onto Jezero, the astronaut looks
 * around; a stored radio message says to find Perseverance) → blur (dissolves into the game).
 */
type Phase = 'title' | 'cruise' | 'meteor' | 'fault' | 'crash' | 'door' | 'blur';
interface Step {
  to: Phase;
  /** Longest the phase lasts (a radio call still talking is cut off). */
  ms: number;
  /** A radio call starts `radioAt` ms into the phase; the phase then ends when it finishes, but not before `minMs`. */
  radio?: RadioLine;
  radioAt?: number;
  minMs?: number;
}
const NEXT: Partial<Record<Phase, Step>> = {
  cruise: { to: 'meteor', ms: 2600 },
  meteor: { to: 'fault', ms: 1700 },
  fault: { to: 'crash', ms: 11000, minMs: 5000, radio: RADIO.mayday, radioAt: 700 },
  crash: { to: 'door', ms: 2200 },
  door: { to: 'blur', ms: 15500, minMs: 9000, radio: RADIO.rover, radioAt: 3800 },
};
const BLUR_MS = 1200;

// Satellites around Earth: two small ones and a long-truss station.
// Earth sits in the lower-right corner, so the orbits are tilted to swing up into view on its left.
const ORBITS: { orbit: Orbit; big?: boolean }[] = [
  { orbit: { rx: 70, ry: 16, tiltDeg: 24, periodS: 24, phase: 0.45 } },
  { orbit: { rx: 82, ry: 26, tiltDeg: 14, periodS: 40, phase: 0.05 } },
  { orbit: { rx: 64, ry: 12, tiltDeg: 30, periodS: 32, phase: 0.7 }, big: true },
];

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
  const [credits, setCredits] = useState(false);
  const [quitTried, setQuitTried] = useState(false);
  const [radio, setRadio] = useState<RadioLine | null>(null);
  const audio = useRef<IntroAudio | null>(null);
  const still = settings.reducedMotion;

  useEffect(() => {
    const step = NEXT[phase];
    if (phase === 'blur') {
      audio.current?.stop(BLUR_MS / 1000);
      audio.current = null;
      const t = setTimeout(onDone, BLUR_MS);
      return () => clearTimeout(t);
    }
    if (!step) return;
    if (phase !== 'title') audio.current?.cue(phase as Exclude<Phase, 'title' | 'blur'>);
    const started = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let over = false;
    const next = () => {
      if (over) return;
      over = true;
      setPhase(step.to);
      if (step.to === 'blur') onReveal();
    };
    timers.push(setTimeout(next, step.ms));
    const line = step.radio;
    if (line) {
      // Leave the phase once the call ends (and the phase has run its minimum), with a beat of silence after.
      const afterCall = () => {
        if (over) return;
        timers.push(setTimeout(next, Math.max(700, (step.minMs ?? 0) - (performance.now() - started))));
      };
      timers.push(setTimeout(() => {
        if (over) return;
        setRadio(line);
        if (audio.current) audio.current.radio(line.text, afterCall);
        else timers.push(setTimeout(afterCall, readingMs(line.text)));
      }, step.radioAt ?? 0));
    }
    return () => { over = true; timers.forEach(clearTimeout); setRadio(null); };
  }, [phase, onReveal, onDone]);

  // Leaving the intro any other way (unmount) silences it.
  useEffect(() => () => { audio.current?.stop(0.2); audio.current = null; }, []);

  const start = () => {
    const osReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (settings.skipIntro || settings.reducedMotion || osReduced) { onReveal(); onDone(); return; }
    if (settings.sound) audio.current = createIntroAudio(); // made on the click, so the browser allows sound
    setPhase('cruise');
  };
  const skip = () => {
    if (phase !== 'title' && phase !== 'blur') {
      audio.current?.stop(0.3);
      audio.current = null;
      setPhase('blur');
      onReveal();
    }
  };
  const quit = () => {
    // Browsers only let a page close tabs that a script opened, so this usually does nothing.
    window.close();
    setQuitTried(true);
  };
  const toggle = (k: keyof Settings) => onSettings({ ...settings, [k]: !settings[k] });

  return (
    <div className={`intro phase-${phase}${still ? ' still' : ''}`} onClick={skip} role="dialog" aria-label="AER">
      {/* Space: Earth with satellites, the rocket, Mars */}
      <div className="space">
        <div className="stars" aria-hidden="true" />
        <div className="earth-wrap" aria-hidden="true">
          <img className="earth" src="/data/earth_apollo17.jpg" alt="" />
          <div className="earth-night" />
          <div className="earth-atmo" />
          {ORBITS.map((o, i) => <Satellite key={i} orbit={o.orbit} big={o.big} still={still || phase !== 'title'} />)}
        </div>
        <div className="mars" aria-hidden="true" />
        <Rocket className="rocket" />
        <div className="meteor" aria-hidden="true" />
        <div className="meteor-hit" aria-hidden="true" />
        <div className="alarm-wash" aria-hidden="true" />
        <div className="impact" aria-hidden="true" />
      </div>

      {/* Door: the cabin hatch opens onto Jezero and the astronaut looks around (real Perseverance photos). */}
      <div className="door" aria-hidden={phase !== 'door'}>
        <div className="door-view">
          <img src="/data/photos/landing_site_1.jpg" alt="" />
          <img src="/data/photos/landing_site_2.jpg" alt="" />
        </div>
        <div className="door-glare" />
        <div className="cabin">
          <div className="hatch left"><span>AER-1</span></div>
          <div className="hatch right"><span>HATCH 2</span></div>
          <div className="cabin-wall" />
          <div className="cabin-light" />
        </div>
        <div className="pov-visor" />
        <p className="hatch-msg">HATCH RELEASE ▸ CABIN DEPRESSURIZED</p>
        <div className="pov-hud">
          <p>SUIT PRESSURE ········ OK</p>
          <p>O₂ ··················· OK</p>
          <p className="alert">LANDER AER-1 ········ WRECKED</p>
          <p className="alert">SHIP RADIO ·········· NO SIGNAL</p>
          <p className="goal">OBJECTIVE ▸ FIND PERSEVERANCE · ~2 KM W</p>
        </div>
        <p className="door-credit">View: Perseverance Mastcam-Z, Sol 4, near the landing site (NASA/JPL-Caltech/ASU)</p>
      </div>

      {radio && (
        <div className="radio" role="status" aria-live="polite">
          <p className="radio-from"><span className="radio-bars" aria-hidden="true"><i /><i /><i /><i /></span>{radio.from}</p>
          <p className="radio-text">{radio.text}</p>
        </div>
      )}

      {(phase === 'fault' || phase === 'crash') && <p className="fault-msg" role="alert">▲ MASTER ALARM · METEOR STRIKE · ENGINE FAILURE</p>}

      <div className="title-content">
        <p className="title-kicker">TEAM {TEAM_NAME.toUpperCase()} · NASA SPACE APPS 2026</p>
        <h1 className="title-word">AER</h1>
        <p className="title-sub">ATMOSPHERIC EQUILIBRIUM &amp; RECOVERY</p>
        <p className="title-tag">Plan a Marswalk you can survive.</p>

        {panel === 'menu' && (
          <nav className="title-menu" aria-label="Main menu">
            <button className="menu-btn primary" onClick={start} autoFocus>START</button>
            <button className="menu-btn" onClick={() => setPanel('settings')}>SETTINGS</button>
            <button className="menu-btn" onClick={() => setCredits(true)}>CREDITS</button>
            <button className="menu-btn" onClick={() => { setQuitTried(false); setPanel('quit'); }}>QUIT</button>
          </nav>
        )}

        {panel === 'settings' && (
          <section className="menu-panel" aria-label="Settings">
            <h2>SETTINGS</h2>
            <label className="opt"><input type="checkbox" checked={settings.skipIntro} onChange={() => toggle('skipIntro')} /> Skip the intro on START</label>
            <label className="opt"><input type="checkbox" checked={settings.reducedMotion} onChange={() => toggle('reducedMotion')} /> Reduce animations</label>
            <label className="opt"><input type="checkbox" checked={settings.largeText} onChange={() => toggle('largeText')} /> Larger interface</label>
            <label className="opt"><input type="checkbox" checked={settings.sound} onChange={() => toggle('sound')} /> Intro sound and radio voice</label>
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
        <p>Earth: Apollo 17 (NASA, AS17-148-22727) · Mars: HiRISE, Jezero (NASA/JPL/UArizona, USGS) · Surface: Perseverance Mastcam-Z</p>
      </div>

      {phase !== 'title' && phase !== 'blur' && <p className="intro-skip">CLICK TO SKIP</p>}
      {credits && <Credits onClose={() => setCredits(false)} />}
    </div>
  );
}
