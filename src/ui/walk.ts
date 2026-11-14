import type { Pt, RouteResult } from '../map';
import type { Activity, RouteLeg } from '../sim/types';

// Movement for the HUD: walks a route the Map role planned. The Map plans; the HUD moves the astronaut.

/** A walk to follow in game time: where the astronaut is at each minute, and what they are doing. */
export interface WalkPlan {
  /** Points along the way with the minute they are reached, from 0 to `minutes`. */
  path: { at: Pt; t: number }[];
  /** Sim legs in order; their minutes add up to `minutes`. */
  legs: RouteLeg[];
  minutes: number;
  /** True for the walk back to the cabin (ends under cover). */
  toBase: boolean;
}

const REST: Activity = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

/** The outbound walk from the Map's route: its samples give the timing, its Sim legs the effort. */
export function planFromRoute(route: RouteResult): WalkPlan | null {
  if (!route.samples.length || route.minutes <= 0) return null;
  return {
    path: route.samples.map((s) => ({ at: s.at, t: s.t })),
    legs: route.simLegs,
    minutes: route.minutes,
    toBase: false,
  };
}

/** The walk home from the route's last waypoint: the Map's home path, timed evenly by distance. */
export function planHome(home: RouteResult['home']): WalkPlan | null {
  if (home.path.length < 2 || home.minutes <= 0) return null;
  const cum = [0];
  for (let i = 1; i < home.path.length; i++) {
    const a = home.path[i - 1], b = home.path[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[cum.length - 1] || 1;
  return {
    path: home.path.map((at, i) => ({ at, t: (cum[i] / total) * home.minutes })),
    legs: home.legs,
    minutes: home.minutes,
    toBase: true,
  };
}

/** Where the astronaut is and what they are doing `elapsedMin` into the walk. */
export function walkAt(plan: WalkPlan, elapsedMin: number): { at: Pt; activity: Activity; done: boolean } {
  const t = Math.max(0, elapsedMin);
  const last = plan.path[plan.path.length - 1];
  if (t >= plan.minutes) return { at: last.at, activity: REST, done: true };

  // Position: interpolate between the two path points around t.
  let at = last.at;
  for (let i = 1; i < plan.path.length; i++) {
    const a = plan.path[i - 1], b = plan.path[i];
    if (t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
      at = { x: a.at.x + (b.at.x - a.at.x) * f, y: a.at.y + (b.at.y - a.at.y) * f };
      break;
    }
  }

  // Effort: the Sim leg covering t.
  let acc = 0;
  let activity = plan.legs[plan.legs.length - 1]?.activity ?? REST;
  for (const leg of plan.legs) {
    acc += leg.minutes;
    if (t < acc) { activity = leg.activity; break; }
  }
  return { at, activity, done: false };
}

/** Distance between two points, metres. */
export const distM = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
