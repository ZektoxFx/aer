import { describe, expect, it } from 'vitest';
import type { RouteResult } from '../map';
import { planFromRoute, planHome, walkAt } from './walk';

const WALK = { speedMS: 1, slopeDeg: 0, loadKg: 0 };
const UPHILL = { speedMS: 0.6, slopeDeg: 8, loadKg: 0 };

// A minimal route: 0 → 100 m east in 10 min (flat), then 100 m north in 20 min (uphill).
const route = {
  samples: [
    { at: { x: 0, y: 0 }, t: 0 }, { at: { x: 100, y: 0 }, t: 10 }, { at: { x: 100, y: 100 }, t: 30 },
  ],
  simLegs: [{ activity: WALK, minutes: 10 }, { activity: UPHILL, minutes: 20 }],
  minutes: 30,
  home: {
    path: [{ x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 0 }],
    legs: [{ activity: WALK, minutes: 40 }],
    minutes: 40,
  },
} as unknown as RouteResult;

describe('planFromRoute + walkAt', () => {
  const plan = planFromRoute(route)!;

  it('starts at the first point, walking', () => {
    const w = walkAt(plan, 0);
    expect(w.at).toEqual({ x: 0, y: 0 });
    expect(w.activity).toEqual(WALK);
    expect(w.done).toBe(false);
  });

  it('interpolates the position between samples', () => {
    expect(walkAt(plan, 5).at).toEqual({ x: 50, y: 0 });
    expect(walkAt(plan, 20).at).toEqual({ x: 100, y: 50 });
  });

  it('uses the Sim leg covering the moment', () => {
    expect(walkAt(plan, 9.9).activity).toEqual(WALK);
    expect(walkAt(plan, 10.1).activity).toEqual(UPHILL);
  });

  it('ends at the last point, resting', () => {
    const w = walkAt(plan, 31);
    expect(w.done).toBe(true);
    expect(w.at).toEqual({ x: 100, y: 100 });
    expect(w.activity.speedMS).toBe(0);
  });

  it('has no plan for an empty route', () => {
    expect(planFromRoute({ ...route, samples: [] } as unknown as RouteResult)).toBeNull();
  });
});

describe('planHome', () => {
  it('times the home path evenly by distance and ends at the base', () => {
    const home = planHome(route.home)!;
    expect(home.toBase).toBe(true);
    expect(home.path.map((p) => p.t)).toEqual([0, 20, 40]);
    expect(walkAt(home, 10).at).toEqual({ x: 100, y: 50 });
    expect(walkAt(home, 40).at).toEqual({ x: 0, y: 0 });
  });
});
