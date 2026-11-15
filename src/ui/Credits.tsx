import { useEffect, useRef, useState } from 'react';
import type { CreditsFile } from '../data/files';
import { TEAM, TEAM_NAME } from './team';
import './credits.css';

// The credits scene: a slow roll over a starfield with Mars rising, like a film's end titles. The team, then every
// NASA data source and image credit (from the Data role's credits.json), the science behind the suit, what is game
// fiction, AI use, and the no-affiliation line. Shown after "EARTH HEARD YOU", and from the title screen and game menu.

/** Roll speed, pixels per second. */
const SPEED = 38;

/** Suit and life-support references used by the simulation (also in SUBMISSION.md). */
const SUIT_SCIENCE = [
  'NASA Life Support Baseline Values and Assumptions Document (NASA/TP-2015-218570/REV2, 2022)',
  'Apollo Portable Life Support System documents (Apollo Lunar Surface Journal)',
  'Apollo metabolic rates (NASA TN D-7883)',
  'NASA ISS life-support baselines (NTRS 20120015343)',
  'MOXIE oxygen-from-Mars results (NASA)',
  'Solar arrays and dust: Lorenz et al. 2021, Planetary and Space Science',
];

const BUILT_WITH = 'TypeScript · React · Vite · three.js · Vitest · Python · NumPy · SciPy · Pillow · tifffile · Vercel';

export function Credits({ onClose, won = false }: { onClose: () => void; won?: boolean }) {
  const [credits, setCredits] = useState<CreditsFile | null>(null);
  const roll = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    let live = true;
    fetch('/data/credits.json').then((r) => (r.ok ? r.json() : null)).then((c: CreditsFile | null) => { if (live) setCredits(c); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Auto-scroll (skipped with reduced motion: the list just scrolls by hand). Scrolling by hand pauses it briefly.
  useEffect(() => {
    const el = roll.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let last = performance.now(), hold = 0, pos = el.scrollTop;
    let raf = requestAnimationFrame(function step(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (Math.abs(el.scrollTop - pos) > 2) hold = 2.5; // the player scrolled
      if (hold > 0) hold -= dt;
      else if (!pausedRef.current) el.scrollTop += SPEED * dt;
      pos = el.scrollTop;
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // While the credits are up, they own the keyboard (the game underneath doesn't walk, pause or open the pack).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
      if (e.key !== 'Tab' && !e.key.startsWith('Arrow') && !e.key.startsWith('Page')) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  return (
    <div className="credits" role="dialog" aria-modal="true" aria-label="Credits">
      <div className="credits-sky" aria-hidden="true" />
      <div className="credits-mars" aria-hidden="true" />
      <div className="credits-roll" ref={roll} tabIndex={0}>
        <div className="credits-spacer" />

        {won && <p className="credits-kicker">EARTH HEARD YOU · HELP IS ON ITS WAY</p>}
        <h1 className="credits-title">AER</h1>
        <p className="credits-sub">ATMOSPHERIC EQUILIBRIUM &amp; RECOVERY</p>
        <p className="credits-line">NASA Space Apps Challenge 2026 · Interplanetary Survival Guide: Martian Map</p>

        <section>
          <h2>TEAM {TEAM_NAME.toUpperCase()}</h2>
          <dl className="credits-team">
            {TEAM.map((m) => (
              <div key={m.role}><dt>{m.role}</dt><dd>{m.name}</dd></div>
            ))}
          </dl>
        </section>

        <section>
          <h2>NASA MISSION DATA</h2>
          {credits?.intro && <p className="credits-note">{credits.intro}</p>}
          {credits ? (
            <ul className="credits-sources">
              {credits.dataSources.map((d) => {
                const title = [d.mission, d.instrument].filter((x) => x && x !== '-').join(' · ') || d.product;
                return (
                <li key={d.what}>
                  <span className="credits-what">{d.what}</span>
                  <b>{title}</b>
                  <span>{d.product !== title ? `${d.product} · ` : ''}{d.provider}</span>
                  <span className="credits-cite">{d.citation} · {d.credit}</span>
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="credits-note">HiRISE · THEMIS · Perseverance MEDA, Mastcam-Z and SuperCam · Mars Relay Network · NASA TM-103623</p>
          )}
        </section>

        {credits && (
          <section>
            <h2>IMAGES</h2>
            <ul className="credits-plain">{credits.imageCredits.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        )}

        <section>
          <h2>SUIT SCIENCE</h2>
          <ul className="credits-plain">{SUIT_SCIENCE.map((x) => <li key={x}>{x}</li>)}</ul>
        </section>

        <section>
          <h2>WHAT IS REAL, WHAT IS FICTION</h2>
          {credits?.fiction && <p className="credits-note">{credits.fiction}</p>}
          <p className="credits-note">The game's dust storm is stronger than Jezero's real January 2022 storm. Repair recipes, salvage and supply amounts are design values.</p>
        </section>

        <section>
          <h2>AI USE</h2>
          <ul className="credits-plain">
            {(credits?.aiDisclosure ?? []).map((x) => <li key={x}>{x}</li>)}
            <li>Sound effects are synthesized in the browser; the radio voice is the browser's built-in speech.</li>
          </ul>
        </section>

        <section>
          <h2>BUILT WITH</h2>
          <p className="credits-note">{BUILT_WITH}</p>
        </section>

        {credits?.noAffiliation && <p className="credits-fine">{credits.noAffiliation}</p>}
        <p className="credits-fine">All data is archived and bundled with the app. Nothing is live.</p>

        <p className="credits-end">THANK YOU FOR PLAYING</p>
        <p className="credits-line">From one walk today to the first human missions.</p>
        <div className="credits-spacer short" />
      </div>

      <div className="credits-bar">
        <button className="credits-btn" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? '▶ PLAY' : '❚❚ PAUSE'}</button>
        <button className="credits-btn" onClick={onClose} autoFocus>CLOSE ✕</button>
      </div>
    </div>
  );
}
