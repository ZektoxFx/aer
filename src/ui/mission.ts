import type { RelayFile } from '../data/files';
import type { MapWorldState, Pt } from '../map';
import { localHour } from '../sim/game';
import { MIN_PER_SOL } from '../sim/storm';

// The mission shown under the minimap (proposal §1 and §6.2): the lander's radio died in the crash, so the
// astronaut must find Perseverance and use its radio, through an orbiter pass, to call Earth.

export interface MissionStep {
  id: 'crash' | 'page' | 'rover' | 'call';
  label: string;
  done: boolean;
  /** Short live detail: a distance, a countdown. */
  detail?: string;
}

export interface RelayPass {
  orbiter: string;
  /** Centre of the pass window, local time "HH:MM". */
  centre: string;
  /** Minutes until the window opens; 0 while it is open. */
  inMin: number;
}

/** The next orbiter relay window from Data's relay.json (approximate: the windows are LMST, the clock LTST). */
export function nextRelayPass(clockMin: number, relay: RelayFile | null | undefined): RelayPass | null {
  const windows = relay?.gameWindowsLTST?.windows;
  if (!windows?.length) return null;
  const h = localHour(clockMin);
  const minPerHour = MIN_PER_SOL / 24;
  let best: RelayPass | null = null;
  for (const w of windows) {
    if (h >= w.fromHour && h < w.toHour) return { orbiter: w.orbiter, centre: w.centre, inMin: 0 };
    const hoursAhead = (w.fromHour - h + 24) % 24;
    const inMin = hoursAhead * minPerHour;
    if (!best || inMin < best.inMin) best = { orbiter: w.orbiter, centre: w.centre, inMin };
  }
  return best;
}

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

/** The four mission steps, ticked off from what the map has found. */
export function missionSteps(world: MapWorldState | null, astronaut: Pt, pass: RelayPass | null, fmtMin: (m: number) => string): MissionStep[] {
  const page = world?.items.find((i) => i.required);
  const rover = world?.items.find((i) => i.kind === 'rover');
  const pageFound = !!(page && world?.found.has(page.id));
  const roverFound = !!(rover && world?.found.has(rover.id));
  const dist = (p: Pt) => km(Math.hypot(p.x - astronaut.x, p.y - astronaut.y));
  return [
    { id: 'crash', label: 'Survive the crash landing', done: true },
    { id: 'page', label: 'Find the manual page: rover comms link', done: pageFound, detail: pageFound && page ? dist(page.at) : undefined },
    { id: 'rover', label: 'Find Perseverance', done: roverFound, detail: roverFound && rover ? dist(rover.at) : 'last seen ~2 km W' },
    {
      id: 'call', label: 'Call Earth during an orbiter pass', done: false,
      detail: pass ? (pass.inMin === 0 ? `${pass.orbiter} overhead now` : `${pass.orbiter} ≈${pass.centre} · in ${fmtMin(pass.inMin)}`) : undefined,
    },
  ];
}
