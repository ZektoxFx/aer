// Background music: the title and storm themes are original, composed in code (tools/audio/compose.py); the others
// are CC0 tracks from OpenGameArt. Levelled and encoded by tools/audio/bake_audio.py (public/audio/, credits in
// credits.json audioCredits). Streamed with <audio> elements (a long track decoded into memory would take
// ~90 MB), crossfaded between tracks, and crossfaded into itself to loop without a gap.
//
// Two screens ask for music: the title screen (and its intro) and the game. While the title screen holds its claim,
// its choice wins, so the game, which mounts under the intro, starts its music only once the intro is gone.

import type { StormPhase } from '../sim/types';

export type MusicTrack = 'title' | 'explore' | 'storm' | 'won' | 'lost';
export type MusicOwner = 'title' | 'game';

export const MUSIC_FILES: Record<MusicTrack, string> = {
  title: '/audio/title.mp3',
  explore: '/audio/explore.mp3',
  storm: '/audio/storm.mp3',
  won: '/audio/won.mp3',
  lost: '/audio/lost.mp3',
};
/** Tracks that loop; the endings play once. */
const LOOPS: Record<MusicTrack, boolean> = { title: true, explore: true, storm: true, won: false, lost: false };
/** Music sits under the game's sound; the files are levelled to -20 LUFS. */
const LEVEL = 0.42;
/** While the game holds (menus, cards), the music dips this much. */
const DUCK = 0.55;
const LOOP_XFADE_S = 4;
const TICK_MS = 50;

/** Storm strength (cover.ts stormStrength, 0..1) at which the storm music takes over. */
export const STORM_MUSIC_AT = 0.25;

/**
 * The game's music for its state: the ending's track; the storm track from the storm warning until the peak is over
 * (or whenever the air is that dusty); exploring otherwise.
 */
export function gameTrack(ending: 'won' | 'lost' | null, storm: number, phase: StormPhase = 'none'): MusicTrack {
  if (ending) return ending;
  const stormy = phase === 'warning' || phase === 'building' || phase === 'peak' || storm >= STORM_MUSIC_AT;
  return stormy ? 'storm' : 'explore';
}

interface Voice {
  el: HTMLAudioElement;
  track: MusicTrack;
  vol: number;
  target: number;
  /** Volume change per second. */
  rate: number;
  /** A copy for the loop's crossfade has been started. */
  looped: boolean;
}

export interface Music {
  /** `track` for this owner (null = silence while still holding the claim). */
  request: (owner: MusicOwner, track: MusicTrack | null, fadeSec?: number) => void;
  /** Drop the owner's claim (the screen unmounted). */
  release: (owner: MusicOwner) => void;
  setEnabled: (on: boolean) => void;
  duck: (on: boolean) => void;
}

function createMusic(): Music {
  const claims: Partial<Record<MusicOwner, MusicTrack | null>> = {};
  let voices: Voice[] = [];
  let current: MusicTrack | null = null;
  let enabled = true;
  let ducked = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let blocked = false; // the browser refused to play before the player's first click or key

  const retry = () => {
    if (!blocked) return;
    blocked = false;
    for (const v of voices) if (v.target > 0 && v.el.paused) start(v);
  };
  window.addEventListener('pointerdown', retry);
  window.addEventListener('keydown', retry);

  const start = (v: Voice) => {
    const p = v.el.play();
    if (p) p.catch(() => { blocked = true; });
  };

  const spawn = (track: MusicTrack, fadeSec: number): Voice => {
    const el = new Audio(MUSIC_FILES[track]);
    el.preload = 'auto';
    el.volume = 0;
    const v: Voice = { el, track, vol: 0, target: 1, rate: 1 / Math.max(0.05, fadeSec), looped: false };
    voices.push(v);
    start(v);
    return v;
  };

  const fadeOut = (v: Voice, fadeSec: number) => { v.target = 0; v.rate = 1 / Math.max(0.05, fadeSec); };

  const tick = () => {
    const dt = TICK_MS / 1000;
    const out = enabled ? LEVEL * (ducked ? DUCK : 1) : 0;
    for (const v of voices) {
      const step = v.rate * dt;
      v.vol = v.vol < v.target ? Math.min(v.target, v.vol + step) : Math.max(v.target, v.vol - step);
      try { v.el.volume = Math.min(1, Math.max(0, v.vol * out)); } catch { /* some browsers lock volume */ }
      // Loop: start a fresh copy before this one ends and crossfade into it.
      const d = v.el.duration;
      if (LOOPS[v.track] && v.track === current && v.target > 0 && !v.looped && Number.isFinite(d) && d > LOOP_XFADE_S * 2
        && v.el.currentTime >= d - LOOP_XFADE_S) {
        v.looped = true;
        fadeOut(v, LOOP_XFADE_S);
        spawn(v.track, LOOP_XFADE_S);
      }
    }
    voices = voices.filter((v) => {
      const gone = (v.target === 0 && v.vol === 0) || v.el.ended;
      if (gone) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); }
      return !gone;
    });
    if (!voices.length && timer) { clearInterval(timer); timer = null; }
  };
  const run = () => { if (!timer) timer = setInterval(tick, TICK_MS); };

  const apply = (fadeSec: number) => {
    const want = 'title' in claims ? claims.title ?? null : claims.game ?? null;
    const next = enabled ? want : null;
    if (next === current) return;
    current = next;
    for (const v of voices) fadeOut(v, fadeSec);
    if (next) spawn(next, fadeSec);
    run();
  };

  return {
    request: (owner, track, fadeSec = 2.5) => { claims[owner] = track; apply(fadeSec); },
    release: (owner) => { delete claims[owner]; apply(2.5); },
    setEnabled: (on) => { if (on === enabled) return; enabled = on; apply(1); },
    duck: (on) => { ducked = on; },
  };
}

let shared: Music | null = null;
/** The one music player for the page (null where there is no <audio>, e.g. tests). */
export function getMusic(): Music | null {
  if (shared) return shared;
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return null;
  shared = createMusic();
  return shared;
}
