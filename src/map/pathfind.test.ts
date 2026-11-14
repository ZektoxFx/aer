import { describe, expect, it } from 'vitest';
import { FULL_SUIT } from '../sim/simulate';
import type { Environment } from '../sim/types';
import { contourSegments } from './contours';
import { makeDevPack } from './devPack';
import type { Elevation, Pt } from './geo';
import { dist, inPolygon, samplePath, slopeAt, stepSlope } from './geo';
import { CRASH_PATH, SLOPE_BLOCKED, buildLayout } from './layout';
import type { HazardZone } from './layout';
import { cellOf, findPath, makeGrid, rangeField } from './pathfind';
import { planRoute } from './route';

const env: Environment = { pressureKPa: 0.75, tempC: -40, windMS: 5, tau: 0.5 };
const model = { speedMS: 0.8, loadKg: 0, env };

function grid(cols: number, rows: number, cellM: number, f: (c: number, r: number) => number): Elevation {
  const heightsM: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heightsM.push(f(c, r));
  return { cols, rows, cellM, heightsM };
}
const pathLen = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + dist(p[i - 1], q) : 0), 0);

describe('contours', () => {
  it('traces a level through a slope', () => {
    const el = grid(5, 5, 10, (c) => c * 10); // 0..40 rising east
    const segs = contourSegments(el.heightsM, 5, 5, 15);
    expect(segs.length).toBe(4); // one per row of cells
    for (const [x0, , x1] of segs) { expect(x0).toBeCloseTo(1.5); expect(x1).toBeCloseTo(1.5); }
  });
  it('skips cells with missing values', () => {
    expect(contourSegments([0, 1, -Infinity, 1], 2, 2, 0.5)).toHaveLength(0);
  });
});

describe('findPath', () => {
  it('goes straight on flat ground', () => {
    const g = makeGrid(grid(30, 30, 20, () => 0), []);
    const p = findPath(g, model, { x: 50, y: 300 }, { x: 550, y: 300 });
    expect(p).not.toBeNull();
    expect(pathLen(p ?? [])).toBeCloseTo(500, -1);
  });

  it('walks around a wall too steep to climb', () => {
    // A 40 m cliff band across the middle, with a gap at the south end.
    const el = grid(30, 30, 20, (c, r) => (c >= 14 && c <= 15 && r < 24 ? 40 : 0));
    const g = makeGrid(el, []);
    const a = { x: 100, y: 100 }, b = { x: 500, y: 100 };
    const p = findPath(g, model, a, b);
    expect(p).not.toBeNull();
    const path = p ?? [];
    expect(Math.max(...path.map((q) => q.y))).toBeGreaterThan(24 * 20 - 20); // detours through the gap
    for (let i = 1; i < path.length; i++) {
      const pts = samplePath(path[i - 1], path[i], 10);
      for (let k = 1; k < pts.length; k++) expect(Math.abs(stepSlope(el, pts[k - 1], pts[k]))).toBeLessThanOrEqual(SLOPE_BLOCKED + 0.5);
    }
  });

  it('returns null when the target is walled in', () => {
    const el = grid(20, 20, 20, (c, r) => (Math.max(Math.abs(c - 10), Math.abs(r - 10)) === 3 ? 60 : 0));
    expect(findPath(makeGrid(el, []), model, { x: 30, y: 30 }, { x: 210, y: 210 })).toBeNull();
  });

  it('prefers going round soft sand when the detour is short', () => {
    const el = grid(30, 30, 20, () => 0);
    const sand: HazardZone[] = [{ id: 's', kind: 'sand', label: 'Soft sand', speedFactor: 0.5, extraSlopeDeg: 5, poly: [{ x: 260, y: 250 }, { x: 340, y: 250 }, { x: 340, y: 350 }, { x: 260, y: 350 }] }];
    const g = makeGrid(el, sand);
    const p = findPath(g, model, { x: 100, y: 300 }, { x: 500, y: 300 }) ?? [];
    expect(p.length).toBeGreaterThan(2);
    // Zones are rasterised on the 20 m terrain grid: no walked point may fall in a sand cell.
    const walked = p.flatMap((q, i) => (i ? samplePath(p[i - 1], q, 5) : []));
    expect(walked.some((q) => g.zoneIdx[cellOf(el, q)] >= 0)).toBe(false);
    expect(walked.some((q) => inPolygon(q, sand[0].poly) && Math.min(q.x - 260, 340 - q.x, q.y - 250, 350 - q.y) > 10)).toBe(false);
  });

  it('plugs into planRoute so legs follow the smart path', () => {
    const el = grid(30, 30, 20, (c, r) => (c >= 14 && c <= 15 && r < 24 ? 40 : 0));
    const g = makeGrid(el, []);
    const base = { x: 100, y: 100 };
    const r = planRoute(el, [], base, base, [{ x: 500, y: 100 }], FULL_SUIT, { ...model, router: (a, b) => findPath(g, model, a, b) });
    expect(r.legs[0].blocked).toBe(false);
    expect(r.legs[0].path.length).toBeGreaterThan(2);
    expect(r.home.ok).toBe(true);
  });
});

