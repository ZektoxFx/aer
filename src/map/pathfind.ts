// Smart routing and the safe-return zone.
// The terrain grid becomes a graph (8 neighbours per cell). Each step's cost in O₂, water, battery and LiOH
// comes from the team's suit model (simulate), so paths bend around cliffs and soft sand the way a real
// planner would. Paths minimise O₂ (metabolic energy); the other supplies are summed along the same path.
import type { Environment, SuitState } from '../sim/types';
import { FULL_SUIT, simulate } from '../sim/simulate';
import type { Elevation, Pt } from './geo';
import { dist, samplePath, stepSlope } from './geo';
import type { HazardZone } from './layout';
import { SLOPE_BLOCKED, zoneAt } from './layout';
import { slopeSpeedFactor } from './route';

export interface WalkModel { speedMS: number; loadKg: number; env: Environment }

export interface Grid {
  el: Elevation;
  zones: HazardZone[];
  /** Hazard zone index per cell, -1 for firm ground. */
  zoneIdx: Int8Array;
}

export function makeGrid(el: Elevation, zones: HazardZone[]): Grid {
  const zoneIdx = new Int8Array(el.cols * el.rows).fill(-1);
  for (let r = 0; r < el.rows; r++) {
    for (let c = 0; c < el.cols; c++) {
      const z = zoneAt(zones, { x: (c + 0.5) * el.cellM, y: (r + 0.5) * el.cellM });
      if (z) zoneIdx[r * el.cols + c] = zones.indexOf(z);
    }
  }
  return { el, zones, zoneIdx };
}

/** Supplies used per metre walked: [O₂ kg, water kg, battery Wh, LiOH kg, minutes]. */
type Use = [number, number, number, number, number];
const N_RES = 5;

/** A suit so full that nothing runs out while measuring rates. */
const PROBE: SuitState = { o2Kg: 100, liohKg: 100, waterKg: 100, batteryWh: 1e6, inspiredPCO2KPa: 0.1, coreTempC: 37, elapsedMin: 0 };

/** Per-metre use from the suit model, cached by slope (0.5° steps) and zone. */
function rateTable(zones: HazardZone[], m: WalkModel) {
  const cache = new Map<number, Use>();
  return (slopeDeg: number, zi: number): Use => {
    const key = Math.round(slopeDeg * 2) * 16 + (zi + 1);
    let u = cache.get(key);
    if (!u) {
      const z = zi >= 0 ? zones[zi] : undefined;
      const speed = m.speedMS * slopeSpeedFactor(slopeDeg) * (z?.speedFactor ?? 1);
      const minutes = 100 / speed / 60;
      const s = simulate(PROBE, m.env, { speedMS: speed, slopeDeg: slopeDeg + (z?.extraSlopeDeg ?? 0), loadKg: m.loadKg }, minutes).state;
      u = [(PROBE.o2Kg - s.o2Kg) / 100, (PROBE.waterKg - s.waterKg) / 100, (PROBE.batteryWh - s.batteryWh) / 100, (PROBE.liohKg - s.liohKg) / 100, minutes / 100];
      cache.set(key, u);
    }
    return u;
  };
}

