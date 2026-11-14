import type { DataPack } from '../data/types';
import { MAP_WALK_MS, slopeSpeedFactor, stepSlope, type Elevation, type Pt } from '../map';
import type { Activity } from '../sim/types';

// Free walking for the 3D view. Positions are map metres (x east, y south from the north-west corner), the same
// frame as the Map role's HudMap, so the minimap and the suit costs stay in step with the 3D world.

/** LOCAL DRAFT (Map/Aiman): the route planner's pace (0.8 m/s with 10 kg), so free walking matches the route ETA. */
export const WALK_MS = MAP_WALK_MS;
export const RUN_MS = 2;
/** Carried load while exploring on foot (tools and salvage), a design value. */
export const EXPLORE_LOAD_KG = 10;
/** Standing still within this distance of the lander counts as being inside the cabin. */
export const CABIN_RADIUS_M = 30;
const EDGE_M = 5;

export interface MoveInput {
  /** -1 back … 1 forward. */
  forward: number;
  /** -1 left … 1 right. */
  right: number;
  run: boolean;
}

export interface MoveResult {
  pos: Pt;
  moving: boolean;
  /** Ground speed in m/s after the slope slowdown (0 when still). */
  speedMS: number;
  /** Positive = uphill along the step. */
  slopeDeg: number;
  /** Direction faced, radians (0 = north, clockwise), kept when standing still. */
  heading: number;
}

/**
 * One movement step. `yaw` is the camera's heading (0 = looking north, clockwise), so "forward" walks away from the
 * camera. `gameSec` is game time elapsed, so time warp moves the astronaut as far as the suit sim thinks they walked.
 */
export function moveStep(
  pos: Pt, heading: number, input: MoveInput, yaw: number, gameSec: number, el: Elevation, area: DataPack['area'],
): MoveResult {
  const len = Math.hypot(input.forward, input.right);
  if (len === 0 || gameSec <= 0) return { pos, moving: false, speedMS: 0, slopeDeg: 0, heading };

  // Direction in map frame: north is -y, east is +x.
  const f = input.forward / len, r = input.right / len;
  const dirX = f * Math.sin(yaw) + r * Math.cos(yaw);
  const dirY = -f * Math.cos(yaw) + r * Math.sin(yaw);
  const newHeading = Math.atan2(dirX, -dirY);

  const base = input.run ? RUN_MS : WALK_MS;
  const probe = { x: pos.x + dirX, y: pos.y + dirY };
  const slopeDeg = stepSlope(el, pos, probe);
  const speedMS = base * slopeSpeedFactor(slopeDeg);
  const d = speedMS * gameSec;
  const next = {
    x: Math.min(area.widthM - EDGE_M, Math.max(EDGE_M, pos.x + dirX * d)),
    y: Math.min(area.heightM - EDGE_M, Math.max(EDGE_M, pos.y + dirY * d)),
  };
  return { pos: next, moving: true, speedMS, slopeDeg, heading: newHeading };
}

/** The suit sim's activity for this movement. */
export function activityFor(m: Pick<MoveResult, 'moving' | 'speedMS' | 'slopeDeg'>): Activity {
  return m.moving
    ? { speedMS: m.speedMS, slopeDeg: m.slopeDeg, loadKg: EXPLORE_LOAD_KG }
    : { speedMS: 0, slopeDeg: 0, loadKg: 0 };
}

/** The lander cabin in map metres, from the data pack (same rule as the Map role's layout). */
export function basePoint(pack: DataPack): Pt {
  const a = pack.area;
  const cab = pack.crashedLander?.cabinLocation;
  if (!cab) return { x: a.widthM / 2, y: a.heightM / 2 };
  const eMin = a.eMin ?? -a.widthM / 2, nMax = a.nMax ?? a.heightM / 2;
  return { x: cab.eastingM - eMin, y: nMax - cab.northingM };
}

export const inCabinZone = (p: Pt, base: Pt) => Math.hypot(p.x - base.x, p.y - base.y) <= CABIN_RADIUS_M;
