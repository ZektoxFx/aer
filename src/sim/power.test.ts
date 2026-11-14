import { describe, expect, it } from 'vitest';
import { BASE_LOADS, CABIN_POWER, approxSolarWm2, panelW, powerStep } from './power';
import type { Environment } from './types';

const night: Environment = { pressureKPa: 0.75, tempC: -80, windMS: 5, tau: 0.5, solarWm2: 0 };
const clearNoon: Environment = { ...night, tempC: -23, solarWm2: approxSolarWm2(0.5, 90) };
const { suitCharger, moxie } = BASE_LOADS;

describe('sunlight', () => {
  it('is zero at night', () => {
    expect(approxSolarWm2(0.5, 0)).toBe(0);
    expect(approxSolarWm2(0.5, -10)).toBe(0);
  });
  it('a big dust storm (τ 10.8) leaves under 3% of clear-day sunlight', () => {
    expect(approxSolarWm2(10.8, 90) / approxSolarWm2(0.5, 90)).toBeLessThan(0.03);
  });
  it('a low sun gives less light than a high one', () => {
    expect(approxSolarWm2(0.5, 20)).toBeLessThan(approxSolarWm2(0.5, 60));
  });
  it('panel output = flux × area × efficiency × (1 − soiling)', () => {
    expect(panelW(CABIN_POWER, clearNoon)).toBeCloseTo(clearNoon.solarWm2! * 4 * 0.25 * 0.9, 6);
    expect(panelW({ ...CABIN_POWER, soiling: 1 }, clearNoon)).toBe(0);
  });
});

describe('powerStep', () => {
  it('surplus sun charges the battery: energy in = battery gain + loads', () => {
    const { state, solarW, deliveredWh } = powerStep(CABIN_POWER, clearNoon, [moxie], 60);
    expect(state.batteryWh - CABIN_POWER.batteryWh).toBeCloseTo(solarW - 300, 6);
    expect(deliveredWh.moxie).toBeCloseTo(300, 6);
  });

  it('the battery never charges above capacity', () => {
    const nearlyFull = { ...CABIN_POWER, batteryWh: 9990 };
    expect(powerStep(nearlyFull, clearNoon, [], 120).state.batteryWh).toBe(10000);
  });

  it('at night the loads run from the battery', () => {
    const { state, shed } = powerStep(CABIN_POWER, night, [suitCharger, moxie], 60);
    expect(state.batteryWh).toBeCloseTo(CABIN_POWER.batteryWh - 500, 6);
    expect(shed).toEqual([]);
  });

  it('when the battery runs flat, the lowest-priority load is cut and the rest keep running', () => {
    // weak sun: panels give 250 W, enough for the 200 W charger alone but not with MOXIE's 300 W
    const weakSun = { ...night, solarWm2: 250 / (4 * 0.25 * 0.9) };
    const low = { ...CABIN_POWER, batteryWh: 100 };
    const { state, shed, deliveredWh, solarW } = powerStep(low, weakSun, [suitCharger, moxie], 60);
    expect(solarW).toBeCloseTo(250, 6);
    expect(shed).toEqual(['moxie']);
    expect(deliveredWh.suitCharger).toBeCloseTo(200, 6); // never lost power
    // 120 Wh in the 24 min until the battery ran out, then short bursts from the 50 W of spare sun
    expect(deliveredWh.moxie).toBeGreaterThan(120);
    expect(deliveredWh.moxie).toBeLessThan(160);
    expect(state.batteryWh).toBeGreaterThanOrEqual(0);
    // energy balance: sun + battery drawn = energy delivered
    expect(deliveredWh.suitCharger + deliveredWh.moxie).toBeCloseTo(solarW + 100 - state.batteryWh, 6);
  });

  it('with no sun and an empty battery, every load is cut', () => {
    const { shed, deliveredWh } = powerStep({ ...CABIN_POWER, batteryWh: 0 }, night, [suitCharger, moxie], 10);
    expect(shed.sort()).toEqual(['moxie', 'suitCharger']);
    expect(deliveredWh.suitCharger + deliveredWh.moxie).toBe(0);
  });

  it('does not mutate the input state', () => {
    const before = { ...CABIN_POWER };
    powerStep(CABIN_POWER, night, [moxie], 30);
    expect(CABIN_POWER).toEqual(before);
  });
});
