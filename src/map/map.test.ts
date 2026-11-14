import { describe, expect, it } from 'vitest';
import { FULL_SUIT } from '../sim/simulate';
import type { Environment } from '../sim/types';
import { makeDevPack } from './devPack';
import type { Elevation } from './geo';
import { heightAt, inPolygon, samplePath, slopeAt, stepSlope, toLatLon } from './geo';
import { buildLayout, zoneAt } from './layout';
import type { HazardZone } from './layout';
import { planRoute } from './route';
import { createExplored, exploredFraction, isSeen, markSeen, newlyVisible, sightRadius, visibleItems } from './visibility';

const env: Environment = { pressureKPa: 0.75, tempC: -40, windMS: 5, tau: 0.5 };
const opt = { speedMS: 0.8, loadKg: 0, env };

/** A tilted plane: rises `riseM` per cell going east. */
function plane(cols: number, rows: number, cellM: number, riseM: number): Elevation {
  const heightsM: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heightsM.push(c * riseM);
  return { cols, rows, cellM, heightsM };
}

describe('geo', () => {
  it('samples heights bilinearly between cell centres', () => {
    const el = plane(4, 4, 10, 2);
    expect(heightAt(el, { x: 5, y: 5 })).toBeCloseTo(0);
    expect(heightAt(el, { x: 10, y: 5 })).toBeCloseTo(1);
    expect(heightAt(el, { x: -50, y: 5 })).toBeCloseTo(0); // clamped
  });

  it('finds the slope of a tilted plane', () => {
    const el = plane(10, 10, 10, 10); // 10 m up per 10 m east = 45°
    expect(slopeAt(el, { x: 50, y: 50 })).toBeCloseTo(45, 0);
    expect(stepSlope(el, { x: 40, y: 50 }, { x: 50, y: 50 })).toBeCloseTo(45, 0);
    expect(stepSlope(el, { x: 50, y: 50 }, { x: 40, y: 50 })).toBeCloseTo(-45, 0);
  });

  it('converts the area centre to its own lat/lon, north is up', () => {
    const area = { name: 'x', lat: 18.44, lon: 77.45, widthM: 3000, heightM: 3000 };
    expect(toLatLon(area, { x: 1500, y: 1500 })).toEqual({ lat: 18.44, lon: 77.45 });
    expect(toLatLon(area, { x: 1500, y: 0 }).lat).toBeGreaterThan(18.44);
    // ~59.16 km per degree of latitude on Mars
    expect(toLatLon(area, { x: 1500, y: 1500 - 59158 }).lat).toBeCloseTo(19.44, 2);
  });

  it('samples a path at most stepM apart, including both ends', () => {
    const pts = samplePath({ x: 0, y: 0 }, { x: 25, y: 0 }, 10);
    expect(pts).toHaveLength(4);
    expect(pts[3]).toEqual({ x: 25, y: 0 });
  });

  it('tests points against polygons', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(inPolygon({ x: 5, y: 5 }, sq)).toBe(true);
    expect(inPolygon({ x: 15, y: 5 }, sq)).toBe(false);
  });
});

describe('dev terrain', () => {
  const pack = makeDevPack(undefined, 60, 50);
  it('is clearly labelled synthetic and has a full grid', () => {
    expect(pack.source).toMatch(/SYNTHETIC/);
    expect(pack.elevation.heightsM).toHaveLength(60 * 60);
    expect(pack.area.widthM).toBe(3000);
  });
  it('is the same every time (seeded)', () => {
    expect(makeDevPack(undefined, 60, 50).elevation.heightsM).toEqual(pack.elevation.heightsM);
  });
});

describe('layout', () => {
  const area = { name: 'x', lat: 0, lon: 0, widthM: 3000, heightM: 3000 };
  it('places the base visible and every pickup hidden', () => {
    const { items, base } = buildLayout(area, 1);
    expect(items[0]).toMatchObject({ kind: 'base', hidden: false });
    expect(base).toEqual(items[0].at);
    expect(items.filter((i) => i.kind !== 'base').every((i) => i.hidden)).toBe(true);
  });
  it('keeps every item inside the map', () => {
    for (const i of buildLayout(area, 3).items) {
      expect(i.at.x).toBeGreaterThanOrEqual(0); expect(i.at.x).toBeLessThanOrEqual(3000);
      expect(i.at.y).toBeGreaterThanOrEqual(0); expect(i.at.y).toBeLessThanOrEqual(3000);
    }
  });
  it('picks the rover spot from the seed, repeatably', () => {
    const spot = (s: number) => buildLayout(area, s).items.find((i) => i.kind === 'rover')?.at;
    expect(spot(5)).toEqual(spot(5));
    const spots = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => JSON.stringify(spot(s))));
    expect(spots.size).toBeGreaterThan(1);
  });
  it('finds the zone at a point', () => {
    const { zones } = buildLayout(area, 1);
    expect(zoneAt(zones, { x: 0.8 * 3000, y: 0.8 * 3000 })?.kind).toBe('sand');
    expect(zoneAt(zones, { x: 0.62 * 3000, y: 0.48 * 3000 })).toBeUndefined(); // base is on firm ground
  });
});

