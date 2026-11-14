// Route costing: walks a waypoint route in short steps and runs the team's suit model on each step,
// so the map shows what a route really costs in O₂, water and battery.
import type { Activity, Environment, SimWarning, SuitState } from '../sim/types';
import { simulate } from '../sim/simulate';
import type { Elevation, Pt } from './geo';
import { dist, heightAt, samplePath, stepSlope } from './geo';
import type { HazardZone } from './layout';
import { SLOPE_BLOCKED, SLOPE_CAUTION, zoneAt } from './layout';

export type Status = 'nominal' | 'warning' | 'critical';

export interface RouteOptions {
  /** Flat-ground walking speed (m/s). */
  speedMS: number;
  loadKg: number;
  env: Environment;
  /** Minutes of supplies that must be left after getting back to base. */
  reserveMin?: number;
  /** Distance between sample points (m). */
  stepM?: number;
}

/** One sample along the route, used to animate the walk. */
export interface RouteSample {
  at: Pt;
  /** Minutes since the route started. */
  t: number;
  state: SuitState;
}

export interface LegResult {
  from: Pt;
  to: Pt;
  distM: number;
  climbM: number;
  descentM: number;
  maxSlopeDeg: number;
  minutes: number;
  /** A step on this leg is steeper than the astronaut can walk. */
  blocked: boolean;
  /** Hazard zones the leg crosses. */
  zones: string[];
  end: SuitState;
  warnings: SimWarning[];
  status: Status;
}

export interface RouteResult {
  legs: LegResult[];
  samples: RouteSample[];
  distM: number;
  minutes: number;
  end: SuitState;
  status: Status;
  /** Index of the first waypoint from which a straight walk back to base fails; null if every waypoint is safe. */
  pnrIndex: number | null;
  /** Straight walk back to base from the last waypoint. */
  home: { minutes: number; ok: boolean; end: SuitState };
}

const worst = (a: Status, b: Status): Status =>
  a === 'critical' || b === 'critical' ? 'critical' : a === 'warning' || b === 'warning' ? 'warning' : 'nominal';

const statusOf = (ws: SimWarning[]): Status => ws.reduce<Status>((s, w) => worst(s, w.level), 'nominal');

/** Walking slows on steep ground, uphill or down (simple game rule [verify]). */
export const slopeSpeedFactor = (slopeDeg: number): number => Math.max(0.25, 1 - Math.abs(slopeDeg) / 35);

interface Walk { end: SuitState; minutes: number; warnings: SimWarning[]; samples: RouteSample[]; climbM: number; descentM: number; maxSlopeDeg: number; blocked: boolean; zones: Set<string> }

/** Walk a straight line from a to b, sampling every stepM. */
function walkLeg(el: Elevation, zones: HazardZone[], a: Pt, b: Pt, start: SuitState, t0: number, opt: RouteOptions): Walk {
  const pts = samplePath(a, b, opt.stepM ?? 10);
  let state = start, minutes = 0, climbM = 0, descentM = 0, maxSlopeDeg = 0, blocked = false;
  let warnings: SimWarning[] = [];
  const seen = new Set<string>();
  const samples: RouteSample[] = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    const slope = stepSlope(el, p, q);
    const dz = heightAt(el, q) - heightAt(el, p);
    if (dz > 0) climbM += dz; else descentM -= dz;
    maxSlopeDeg = Math.max(maxSlopeDeg, Math.abs(slope));
    if (Math.abs(slope) > SLOPE_BLOCKED) blocked = true;
    const zone = zoneAt(zones, q);
    if (zone) seen.add(zone.id);
    const speed = opt.speedMS * slopeSpeedFactor(slope) * (zone?.speedFactor ?? 1);
    const activity: Activity = { speedMS: speed, slopeDeg: slope + (zone?.extraSlopeDeg ?? 0), loadKg: opt.loadKg };
    const dt = dist(p, q) / speed / 60;
    const step = simulate(state, opt.env, activity, dt);
    state = step.state;
    warnings = step.warnings;
    minutes += dt;
    samples.push({ at: q, t: t0 + minutes, state });
  }
  return { end: state, minutes, warnings, samples, climbM, descentM, maxSlopeDeg, blocked, zones: seen };
}

/** Can the astronaut walk straight home from `from` and still have `reserveMin` minutes of supplies left? */
export function canReturn(el: Elevation, zones: HazardZone[], from: Pt, base: Pt, state: SuitState, opt: RouteOptions): { minutes: number; ok: boolean; end: SuitState } {
  const back = walkLeg(el, zones, from, base, state, 0, opt);
  // After arriving, the suit must still last the reserve while resting.
  const rest = simulate(back.end, opt.env, { speedMS: 0, slopeDeg: 0, loadKg: 0 }, opt.reserveMin ?? 15);
  const failed = [...back.warnings, ...rest.warnings].some((w) => w.level === 'critical' || w.code === 'WATER_OUT');
  return { minutes: back.minutes, ok: !failed && !back.blocked, end: back.end };
}

/**
 * Cost a route that starts where the astronaut stands (`start`) and visits `waypoints` in order.
 * The point of no return and the walk home are measured back to `base`.
 */
export function planRoute(el: Elevation, zones: HazardZone[], start: Pt, base: Pt, waypoints: Pt[], suit: SuitState, opt: RouteOptions): RouteResult {
  const legs: LegResult[] = [];
  const samples: RouteSample[] = [{ at: start, t: 0, state: suit }];
  let state = suit, minutes = 0, distM = 0, status: Status = 'nominal', pnrIndex: number | null = null;
  let from = start;
  waypoints.forEach((to, i) => {
    const w = walkLeg(el, zones, from, to, state, minutes, opt);
    const legStatus = worst(statusOf(w.warnings), w.blocked ? 'critical' : w.maxSlopeDeg > SLOPE_CAUTION ? 'warning' : 'nominal');
    legs.push({
      from, to, distM: dist(from, to), climbM: w.climbM, descentM: w.descentM, maxSlopeDeg: w.maxSlopeDeg,
      minutes: w.minutes, blocked: w.blocked, zones: [...w.zones], end: w.end, warnings: w.warnings, status: legStatus,
    });
    samples.push(...w.samples);
    state = w.end; minutes += w.minutes; distM += dist(from, to); status = worst(status, legStatus);
    if (pnrIndex === null && !canReturn(el, zones, to, base, state, opt).ok) pnrIndex = i;
    from = to;
  });
  const home = canReturn(el, zones, from, base, state, opt);
  return { legs, samples, distM, minutes, end: state, status, pnrIndex, home };
}
