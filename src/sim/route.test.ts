import { describe, expect, it } from 'vitest';
import { O2_RESERVE_KG, assessRoute, canReturn, returnPath } from './route';
import { FULL_SUIT } from './simulate';
import type { Environment, RouteLeg } from './types';

const env: Environment = { pressureKPa: 0.75, tempC: -55, windMS: 5, tau: 0.5 };
const always = () => env;
const flat = { speedMS: 1, slopeDeg: 0, loadKg: 0 }; // 300 W
const legs = (...spec: [number, number][]): RouteLeg[] =>
  spec.map(([minutes, slopeDeg]) => ({ minutes, activity: { ...flat, slopeDeg } }));

describe('returnPath', () => {
  it('reverses the legs walked so far and flips uphill to downhill', () => {
    const back = returnPath(legs([30, 5], [20, -3], [40, 0]), 45);
    expect(back).toEqual(legs([15, 3], [30, -5])); // 15 min into leg 2, then all of leg 1
  });
  it('is empty before setting out', () => {
    expect(returnPath(legs([30, 5]), 0)).toEqual([]);
  });
});

describe('assessRoute', () => {
  it('a short walk can be abandoned at any point', () => {
    const r = assessRoute(FULL_SUIT, legs([60, 0]), always);
    expect(r.totalMin).toBe(60);
    expect(r.turnBackByMin).toBe(60);
    expect(r.end.state.elapsedMin).toBe(60);
  });

  it('with a fresh suit, oxygen sets the point of no return on a long flat walk', () => {
    const r = assessRoute(FULL_SUIT, legs([480, 0]), always);
    // (0.6 − 0.05 reserve) kg ÷ 2 ÷ 76.5 g/h ≈ 216 min
    expect(r.turnBackByMin).toBeGreaterThanOrEqual(212);
    expect(r.turnBackByMin).toBeLessThanOrEqual(218);
    // carrying on to the end of the route is fatal
    expect(r.end.warnings.some((w) => w.level === 'critical')).toBe(true);
  });

  it('Sol 1: with a partly used scrubber after the crash, CO₂ sets it instead', () => {
    // 0.4 kg LiOH lasts ~242 min at 300 W, so a round trip must turn back by about half of that
    const r = assessRoute({ ...FULL_SUIT, liohKg: 0.4 }, legs([480, 0]), always);
    expect(r.turnBackByMin).toBeGreaterThanOrEqual(117);
    expect(r.turnBackByMin).toBeLessThanOrEqual(124);
  });

  it('is null when even turning back right now is unsafe', () => {
    const r = assessRoute({ ...FULL_SUIT, o2Kg: O2_RESERVE_KG / 2 }, legs([30, 0]), always);
    expect(r.turnBackByMin).toBeNull();
  });

  it('reads conditions by game time: a deadly change later on pulls the point of no return earlier', () => {
    // Plumbing check with a deliberately extreme environment from game minute 60 onward.
    // (Real storms barely chill a walker in this model; their danger reaches routes through Map's slower pace.)
    const deadlyLater = (t: number) => (t < 60 ? env : { ...env, tempC: -300 });
    const walkOut = legs([400, 0]);
    const calm = assessRoute({ ...FULL_SUIT, liohKg: 5 }, walkOut, always);
    const changed = assessRoute({ ...FULL_SUIT, liohKg: 5 }, walkOut, deadlyLater);
    expect(changed.turnBackByMin!).toBeLessThan(60);
    expect(changed.turnBackByMin!).toBeLessThan(calm.turnBackByMin!);
  });

  it('does not change the starting suit', () => {
    const before = { ...FULL_SUIT };
    assessRoute(FULL_SUIT, legs([30, 0]), always);
    expect(FULL_SUIT).toEqual(before);
  });
});

describe('canReturn', () => {
  it('needs the O₂ reserve left on arrival', () => {
    expect(canReturn({ ...FULL_SUIT, o2Kg: O2_RESERVE_KG + 0.001 }, [], always)).toBe(true);
    expect(canReturn({ ...FULL_SUIT, o2Kg: O2_RESERVE_KG - 0.001 }, [], always)).toBe(false);
  });
});
