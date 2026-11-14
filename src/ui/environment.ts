import { localHour, sunElevationDeg } from '../sim/game';
import { MIN_PER_SOL } from '../sim/storm';
import type { GameState } from '../sim/types';

// The environment timeline for free play, from the proposal:
// §6.3 a dust storm with a five-minute warning; §3.6 dust devils (MEDA saw nearly 5 vortices per sol at Jezero,
// peaking around 12:00–13:00 local time) and cold nights. The HUD shows these as a forecast with countdowns.

/** Local solar hour when the free-play storm warning arrives on the first day (design value for pacing). */
export const STORM_FORECAST_HOUR = 15;
/** Dust devils are drawn around the midday peak MEDA recorded. */
export const DUST_DEVIL_START_HOUR = 11;
export const DUST_DEVIL_END_HOUR = 14;

const minOfDay = (clockMin: number) => ((clockMin % MIN_PER_SOL) + MIN_PER_SOL) % MIN_PER_SOL;
const atHour = (dayStartMin: number, hour: number) => dayStartMin + (hour / 24) * MIN_PER_SOL;

/** Game minute of the storm warning for a run that starts at `startClockMin`: 15:00 on that day (or the next, if already past). */
export function stormForecastAt(startClockMin: number): number {
  const dayStart = startClockMin - minOfDay(startClockMin);
  const today = atHour(dayStart, STORM_FORECAST_HOUR);
  return today > startClockMin ? today : today + MIN_PER_SOL;
}

export function dustDevilsActive(clockMin: number): boolean {
  const h = localHour(clockMin);
  return h >= DUST_DEVIL_START_HOUR && h < DUST_DEVIL_END_HOUR;
}

/** Minutes until the next dust-devil window opens (0 while one is open). */
export function minutesToDustDevils(clockMin: number): number {
  if (dustDevilsActive(clockMin)) return 0;
  const dayStart = clockMin - minOfDay(clockMin);
  const today = atHour(dayStart, DUST_DEVIL_START_HOUR);
  return (today > clockMin ? today : today + MIN_PER_SOL) - clockMin;
}

/** The next sunrise or sunset, found by stepping the sun forward (with NASA geometry when `sky` is set). */
export function nextSunEvent(clockMin: number, sky?: GameState['sky'], stepMin = 2): { kind: 'sunrise' | 'sunset'; inMin: number } | null {
  const up = sunElevationDeg(clockMin, sky) > 0;
  for (let t = stepMin; t <= MIN_PER_SOL; t += stepMin) {
    if (sunElevationDeg(clockMin + t, sky) > 0 !== up) return { kind: up ? 'sunset' : 'sunrise', inMin: t };
  }
  return null;
}

export interface EnvEvent {
  id: 'storm' | 'devils' | 'sun';
  label: string;
  /** Minutes until it starts; 0 = happening now. */
  inMin: number;
  /** Shown in the warning colour. */
  hazard: boolean;
}

/** Upcoming events for the HUD forecast, soonest first. */
export function upcomingEvents(clockMin: number, stormAtMin: number | null, sky?: GameState['sky']): EnvEvent[] {
  const out: EnvEvent[] = [];
  if (stormAtMin !== null && stormAtMin > clockMin) out.push({ id: 'storm', label: 'DUST STORM FORECAST', inMin: stormAtMin - clockMin, hazard: true });
  const devils = minutesToDustDevils(clockMin);
  out.push({ id: 'devils', label: devils === 0 ? 'DUST DEVILS ACTIVE' : 'DUST DEVILS', inMin: devils, hazard: devils === 0 });
  const sun = nextSunEvent(clockMin, sky);
  if (sun) out.push({ id: 'sun', label: sun.kind === 'sunset' ? 'SUNSET · COLD NIGHT' : 'SUNRISE', inMin: sun.inMin, hazard: false });
  return out.sort((a, b) => a.inMin - b.inMin);
}
