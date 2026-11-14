import { useEffect, useRef, useState } from 'react';
import { ORBIT_ZOOM_MS, OrbitZoom } from '../map';
import { CabinCruise } from './CabinCruise';
import { CABIN_S } from './cabin';
import { CrashSequence } from './CrashSequence';
import { LaunchScene } from './LaunchScene';
import { LAUNCH_MS } from './launch';
import { CRASH_MS, FLY_S } from './edl';
import { createIntroAudio, RADIO, readingMs, type IntroAudio, type IntroCue, type RadioLine } from './introAudio';
import { MarsGlobe } from './MarsGlobe';
import { METEOR_MS, MeteorStrike } from './MeteorStrike';
import { Rocket } from './Rocket';
import type { Orbit } from './orbit';
import { Satellite } from './Satellite';
import { CONTROLS, type Settings } from './settings';
import { SolarSystem } from './SolarSystem';
import './title.css';

export const TEAM_NAME = 'PerformativeLarper';

/**
 * The intro, one continuous sequence:
 * title (the solar system) → launch (lift-off from a coastal pad at dawn, up through the clouds to space)
 * → cruise (leaving Earth) → cabin (inside AER-1: the 203-day cruise as a time-lapse)
 * → meteor (a meteor strikes the engine) → fault (master alarm, Control radios to divert to Mars)
 * → crash (entry, parachute, retro-rockets and impact, played from the physics in edl.ts)
 * → locate (the suit's navigation finds you: orbit → Jezero → the crash site)
 * → wake (eyes shut while the 3D world loads underneath; they open once it is ready)
 * → door (the cabin hatch opens onto the live 3D world; a stored radio message says to find Perseverance)
 * → blur (dissolves into the game).
 */
type Phase = 'title' | 'launch' | 'cruise' | 'cabin' | 'meteor' | 'fault' | 'crash' | 'locate' | 'wake' | 'door' | 'blur';
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
  launch: { to: 'cruise', ms: LAUNCH_MS },
  cruise: { to: 'cabin', ms: 2600 },
  cabin: { to: 'meteor', ms: CABIN_S.lapse * 1000 }, // the time-lapse only: the meteor strike is the emergency
  meteor: { to: 'fault', ms: METEOR_MS }, // the 3D strike; the hit lands on the sound's bang at 1.1 s
  fault: { to: 'crash', ms: 11000, minMs: 5000, radio: RADIO.mayday, radioAt: 700 },
  crash: { to: 'locate', ms: CRASH_MS },
  locate: { to: 'wake', ms: ORBIT_ZOOM_MS },
  door: { to: 'blur', ms: 15500, minMs: 9000, radio: RADIO.rover, radioAt: 3800 },
};
const BLUR_MS = 1200;
/** Wake: the eyes stay shut at least this long, open once the 3D view has drawn, and stop waiting after WAKE_MAX_MS. */
const WAKE_MIN_MS = 1400;
const WAKE_MAX_MS = 9000;
const EYES_OPEN_MS = 1500;
/** Phases the intro sound has cues for (the crash cue is timed separately). */
const CUES: readonly IntroCue[] = ['meteor', 'fault', 'door']; // the engine rumble ('cruise') starts at the launch
/** The sound's crash cue is a 1.25 s roar then the bang; start it so the bang lands on the simulated impact. */
const CRASH_CUE_MS = Math.max(0, FLY_S * 1000 - 1250);

/** Title backdrop: 'solar' = the Sun with Earth and Mars as the main pair; 'photo' = the Apollo 17 Earth photo. */
const TITLE_BACKDROP = 'solar' as 'solar' | 'photo';
/** The hatch opens onto the live 3D world (true) or onto the Mastcam-Z photos (false). */
const LIVE_DOOR = true as boolean;

/** Has the game's 3D view drawn (a canvas outside the intro, and no "loading" placeholder)? */
function worldReady(): boolean {
  if (document.querySelector('.v-loading')) return false;
  return Array.from(document.querySelectorAll('canvas')).some((c) => !c.closest('.intro'));
}

// Satellites around Earth: two small ones and a long-truss station.
const ORBITS: { orbit: Orbit; big?: boolean }[] = [
  { orbit: { rx: 70, ry: 16, tiltDeg: 24, periodS: 24, phase: 0.45 } },
  { orbit: { rx: 82, ry: 26, tiltDeg: 14, periodS: 40, phase: 0.05 } },
  { orbit: { rx: 64, ry: 12, tiltDeg: 30, periodS: 32, phase: 0.7 }, big: true },
];
/** In solar mode Earth is a smaller globe, so the orbits shrink with it (the photo disc radius is 49.5vmin). */
const ORBIT_SCALE = TITLE_BACKDROP === 'solar' ? 30 / 49.5 : 1;

type Panel = 'menu' | 'settings' | 'quit';

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  /** Called when the game should mount underneath (the wake phase, or a skip), so it shows through. */
  onReveal: () => void;
  /** Called when the intro is fully gone. */
  onDone: () => void;
}

