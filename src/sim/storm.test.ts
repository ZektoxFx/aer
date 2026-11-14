import { describe, expect, it } from 'vitest';
import { CABIN_POWER, panelW } from './power';
import { FULL_SUIT, simulate } from './simulate';
import {
  STORM_WARNING_LEAD_MIN, conditionsAt, makeStorm, shelterEnvironment, soilingAfter,
  stormCountdownMin, stormPhase, stormTau,
} from './storm';
import type { Environment } from './types';

// Warned at minute 100 → arrives 220, peak 280–760, clears by 1000.
const storm = makeStorm(100);
const base: Environment = { pressureKPa: 0.75, tempC: -40, windMS: 5, tau: 0.5 };
const rest = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

describe('storm timeline', () => {
  it('goes through each phase in order', () => {
    expect(stormPhase(storm, 50)).toBe('none');
    expect(stormPhase(storm, 100)).toBe('warning');
    expect(stormPhase(storm, 220)).toBe('building');
    expect(stormPhase(storm, 300)).toBe('peak');
    expect(stormPhase(storm, 800)).toBe('clearing');
    expect(stormPhase(storm, 1000)).toBe('over');
  });

  it('the countdown starts at 2 Mars hours (5 real minutes at 24×) and stops at zero', () => {
    expect(STORM_WARNING_LEAD_MIN).toBe(120);
    expect(stormCountdownMin(storm, 100)).toBe(120);
    expect(stormCountdownMin(storm, 190)).toBe(30);
    expect(stormCountdownMin(storm, 500)).toBe(0);
  });

  it('dust rises to the peak and falls back to normal', () => {
    expect(stormTau(storm, 0.5, 150)).toBe(0.5);            // still warning
    expect(stormTau(storm, 0.5, 250)).toBeCloseTo(4.25, 6);  // halfway up the ramp
    expect(stormTau(storm, 0.5, 500)).toBe(8);
    expect(stormTau(storm, 0.5, 880)).toBeCloseTo(4.25, 6);  // halfway down
    expect(stormTau(storm, 0.5, 2000)).toBe(0.5);
  });
});

describe('storm effects', () => {
  it('sunlight and panel power collapse at the peak', () => {
    const clear = conditionsAt(base, storm, 50, 60);
    const peak = conditionsAt(base, storm, 500, 60);
    expect(peak.tau).toBe(8);
    expect(panelW(CABIN_POWER, peak) / panelW(CABIN_POWER, clear)).toBeLessThan(0.1);
  });

  it('no storm leaves conditions unchanged except for sunlight', () => {
    const c = conditionsAt(base, null, 500, 60);
    expect(c.tau).toBe(0.5);
    expect(c.solarWm2).toBeGreaterThan(0);
  });

  it('3 h resting on a −83 °C night: cabin and built shelter hold 37 °C, a wreck cools slowly, outside cools fast', () => {
    const night = { ...base, tempC: -83 };
    const coreAfter = (shelter: Parameters<typeof shelterEnvironment>[1]) =>
      simulate(FULL_SUIT, shelterEnvironment(night, shelter), rest, 180).state.coreTempC;
    expect(coreAfter('cabin')).toBeCloseTo(37, 2);
    expect(coreAfter('builtShelter')).toBeCloseTo(37, 2);
    expect(coreAfter('wreck')).toBeLessThan(37);
    expect(coreAfter('wreck')).toBeGreaterThan(35); // still safe
    expect(coreAfter('none')).toBeLessThan(35);     // hypothermia
  });

  it('a shelter blocks wind and sun on the suit', () => {
    const inside = shelterEnvironment({ ...base, solarWm2: 400 }, 'wreck');
    expect(inside.windMS).toBe(0);
    expect(inside.solarWm2).toBe(0);
  });

  it('dust coats panels 10× faster in a storm, capped at the highest observed rate', () => {
    const clearSol = soilingAfter(0.1, 0.5, 1477.6);
    const stormSol = soilingAfter(0.1, 8, 1477.6);
    expect(clearSol - 0.1).toBeCloseTo(0.9 * 0.002, 6); // 0.2%/sol in clear weather
    expect(stormSol - 0.1).toBeCloseTo(0.9 * 0.02, 6);  // capped at 2%/sol
    expect(soilingAfter(0.9, 1000, 1e6)).toBeLessThanOrEqual(1);
  });

  it('covered panels collect no dust', () => {
    expect(soilingAfter(0.1, 8, 600, true)).toBe(0.1);
  });
});
