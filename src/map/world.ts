// LOCAL DRAFT (Map/Aiman, not pushed): the map's rules for free walking in the 3D world, so walking there costs
// time and oxygen the same way a planned route does. Same numbers as route.ts / pathfind.ts:
// slope slows you (slopeSpeedFactor), soft sand and boulder fields slow you more and cost extra effort
// (HAZARD_EFFECT, as "virtual uphill" for the suit model), and slopes over SLOPE_BLOCKED cannot be walked.
import type { Elevation, Pt } from './geo';
import type { HazardZone, MapItem } from './layout';
import { SLOPE_BLOCKED, zoneAt } from './layout';
import type { RangeField } from './pathfind';
import { cellOf } from './pathfind';
import type { RouteResult } from './route';

/** Planner walking pace, m/s (the route ETA uses this; free walking in 3D matches it). */
export const MAP_WALK_MS = 0.8;

/** Everything the 3D world needs from the map to show the same world: items, zones, safe zone and route. */
export interface MapWorldState {
  items: MapItem[];
  found: ReadonlySet<string>;
  zones: HazardZone[];
  range: RangeField | null;
  /** Fraction of a full suit that must be left on getting home (the green line's level). */
  reserve: number;
  route: RouteResult | null;
  base: Pt;
  sightM: number;
  elevation: Elevation;
}

export interface GroundStep {
  /** Too steep to walk (same SLOPE_BLOCKED rule as the route planner): the astronaut stays put. */
  blocked: boolean;
  /** Multiply the distance walked by this (the ground: soft sand, boulders). Slope is applied by the caller. */
  speedFactor: number;
  /** Slope for the suit model (uphill +) plus the ground's extra effort, as route.ts does. */
  effortSlopeDeg: number;
  zone?: HazardZone;
}

/** The map's ground rules for one free-walking step at `at` with this slope (degrees, uphill +). */
export function groundStep(zones: HazardZone[], at: Pt, slopeDeg: number): GroundStep {
  const zone = zoneAt(zones, at);
  const blocked = Math.abs(slopeDeg) > SLOPE_BLOCKED;
  return { blocked, speedFactor: blocked ? 0 : zone?.speedFactor ?? 1, effortSlopeDeg: slopeDeg + (zone?.extraSlopeDeg ?? 0), zone };
}

export type ReturnStatus = 'safe' | 'one-way' | 'out' | 'unknown';

/** Can the astronaut still get home from here with the reserve left? Same rule as the green / amber lines. */
export function returnStatus(range: RangeField | null, el: Elevation, p: Pt, reserve: number): ReturnStatus {
  if (!range) return 'unknown';
  const c = cellOf(el, p);
  const safe = range.safe[c], reach = range.reach[c];
  if (safe === undefined || reach === undefined) return 'unknown';
  return safe >= reserve ? 'safe' : reach >= 0 ? 'one-way' : 'out';
}

/** Items the player can see in the world: not hidden, already found, or inside sight right now. */
export function itemsInView(s: Pick<MapWorldState, 'items' | 'found' | 'sightM'>, me: Pt): MapItem[] {
  return s.items.filter((it) => !it.hidden || s.found.has(it.id) || Math.hypot(it.at.x - me.x, it.at.y - me.y) <= s.sightM);
}