export function TitleScreen({ settings, onSettings, onReveal, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('title');
  const [panel, setPanel] = useState<Panel>('menu');
  const [quitTried, setQuitTried] = useState(false);
  const [radio, setRadio] = useState<RadioLine | null>(null);
  const [eyesOpen, setEyesOpen] = useState(false);
  const audio = useRef<IntroAudio | null>(null);
  const still = settings.reducedMotion;

  useEffect(() => {
    if (phase === 'blur') {
      audio.current?.stop(BLUR_MS / 1000);
      audio.current = null;
      const t = setTimeout(onDone, BLUR_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'wake') {
      // The game mounts now, under closed eyes, so its loading and first heavy frames happen in the dark.
      onReveal();
      const started = performance.now();
      let opened = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const open = () => {
        if (opened) return;
        opened = true;
        setEyesOpen(true);
        timers.push(setTimeout(() => setPhase('door'), EYES_OPEN_MS));
      };
      const poll = setInterval(() => {
        const t = performance.now() - started;
        if ((t >= WAKE_MIN_MS && worldReady()) || t >= WAKE_MAX_MS) open();
      }, 150);
      return () => { clearInterval(poll); timers.forEach(clearTimeout); };
    }
    const step = NEXT[phase];
    if (!step) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if ((CUES as readonly string[]).includes(phase)) audio.current?.cue(phase as IntroCue);
    if (phase === 'launch') audio.current?.cue('cruise');
    if (phase === 'crash') timers.push(setTimeout(() => audio.current?.cue('crash'), CRASH_CUE_MS));
    const started = performance.now();
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
    setPhase('launch');
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

  const modes = `${TITLE_BACKDROP === 'solar' ? ' solar-mode' : ''}${LIVE_DOOR ? ' live-door' : ''}${eyesOpen ? ' eyes-open' : ''}`;
  return (
    <div className={`intro phase-${phase}${still ? ' still' : ''}${modes}`} onClick={skip} role="dialog" aria-label="AER">
      {/* Space: the solar system (or Earth with satellites), the rocket, Mars */}
      <div className="space">
        <div className="stars" aria-hidden="true" />
        {TITLE_BACKDROP === 'solar' && <SolarSystem frozen={phase !== 'title'} still={still} />}
        <div className="earth-wrap" aria-hidden="true">
          {TITLE_BACKDROP === 'photo' && <>
            <img className="earth" src="/data/earth_apollo17.jpg" alt="" />
            <div className="earth-night" />
            <div className="earth-atmo" />
          </>}
          <span className="launch-flash" />
          {ORBITS.map((o, i) => <Satellite key={i} orbit={{ ...o.orbit, rx: o.orbit.rx * ORBIT_SCALE, ry: o.orbit.ry * ORBIT_SCALE }} big={o.big} still={still || phase !== 'title'} />)}
        </div>
        {/* Mars as a lit globe inside the same element, so its animations are unchanged. */}
        <div className="mars" aria-hidden="true">
          <MarsGlobe active={phase === 'cruise' || phase === 'meteor' || phase === 'fault' || phase === 'crash'} still={still} />
        </div>
        <Rocket className="rocket" />
        {/* Light round the rocket (launch glow, then the engine failing). Same box and motion as the rocket. */}
        <div className="rocket-fx" aria-hidden="true">
          <span className="rocket-glow" />
          <span className="engine-pop" />
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <span key={i} className={`spark s${i}`} />)}
        </div>
        <div className="meteor" aria-hidden="true" />
        <div className="meteor-hit" aria-hidden="true" />
        <div className="alarm-wash" aria-hidden="true" />
        <div className="impact" aria-hidden="true" />
      </div>

      {/* The meteor strike, in 3D; it keeps running through the fault (the mayday call). */}
      <MeteorStrike active={phase === 'meteor' || phase === 'fault'} alarm={phase === 'fault'} />

      {/* The launch from Earth, in 3D. */}
      <LaunchScene active={phase === 'launch'} />

      {/* Inside the cabin during the cruise, built at START so it is ready after the launch. */}
      <CabinCruise prepare={phase !== 'title'} active={phase === 'cabin'} />

      {/* Entry, parachute, retro failure and impact, played from the physics in edl.ts. */}
      <CrashSequence active={phase === 'crash'} />

      {/* Map: the locating shot (orbit → Jezero → the crash site), built during the cruise so it is ready in time. */}
      <OrbitZoom prepare={phase !== 'title'} active={phase === 'locate'} />

      {/* Door: the cabin hatch opens onto Jezero. With LIVE_DOOR the live 3D world shows through; otherwise the
          real Perseverance photos. */}
      <div className="door" aria-hidden={phase !== 'door'}>
        {!LIVE_DOOR && (
          <div className="door-view">
            <img src="/data/photos/landing_site_1.jpg" alt="" />
            <img src="/data/photos/landing_site_2.jpg" alt="" />
          </div>
        )}
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
        {!LIVE_DOOR && <p className="door-credit">View: Perseverance Mastcam-Z, Sol 4, near the landing site (NASA/JPL-Caltech/ASU)</p>}
      </div>

      {/* Wake: eyelids over the dark cabin while the 3D world loads; they open once it has drawn. */}
      <div className="wake" aria-hidden="true">
        <div className="eyelid top" />
        <div className="eyelid bottom" />
        <p className="wake-msg">SUIT REBOOT ▸ VITALS CHECK</p>
      </div>

      {radio && (
        <div className="radio" role="status" aria-live="polite">
          <p className="radio-from"><span className="radio-bars" aria-hidden="true"><i /><i /><i /><i /></span>{radio.from}</p>
          <p className="radio-text">{radio.text}</p>
        </div>
      )}

      {phase === 'fault' && <p className="fault-msg" role="alert">▲ MASTER ALARM · METEOR STRIKE · ENGINE FAILURE</p>}

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
        <p>{TITLE_BACKDROP === 'photo' ? 'Earth: Apollo 17 (NASA, AS17-148-22727)' : 'Solar system: schematic, not to scale'} · Mars: HiRISE, Jezero (NASA/JPL/UArizona, USGS) · Surface: HiRISE DTM in 3D</p>
      </div>

      {phase !== 'title' && phase !== 'blur' && <p className="intro-skip">CLICK TO SKIP</p>}
    </div>
  );
}
