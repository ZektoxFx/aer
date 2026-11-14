import { describe, expect, it } from 'vitest';
import type { DataPack } from '../data/types';
import { activityFor, basePoint, inCabinZone, moveStep, RUN_MS, WALK_MS } from './movement';

const area = { name: 't', lat: 0, lon: 0, widthM: 1000, heightM: 1000 } as DataPack['area'];
const flat = { cols: 10, rows: 10, cellM: 100, heightsM: new Array(100).fill(0) };
// Rises 10 m per 100 m to the east.
const eastRise = { cols: 10, rows: 10, cellM: 100, heightsM: Array.from({ length: 100 }, (_, i) => (i % 10) * 10) };
const still = { forward: 0, right: 0, run: false };
const fwd = { forward: 1, right: 0, run: false };

describe('moveStep', () => {
  it('stays put with no input or no game time', () => {
    const p = { x: 500, y: 500 };
    expect(moveStep(p, 0, still, 0, 60, flat, area)).toMatchObject({ pos: p, moving: false, speedMS: 0 });
    expect(moveStep(p, 0, fwd, 0, 0, flat, area).moving).toBe(false);
  });

  it('walks forward relative to the camera: yaw 0 is north (−y), yaw 90° is east (+x)', () => {
    const north = moveStep({ x: 500, y: 500 }, 0, fwd, 0, 10, flat, area);
    expect(north.pos.x).toBeCloseTo(500);
    expect(north.pos.y).toBeCloseTo(500 - WALK_MS * 10);
    const east = moveStep({ x: 500, y: 500 }, 0, fwd, Math.PI / 2, 10, flat, area);
    expect(east.pos.x).toBeCloseTo(500 + WALK_MS * 10);
    expect(east.heading).toBeCloseTo(Math.PI / 2);
  });

  it('runs at run speed and covers game-time distance', () => {
    const r = moveStep({ x: 500, y: 500 }, 0, { ...fwd, run: true }, 0, 60, flat, area);
    expect(r.speedMS).toBe(RUN_MS);
    expect(500 - r.pos.y).toBeCloseTo(RUN_MS * 60);
  });

  it('slows and reports a positive slope walking uphill', () => {
    const up = moveStep({ x: 300, y: 500 }, 0, fwd, Math.PI / 2, 10, eastRise, area);
    expect(up.slopeDeg).toBeGreaterThan(4);
    expect(up.speedMS).toBeLessThan(WALK_MS);
  });

  it('keeps the astronaut inside the area', () => {
    const r = moveStep({ x: 500, y: 10 }, 0, fwd, 0, 600, flat, area);
    expect(r.pos.y).toBe(5);
  });
});

describe('activityFor and the cabin', () => {
  it('rests when still and carries the exploring load when moving', () => {
    expect(activityFor({ moving: false, speedMS: 0, slopeDeg: 0 })).toEqual({ speedMS: 0, slopeDeg: 0, loadKg: 0 });
    expect(activityFor({ moving: true, speedMS: 1, slopeDeg: 3 })).toEqual({ speedMS: 1, slopeDeg: 3, loadKg: 10 });
  });

  it('places the cabin from the pack, and knows when you are at it', () => {
    const pack = { area: { ...area, eMin: -500, nMax: 500 }, crashedLander: { cabinLocation: { eastingM: 100, northingM: 200 } } } as unknown as DataPack;
    const b = basePoint(pack);
    expect(b).toEqual({ x: 600, y: 300 });
    expect(inCabinZone({ x: 610, y: 310 }, b)).toBe(true);
    expect(inCabinZone({ x: 700, y: 300 }, b)).toBe(false);
  });
});
