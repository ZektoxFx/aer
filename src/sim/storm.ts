import { approxSolarWm2 } from './power';
import type { Environment, Shelter, StormEvent, StormPhase } from './types';

/** The storm warning gives 5 real minutes; at the fixed 24× storm speed (§6.4) that is 2 Mars hours. */
export const STORM_WARNING_LEAD_MIN = 120;

/** A storm to start from. Design values for game pacing; real storms build over days (§9) [verify]. */
export function makeStorm(warnedAtMin: number, peakTau = 8): StormEvent {
  return { warnedAtMin, peakTau, rampMin: 60, peakMin: 8 * 60, clearMin: 4 * 60 };
}

function arrivalMin(s: StormEvent): number {
  return s.warnedAtMin + STORM_WARNING_LEAD_MIN;
}

export function stormPhase(s: StormEvent, tMin: number): StormPhase {
  const a = arrivalMin(s);
  if (tMin < s.warnedAtMin) return 'none';
  if (tMin < a) return 'warning';
  if (tMin < a + s.rampMin) return 'building';
  if (tMin < a + s.rampMin + s.peakMin) return 'peak';
  if (tMin < a + s.rampMin + s.peakMin + s.clearMin) return 'clearing';
  return 'over';
}

/** Game minutes left before the dust front arrives (0 once it has). */
export function stormCountdownMin(s: StormEvent, tMin: number): number {
  return Math.max(0, arrivalMin(s) - Math.max(tMin, s.warnedAtMin));
}

/**
 * Dust τ at time t: normal until arrival, linear rise to the peak, hold, linear fall back.
 * shortcut: a trapezoid shape; swap in a real MEDA/rover τ record from the data pack when it exists.
 */
export function stormTau(s: StormEvent, baseTau: number, tMin: number): number {
  const sinceArrival = tMin - arrivalMin(s);
  const extra = s.peakTau - baseTau;
  if (sinceArrival <= 0) return baseTau;
  if (sinceArrival < s.rampMin) return baseTau + extra * (sinceArrival / s.rampMin);
  const sincePeakEnd = sinceArrival - s.rampMin - s.peakMin;
  if (sincePeakEnd <= 0) return s.peakTau;
  if (sincePeakEnd < s.clearMin) return s.peakTau - extra * (sincePeakEnd / s.clearMin);
  return baseTau;
}

/** Surface sunlight (W/m²) from dust τ and sun elevation. */
export type SolarFn = (tau: number, sunElevationDeg: number) => number;

/** The outdoor environment at time t, with storm dust and the resulting sunlight applied. */
export function conditionsAt(
  base: Environment, storm: StormEvent | null, tMin: number, sunElevationDeg: number, solar: SolarFn = approxSolarWm2,
): Environment {
  const tau = storm ? stormTau(storm, base.tau, tMin) : base.tau;
  return { ...base, tau, solarWm2: solar(tau, sunElevationDeg) };
}

// How much of the outside cold reaches the astronaut in each shelter [verify]: 0 = fully protected, 1 = outside.
const SHELTER_EXPOSURE: Record<Shelter, number> = { cabin: 0.3, builtShelter: 0.5, wreck: 0.7, none: 1 };

/** The environment the suit feels inside a shelter: less cold, no wind, no sun on the suit. */
export function shelterEnvironment(env: Environment, shelter: Shelter): Environment {
  if (shelter === 'none') return env;
  const exposure = SHELTER_EXPOSURE[shelter];
  return { ...env, tempC: 37 - (37 - env.tempC) * exposure, windMS: 0, solarWm2: 0 };
}

// Dust settling on panels: 0.2%/sol at τ 0.5, the typical rate across six landed missions; never above
// 2%/sol, the highest rate observed (Lorenz et al. 2021).
const SOILING_PER_SOL_PER_TAU = 0.004;
const MAX_SOILING_PER_SOL = 0.02;
export const MIN_PER_SOL = 1477.6; // 24 h 39.6 min

/** Panel soiling after `minutes` exposed to dust τ. Covered or sheltered panels collect nothing. */
export function soilingAfter(soiling: number, tau: number, minutes: number, covered = false): number {
  if (covered) return soiling;
  const rate = (Math.min(MAX_SOILING_PER_SOL, SOILING_PER_SOL_PER_TAU * tau) * minutes) / MIN_PER_SOL;
  return soiling + (1 - soiling) * Math.min(1, rate);
}
