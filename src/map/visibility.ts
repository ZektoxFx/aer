// What the astronaut can see: sight radius, remembered (explored) ground and found items.
import type { DataPack } from '../data/types';
import type { Pt } from './geo';
import { dist } from './geo';
import type { MapItem } from './layout';

/** Dust optical depth above which the game counts a dust storm. */
export const STORM_TAU = 5;

/** Sight radius (m) from the design doc: 300 m clear day, 50 m at night, 20 m in a dust storm. */
export function sightRadius(opts: { night: boolean; tau: number }): number {
  if (opts.tau > STORM_TAU) return 20;
  return opts.night ? 50 : 300;
}

/** Grid of remembered ground: 1 = the astronaut has seen this cell. */
export interface Explored {
  cellM: number;
  cols: number;
  rows: number;
  seen: Uint8Array;
}

export function createExplored(area: DataPack['area'], cellM = 25): Explored {
  const cols = Math.ceil(area.widthM / cellM), rows = Math.ceil(area.heightM / cellM);
  return { cellM, cols, rows, seen: new Uint8Array(cols * rows) };
}

/** Mark every cell whose centre is within `radiusM` of `p`. Changes the grid; returns how many cells were new. */
export function markSeen(ex: Explored, p: Pt, radiusM: number): number {
  let added = 0;
  const c0 = Math.max(0, Math.floor((p.x - radiusM) / ex.cellM)), c1 = Math.min(ex.cols - 1, Math.floor((p.x + radiusM) / ex.cellM));
  const r0 = Math.max(0, Math.floor((p.y - radiusM) / ex.cellM)), r1 = Math.min(ex.rows - 1, Math.floor((p.y + radiusM) / ex.cellM));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * ex.cols + c;
      if (!ex.seen[i] && dist(p, { x: (c + 0.5) * ex.cellM, y: (r + 0.5) * ex.cellM }) <= radiusM) {
        ex.seen[i] = 1;
        added++;
      }
    }
  }
  return added;
}

export function isSeen(ex: Explored, p: Pt): boolean {
  const c = Math.floor(p.x / ex.cellM), r = Math.floor(p.y / ex.cellM);
  return c >= 0 && r >= 0 && c < ex.cols && r < ex.rows && ex.seen[r * ex.cols + c] === 1;
}

/** Fraction of the map explored (0 to 1). */
export function exploredFraction(ex: Explored): number {
  let n = 0;
  for (const v of ex.seen) n += v;
  return n / ex.seen.length;
}

/** Hidden items within sight that are not yet in `found`. */
export function newlyVisible(items: MapItem[], p: Pt, radiusM: number, found: ReadonlySet<string>): MapItem[] {
  return items.filter((i) => i.hidden && !found.has(i.id) && dist(i.at, p) <= radiusM);
}

/** Items to draw: everything not hidden, plus hidden items already found. */
export function visibleItems(items: MapItem[], found: ReadonlySet<string>): MapItem[] {
  return items.filter((i) => !i.hidden || found.has(i.id));
}