/** Minimal binary heap of cell indices keyed by cost. */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.v.length; }
  push(key: number, val: number) {
    const { k, v } = this;
    k.push(key); v.push(val);
    let i = v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop() as number, lv = v.pop() as number;
    if (v.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < v.length && k[l] < k[m]) m = l;
        if (r < v.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Supplies needed to walk between `source` and every cell; `prev` is the next cell toward/from the source. */
export interface CostField {
  /** Per cell, N_RES values: O₂ kg, water kg, battery Wh, LiOH kg, minutes. Infinity = unreachable. */
  use: Float64Array;
  prev: Int32Array;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export const cellOf = (el: Elevation, p: Pt): number => {
  const c = Math.min(el.cols - 1, Math.max(0, Math.floor(p.x / el.cellM)));
  const r = Math.min(el.rows - 1, Math.max(0, Math.floor(p.y / el.cellM)));
  return r * el.cols + c;
};
export const cellCentre = (el: Elevation, i: number): Pt => ({ x: ((i % el.cols) + 0.5) * el.cellM, y: (Math.floor(i / el.cols) + 0.5) * el.cellM });

/**
 * Dijkstra over the terrain. 'out' = cost of walking from source to each cell; 'home' = cost of walking
 * from each cell back to source (uphill and downhill swap). Stops early once `target` is settled.
 */
export function costField(g: Grid, m: WalkModel, source: Pt, mode: 'out' | 'home', target?: number): CostField {
  const { el } = g;
  const n = el.cols * el.rows;
  const use = new Float64Array(n * N_RES).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const rate = rateTable(g.zones, m);
  const h = el.heightsM;
  const s = cellOf(el, source);
  for (let k = 0; k < N_RES; k++) use[s * N_RES + k] = 0;
  const heap = new Heap();
  heap.push(0, s);
  while (heap.size) {
    const [key, u] = heap.pop();
    if (done[u] || key > use[u * N_RES]) continue;
    done[u] = 1;
    if (u === target) break;
    const uc = u % el.cols, ur = (u - uc) / el.cols;
    for (const [dc, dr] of DIRS) {
      const vc = uc + dc, vr = ur + dr;
      if (vc < 0 || vr < 0 || vc >= el.cols || vr >= el.rows) continue;
      const v = vr * el.cols + vc;
      if (done[v]) continue;
      const diag = dc !== 0 && dr !== 0;
      const len = diag ? el.cellM * Math.SQRT2 : el.cellM;
      // Walking direction: out = u→v (zone of v), home = v→u (zone of u).
      const rise = mode === 'out' ? h[v] - h[u] : h[u] - h[v];
      const slope = (Math.atan(rise / len) * 180) / Math.PI;
      if (Math.abs(slope) > SLOPE_BLOCKED) continue;
      if (diag) {
        // A diagonal passes the corner shared with two other cells; the walked (bilinear) ground there is
        // the average of all four, so check both halves of the step against it.
        const mid = (h[u] + h[v] + h[ur * el.cols + vc] + h[vr * el.cols + uc]) / 4;
        const half = len / 2;
        if (Math.max(Math.abs(mid - h[u]), Math.abs(h[v] - mid)) / half > Math.tan((SLOPE_BLOCKED * Math.PI) / 180)) continue;
      }
      const r = rate(slope, mode === 'out' ? g.zoneIdx[v] : g.zoneIdx[u]);
      const cand = use[u * N_RES] + r[0] * len;
      if (cand < use[v * N_RES]) {
        for (let k = 0; k < N_RES; k++) use[v * N_RES + k] = use[u * N_RES + k] + r[k] * len;
        prev[v] = u;
        heap.push(cand, v);
      }
    }
  }
  return { use, prev };
}

/**
 * May the path between pts[0] and the last point be replaced by a straight line? Not if the line
 * crosses a slope too steep to walk, or enters a hazard zone the original path stayed out of.
 */
function clear(g: Grid, pts: Pt[]): boolean {
  const { el } = g;
  const a = pts[0], b = pts[pts.length - 1];
  const allowed = new Set(pts.map((p) => g.zoneIdx[cellOf(el, p)]));
  const line = samplePath(a, b, el.cellM / 2);
  for (let i = 1; i < line.length; i++) {
    if (Math.abs(stepSlope(el, line[i - 1], line[i])) > SLOPE_BLOCKED) return false;
    if (!allowed.has(g.zoneIdx[cellOf(el, line[i])])) return false;
  }
  return true;
}

/** Douglas–Peucker that only straightens where clear() allows. */
function simplify(g: Grid, pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const L = dist(a, b) || 1;
  let worst = 0, wi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / L;
    if (d > worst) { worst = d; wi = i; }
  }
  if (worst <= tol && clear(g, pts)) return [a, b];
  if (wi === 0) wi = pts.length >> 1;
  return [...simplify(g, pts.slice(0, wi + 1), tol).slice(0, -1), ...simplify(g, pts.slice(wi), tol)];
}

/** Least-O₂ walkable path from a to b (both included), or null if b cannot be reached. */
export function findPath(g: Grid, m: WalkModel, a: Pt, b: Pt): Pt[] | null {
  const { el } = g;
  const t = cellOf(el, b);
  const f = costField(g, m, a, 'out', t);
  if (!Number.isFinite(f.use[t * N_RES])) return null;
  const cells: Pt[] = [];
  for (let i = t; i !== -1; i = f.prev[i]) cells.push(cellCentre(el, i));
  cells.reverse();
  cells[0] = a;
  cells[cells.length - 1] = b;
  return simplify(g, cells, el.cellM * 0.75);
}

export interface RangeField {
  /** Worst supply left (fraction of a full suit) after walking to the cell and back to base. -Infinity = unreachable. */
  safe: Float32Array;
  /** Worst supply left after walking to the cell only (one-way). */
  reach: Float32Array;
}

const FULL = [FULL_SUIT.o2Kg, FULL_SUIT.waterKg, FULL_SUIT.batteryWh, FULL_SUIT.liohKg];

/**
 * The safe-return zone: for every cell, how much of the scarcest supply would be left after walking there
 * from the astronaut and then home to base. An estimate from steady walking rates; planRoute gives exact numbers.
 */
export function rangeField(g: Grid, m: WalkModel, astronaut: Pt, base: Pt, suit: SuitState): RangeField {
  const out = costField(g, m, astronaut, 'out');
  const home = costField(g, m, base, 'home');
  const have = [suit.o2Kg, suit.waterKg, suit.batteryWh, suit.liohKg];
  const n = g.el.cols * g.el.rows;
  const safe = new Float32Array(n), reach = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = Infinity, r = Infinity;
    for (let k = 0; k < 4; k++) {
      const o = out.use[i * N_RES + k], hm = home.use[i * N_RES + k];
      r = Math.min(r, (have[k] - o) / FULL[k]);
      s = Math.min(s, (have[k] - o - hm) / FULL[k]);
    }
    reach[i] = Number.isFinite(r) ? r : -Infinity;
    safe[i] = Number.isFinite(s) ? s : -Infinity;
  }
  return { safe, reach };
}