describe('rangeField', () => {
  const el = grid(40, 40, 25, () => 0); // 1 km flat
  const g = makeGrid(el, []);
  const base = { x: 500, y: 500 };

  it('is safe near base and shrinks with less supply', () => {
    const full = rangeField(g, model, base, base, FULL_SUIT);
    const low = rangeField(g, model, base, base, { ...FULL_SUIT, o2Kg: 0.08 });
    expect(full.safe[cellOf(el, base)]).toBeGreaterThan(0.9);
    const count = (a: Float32Array) => a.filter((v) => v >= 0.1).length;
    expect(count(low.safe)).toBeLessThan(count(full.safe));
    // One-way reach is always at least as far as safe return.
    for (let i = 0; i < low.safe.length; i++) expect(low.reach[i]).toBeGreaterThanOrEqual(low.safe[i]);
  });

  it('marks cells behind a wall as unreachable', () => {
    const walled = grid(20, 20, 20, (c, r) => (Math.max(Math.abs(c - 10), Math.abs(r - 10)) === 3 ? 60 : 0));
    const f = rangeField(makeGrid(walled, []), model, { x: 30, y: 30 }, { x: 30, y: 30 }, FULL_SUIT);
    expect(f.safe[cellOf(walled, { x: 210, y: 210 })]).toBe(-Infinity);
  });
});

describe('item layout (proposal §4.1)', () => {
  const pack = makeDevPack();
  const { items, base, crashPath } = buildLayout(pack.area, 1);
  const kinds = (k: string) => items.filter((i) => i.kind === k);

  it('has every supply type, the seven rocket pieces and the four manual pages', () => {
    for (const k of ['o2', 'lioh', 'water', 'battery', 'repair']) expect(kinds(k).length).toBeGreaterThan(0);
    expect(kinds('scrap').map((i) => i.label).sort()).toEqual([
      'Avionics box and antenna', 'Hull and fairing panels', 'Parachute and straps', 'Solar array segment',
      'Tanks and valves', 'Thermal blankets', 'Wiring harnesses',
    ]);
    expect(kinds('scrap').every((i) => i.yields && i.yields.length > 0)).toBe(true);
    expect(kinds('manual').map((i) => i.unlocks).sort()).toEqual(['Direction finder', 'Oxygen tap', 'Rover comms link', 'Solar patch']);
    expect(items.filter((i) => i.required).map((i) => i.unlocks)).toEqual(['Rover comms link']);
  });

  it('drops most of the cargo along the crash path, which ends at the base', () => {
    expect(crashPath).toHaveLength(CRASH_PATH.length);
    expect(crashPath[crashPath.length - 1]).toEqual(base);
    const near = (p: Pt) => crashPath.some((q, i) => i > 0 && samplePath(crashPath[i - 1], q, 20).some((s) => dist(s, p) < 150));
    const cargo = items.filter((i) => i.kind !== 'base' && i.kind !== 'rover');
    expect(cargo.filter((i) => near(i.at)).length).toBeGreaterThan(cargo.length / 2);
  });

  it('puts every item on walkable ground that can be reached from the base', () => {
    const g = makeGrid(pack.elevation, buildLayout(pack.area, 1).zones);
    for (let seed = 1; seed <= 4; seed++) {
      for (const it of buildLayout(pack.area, seed).items) {
        expect(slopeAt(pack.elevation, it.at), it.label).toBeLessThan(SLOPE_BLOCKED);
        expect(findPath(g, model, base, it.at), it.label).not.toBeNull();
      }
    }
  });
});