describe('route', () => {
  const flat = plane(40, 40, 25, 0); // 1 km flat square
  const base = { x: 100, y: 500 };

  it('costs a flat walk with the suit model and returns home fine', () => {
    const r = planRoute(flat, [], base, base, [{ x: 900, y: 500 }], FULL_SUIT, opt);
    expect(r.distM).toBeCloseTo(800);
    expect(r.minutes).toBeCloseTo(800 / 0.8 / 60, 1);
    expect(r.end.o2Kg).toBeLessThan(FULL_SUIT.o2Kg);
    expect(r.status).toBe('nominal');
    expect(r.pnrIndex).toBeNull();
    expect(r.home.ok).toBe(true);
    expect(r.samples[r.samples.length - 1].at).toEqual({ x: 900, y: 500 });
  });

  it('does not change the starting suit', () => {
    const suit = { ...FULL_SUIT };
    planRoute(flat, [], base, base, [{ x: 900, y: 500 }], suit, opt);
    expect(suit).toEqual(FULL_SUIT);
  });

  it('is slower and costs more O₂ through soft sand', () => {
    const sand: HazardZone[] = [{ id: 's', kind: 'sand', label: 'Soft sand', speedFactor: 0.5, extraSlopeDeg: 5, poly: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] }];
    const firm = planRoute(flat, [], base, base, [{ x: 900, y: 500 }], FULL_SUIT, opt);
    const soft = planRoute(flat, sand, base, base, [{ x: 900, y: 500 }], FULL_SUIT, opt);
    expect(soft.minutes).toBeGreaterThan(firm.minutes * 1.9);
    expect(soft.end.o2Kg).toBeLessThan(firm.end.o2Kg);
    expect(soft.legs[0].zones).toEqual(['s']);
  });

  it('blocks a leg up a slope steeper than 25°', () => {
    const cliff = plane(40, 40, 25, 15); // ~31°
    const r = planRoute(cliff, [], base, base, [{ x: 900, y: 500 }], FULL_SUIT, opt);
    expect(r.legs[0].blocked).toBe(true);
    expect(r.status).toBe('critical');
  });

  it('marks the point of no return when supplies run short', () => {
    const low = { ...FULL_SUIT, waterKg: 0.5 }; // about 50 min of cooling water
    const wps = [{ x: 900, y: 500 }, { x: 900, y: 900 }, { x: 100, y: 900 }, { x: 900, y: 100 }];
    const r = planRoute(flat, [], base, base, wps, low, opt);
    expect(r.pnrIndex).not.toBeNull();
    expect(r.home.ok).toBe(false);
  });
});

describe('visibility', () => {
  it('uses the design-doc sight radii', () => {
    expect(sightRadius({ night: false, tau: 0.5 })).toBe(300);
    expect(sightRadius({ night: true, tau: 0.5 })).toBe(50);
    expect(sightRadius({ night: false, tau: 6 })).toBe(20);
  });

  it('remembers explored ground', () => {
    const ex = createExplored({ name: 'x', lat: 0, lon: 0, widthM: 1000, heightM: 1000 }, 25);
    expect(markSeen(ex, { x: 500, y: 500 }, 100)).toBeGreaterThan(0);
    expect(markSeen(ex, { x: 500, y: 500 }, 100)).toBe(0); // already seen
    expect(isSeen(ex, { x: 520, y: 480 })).toBe(true);
    expect(isSeen(ex, { x: 900, y: 900 })).toBe(false);
    expect(exploredFraction(ex)).toBeCloseTo((Math.PI * 100 ** 2) / 1000 ** 2, 1);
  });

  it('reveals hidden items only when close', () => {
    const items = [
      { id: 'b', kind: 'base' as const, label: 'Base', at: { x: 0, y: 0 }, hidden: false },
      { id: 'o', kind: 'o2' as const, label: 'O₂', at: { x: 200, y: 0 }, hidden: true },
    ];
    expect(newlyVisible(items, { x: 0, y: 0 }, 50, new Set())).toHaveLength(0);
    expect(newlyVisible(items, { x: 0, y: 0 }, 300, new Set())).toEqual([items[1]]);
    expect(newlyVisible(items, { x: 0, y: 0 }, 300, new Set(['o']))).toHaveLength(0);
    expect(visibleItems(items, new Set()).map((i) => i.id)).toEqual(['b']);
    expect(visibleItems(items, new Set(['o'])).map((i) => i.id)).toEqual(['b', 'o']);
  });
});
