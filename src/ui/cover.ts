import type { Pt } from '../map/geo';
import type { Activity } from '../sim/types';

// Rock cover in a dust storm. Out in the open, blowing grit, near-zero visibility and footing hidden under drifting
// dust make every step (and even holding position) harder work, so the suit burns more oxygen; tucked under a rock
// overhang the astronaut can rest. This is a game design choice, not a wind-force model: Mars' air is so thin that
// even storm winds push weakly (SUBMISSION.md). Positions and effort numbers are design values [verify].

/** Within this distance of an overhang, the astronaut is under it, metres. */
export const COVER_RADIUS_M = 7;
/** The storm counts once dust τ is above this (Jezero's normal sky is τ ≈ 0.4–1). */
export const STORM_TAU_FROM = 2;
/** τ at which the storm is at full strength (the game storm's peak). */
export const STORM_TAU_FULL = 8;
/** At full strength, walking in the open is as hard as climbing this much extra slope, degrees (design value). */
export const STORM_SLOPE_DEG = 12;
/** At full strength, standing in the open is as hard as walking this fast (bracing, wiping the visor), m/s. */
export const BRACE_MS = 0.35;

export interface CoverRock {
  id: string;
  at: Pt;
  /** Overhang size, metres. */
  size: number;
  /** Which way the opening faces, radians. */
  yaw: number;
}

/**
 * The rock overhangs around the lander: the same every run, spread in a spiral from about 80 m out to 2 km so
 * there is always one within a few minutes' walk, including on the way west to Perseverance.
 */
export function coverRocks(base: Pt, area: { widthM: number; heightM: number }, count = 18): CoverRock[] {
  let seed = 9133;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out: CoverRock[] = [];
  const M = 60;
  for (let i = 0; i < count; i++) {
    const r = 80 + i * 110 + rand() * 40;
    const a = i * 2.39996 + (rand() - 0.5) * 0.5; // golden angle: no two in the same direction
    const at = {
      x: Math.min(area.widthM - M, Math.max(M, base.x + Math.cos(a) * r)),
      y: Math.min(area.heightM - M, Math.max(M, base.y + Math.sin(a) * r)),
    };
    out.push({ id: `cover-${i}`, at, size: 3.2 + rand() * 1.6, yaw: rand() * Math.PI * 2 });
  }
  // One more near the route west to Perseverance (about 1 km out), for the long walk.
  out.push({ id: 'cover-west', at: { x: Math.max(M, base.x - 1000), y: base.y + 40 }, size: 4.2, yaw: 1.2 });
  return out;
}

export interface NearCover {
  rock: CoverRock;
  distM: number;
  /** Compass bearing from the astronaut, degrees clockwise from north. */
  bearingDeg: number;
}

export function nearestCover(pos: Pt, rocks: CoverRock[]): NearCover | null {
  let best: NearCover | null = null;
  for (const rock of rocks) {
    const dx = rock.at.x - pos.x, dy = rock.at.y - pos.y;
    const distM = Math.hypot(dx, dy);
    if (!best || distM < best.distM) best = { rock, distM, bearingDeg: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360 };
  }
  return best;
}

export const underCover = (pos: Pt, rocks: CoverRock[]) => (nearestCover(pos, rocks)?.distM ?? Infinity) <= COVER_RADIUS_M;

/** How strong the storm is, 0 (none) to 1 (peak), from dust τ. */
export function stormStrength(tau: number): number {
  return Math.min(1, Math.max(0, (tau - STORM_TAU_FROM) / (STORM_TAU_FULL - STORM_TAU_FROM)));
}

/**
 * The suit's effort in the open during a storm: walking is like climbing a steeper slope, and standing still is
 * work too. The sim turns the extra effort into extra O₂, CO₂ and heat. Under cover: unchanged.
 */
export function stormEffort(a: Activity, strength: number, covered: boolean): Activity {
  if (covered || strength <= 0) return a;
  if (a.speedMS > 0) return { ...a, slopeDeg: Math.max(0, a.slopeDeg) + STORM_SLOPE_DEG * strength };
  return { speedMS: BRACE_MS * strength, slopeDeg: 0, loadKg: Math.max(a.loadKg, 10) };
}
