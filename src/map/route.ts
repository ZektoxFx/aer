// Route costing: walks a waypoint route in short steps and runs the team's suit model on each step,
// so the map shows what a route really costs in O₂, water and battery. The map turns the route into the
// Sim role's RouteLeg list, and the point of no return comes from Sim's assessRoute (src/sim/route.ts).
import type { Activity, Environment, RouteLeg, SimWarning, SuitState } from '../sim/types';
import { simulate } from '../sim/simulate';
import { assessRoute } from '../sim/route';
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
  /** Optional smart router: returns the walked path from a to b (ends included), or null if unreachable. */
  router?: (a: Pt, b: Pt) => Pt[] | null;
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
  /** The walked path, from → to (straight unless a router bent it). */
  path: Pt[];
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
  /** Index of the first waypoint reached after the point of no return; null if you could turn back at the end. */
  pnrIndex: number | null;
  /** The route as Sim's legs (about one per minute walked), ready for assessRoute or the game loop. */
  simLegs: RouteLeg[];
  /** Sim's point of no return: last minute after setting out when turning back still reaches the start safely. null = unsafe already. */
  turnBackByMin: number | null;
  /** Walk back to base from the last waypoint (smart path if a router is set). */
  home: Home;
}

const worst = (a: Status, b: Status): Status =>
  a === 'critical' || b === 'critical' ? 'critical' : a === 'warning' || b === 'warning' ? 'warning' : 'nominal';

const statusOf = (ws: SimWarning[]): Status => ws.reduce<Status>((s, w) => worst(s, w.level), 'nominal');

/** Walking slows on steep ground, uphill or down (simple game rule [verify]). */
export const slopeSpeedFactor = (slopeDeg: number): number => Math.max(0.25, 1 - Math.abs(slopeDeg) / 35);

interface Walk { end: SuitState; minutes: number; warnings: SimWarning[]; samples: RouteSample[]; climbM: number; descentM: number; maxSlopeDeg: number; blocked: boolean; zones: Set<string>; steps: RouteLeg[] }

/**
 * Merge short steps into legs of about `minLegMin` minutes (time-weighted speed and slope), so Sim's
 * minute-by-minute point-of-no-return check stays fast on long routes.
 */
export function mergeLegs(steps: RouteLeg[], minLegMin = 1): RouteLeg[] {
  const out: RouteLeg[] = [];
  let t = 0, distM = 0, slopeT = 0, loadKg = 0;
  const flush = () => {
    if (t <= 0) return;
    out.push({ minutes: t, activity: { speedMS: distM / (t * 60), slopeDeg: slopeT / t, loadKg } });
    t = 0; distM = 0; slopeT = 0;
  };
  for (const s of steps) {
    if (s.activity.loadKg !== loadKg) { flush(); loadKg = s.activity.loadKg; }
    t += s.minutes; distM += s.activity.speedMS * s.minutes * 60; slopeT += s.activity.slopeDeg * s.minutes;
    if (t >= minLegMin) flush();
  }
  flush();
  return out;
}

const pathLength = (path: Pt[]) => path.reduce((sum, p, i) => (i ? sum + dist(path[i - 1], p) : 0), 0);

/** The path a leg follows: the router's if it found one, else a straight line. */
const legPath = (a: Pt, b: Pt, opt: RouteOptions): Pt[] => opt.router?.(a, b) ?? [a, b];

/** Walk along a path, sampling every stepM. */
function walkLeg(el: Elevation, zones: HazardZone[], path: Pt[], start: SuitState, t0: number, opt: RouteOptions): Walk {
  const pts = path.flatMap((p, i) => (i ? samplePath(path[i - 1], p, opt.stepM ?? 10).slice(1) : [p]));
  let state = start, minutes = 0, climbM = 0, descentM = 0, maxSlopeDeg = 0, blocked = false;
  let warnings: SimWarning[] = [];
  const seen = new Set<string>();
  const samples: RouteSample[] = [];
  const steps: RouteLeg[] = [];
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
    steps.push({ activity, minutes: dt });
  }
  return { end: state, minutes, warnings, samples, climbM, descentM, maxSlopeDeg, blocked, zones: seen, steps };
}

export interface Home { minutes: number; ok: boolean; end: SuitState; path: Pt[] }

/** Can the astronaut walk home from `from` and still have `reserveMin` minutes of supplies left? */
export function canReturn(el: Elevation, zones: HazardZone[], from: Pt, base: Pt, state: SuitState, opt: RouteOptions): Home {
  const path = legPath(from, base, opt);
  const back = walkLeg(el, zones, path, state, 0, opt);
  // After arriving, the suit must still last the reserve while resting.
  const rest = simulate(back.end, opt.env, { speedMS: 0, slopeDeg: 0, loadKg: 0 }, opt.reserveMin ?? 15);
  const failed = [...back.warnings, ...rest.warnings].some((w) => w.level === 'critical' || w.code === 'WATER_OUT');
  return { minutes: back.minutes, ok: !failed && !back.blocked, end: back.end, path };
}

/**
 * Cost a route that starts where the astronaut stands (`start`) and visits `waypoints` in order.
 * The point of no return is Sim's (turning back along the same path to `start`); `home` is the walk
 * from the last waypoint to `base`.
 */
export function planRoute(el: Elevation, zones: HazardZone[], start: Pt, base: Pt, waypoints: Pt[], suit: SuitState, opt: RouteOptions): RouteResult {
  const legs: LegResult[] = [];
  const samples: RouteSample[] = [{ at: start, t: 0, state: suit }];
  const steps: RouteLeg[] = [];
  let state = suit, minutes = 0, distM = 0, status: Status = 'nominal';
  let from = start;
  waypoints.forEach((to) => {
    const path = legPath(from, to, opt);
    const w = walkLeg(el, zones, path, state, minutes, opt);
    const legStatus = worst(statusOf(w.warnings), w.blocked ? 'critical' : w.maxSlopeDeg > SLOPE_CAUTION ? 'warning' : 'nominal');
    legs.push({
      from, to, path, distM: pathLength(path), climbM: w.climbM, descentM: w.descentM, maxSlopeDeg: w.maxSlopeDeg,
      minutes: w.minutes, blocked: w.blocked, zones: [...w.zones], end: w.end, warnings: w.warnings, status: legStatus,
    });
    samples.push(...w.samples);
    steps.push(...w.steps);
    state = w.end; minutes += w.minutes; distM += pathLength(path); status = worst(status, legStatus);
    from = to;
  });
  const home = canReturn(el, zones, from, base, state, opt);
  const simLegs = mergeLegs(steps);
  const { turnBackByMin } = assessRoute(suit, simLegs, () => opt.env);
  let pnrIndex: number | null = null;
  if (turnBackByMin === null) pnrIndex = 0;
  else if (turnBackByMin < minutes - 0.5) {
    let t = 0;
    const i = legs.findIndex((l) => (t += l.minutes) > turnBackByMin);
    pnrIndex = i >= 0 ? i : null;
  }
  return { legs, samples, distM, minutes, end: state, status, pnrIndex, home, simLegs, turnBackByMin };
}
