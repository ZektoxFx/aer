import { describe, expect, it } from 'vitest';
import { FULL_SUIT, alveolarPCO2, alveolarPO2PureO2, co2Effect, metabolicW, simulate } from './simulate';
import type { Environment } from './types';

const env: Environment = { pressureKPa: 0.75, tempC: -55, windMS: 5, tau: 0.5 };
const walk300W = { speedMS: 1, slopeDeg: 0, loadKg: 0 };
const rest = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

describe('physiology checks from proposal §3.1', () => {
  it('normal resting alveolar CO₂ is 5.35 kPa', () => {
    expect(alveolarPCO2(0, 200, 4.3)).toBeCloseTo(5.35, 2);
  });
  it('pure-O₂ suit at 29.6 kPa gives alveolar O₂ of 18.0 kPa', () => {
    expect(alveolarPO2PureO2(29.6, 5.3)).toBeCloseTo(18.0, 5);
  });
  it('CO₂ symptom tiers match the table', () => {
    expect(co2Effect(0.5)).toBeNull();
    expect(co2Effect(1.5)?.level).toBe('warning');
    expect(co2Effect(3.5)?.level).toBe('warning');
    expect(co2Effect(5.5)?.level).toBe('critical');
    expect(co2Effect(8.5)?.message).toMatch(/unconsciousness/);
  });
});

describe('simulate', () => {
  it('a 1 m/s flat walk with no load is 300 W', () => {
    expect(metabolicW(walk300W)).toBe(300);
  });

  it('matches the §3.4 worked example: 4 h at 300 W', () => {
    const { state } = simulate(FULL_SUIT, env, walk300W, 240);
    expect(FULL_SUIT.o2Kg - state.o2Kg).toBeCloseTo(0.306, 3);
    expect(FULL_SUIT.liohKg - state.liohKg).toBeCloseTo(0.397, 3); // 0.364 kg CO₂ × 1.09
    expect(state.elapsedMin).toBe(240);
  });

  it('does not mutate the input state', () => {
    const before = { ...FULL_SUIT };
    simulate(FULL_SUIT, env, walk300W, 60);
    expect(FULL_SUIT).toEqual(before);
  });

  it('handles fractional minutes the same as whole ones', () => {
    const a = simulate(FULL_SUIT, env, walk300W, 90.5).state;
    expect(FULL_SUIT.o2Kg - a.o2Kg).toBeCloseTo((0.306 / 240) * 90.5, 6);
  });

  it('scrubber saturation: CO₂ climbs to critical once LiOH runs out', () => {
    const { state, warnings } = simulate({ ...FULL_SUIT, liohKg: 0.01 }, env, walk300W, 15);
    expect(state.liohKg).toBe(0);
    expect(state.inspiredPCO2KPa).toBeGreaterThan(8);
    expect(warnings.find((w) => w.code === 'CO2')?.level).toBe('critical');
  });

  it('with no heat leak, the evaporator carries all 450 W: 2.64 kg water in 4 h (§3.4 upper bound)', () => {
    const { state } = simulate(FULL_SUIT, { ...env, tempC: 37 }, walk300W, 240);
    expect(FULL_SUIT.waterKg - state.waterKg).toBeCloseTo(2.64, 2);
    expect(state.coreTempC).toBeCloseTo(37, 2);
  });

  it('work hot: walking at −55 °C holds 37 °C by spending water', () => {
    const { state, warnings } = simulate(FULL_SUIT, env, walk300W, 240);
    expect(state.coreTempC).toBeCloseTo(37, 2);
    expect(FULL_SUIT.waterKg - state.waterKg).toBeCloseTo(0.86, 1); // 450 W in, ~304 W leaks out
    expect(warnings.some((w) => w.code === 'CORE_TEMP')).toBe(false);
  });

  it('rest cold: resting at −83 °C at night cools the core and uses no water', () => {
    const { state, warnings } = simulate(FULL_SUIT, { ...env, tempC: -83 }, rest, 60);
    expect(state.coreTempC).toBeLessThan(36);
    expect(state.waterKg).toBe(FULL_SUIT.waterKg);
    expect(warnings.find((w) => w.code === 'CORE_TEMP')?.level).toBe('warning');
  });

  it('sunlight slows cooling at rest', () => {
    const night = simulate(FULL_SUIT, { ...env, tempC: -83 }, rest, 60).state;
    const day = simulate(FULL_SUIT, { ...env, tempC: -83, solarWm2: 600 }, rest, 60).state;
    expect(day.coreTempC).toBeGreaterThan(night.coreTempC);
  });

  it('running out of water overheats a walker', () => {
    const warmDay = { ...env, tempC: -23, solarWm2: 500 };
    const { state, warnings } = simulate({ ...FULL_SUIT, waterKg: 0.05 }, warmDay, walk300W, 60);
    expect(state.waterKg).toBe(0);
    expect(state.coreTempC).toBeGreaterThan(39);
    expect(warnings.find((w) => w.code === 'CORE_TEMP')?.level).toBe('critical');
    expect(warnings.some((w) => w.code === 'WATER_OUT')).toBe(true);
  });

  it('hard work beyond evaporator capacity overheats even with water', () => {
    const hard = { speedMS: 1.5, slopeDeg: 5, loadKg: 20 }; // 820 W
    const { state } = simulate(FULL_SUIT, { ...env, tempC: -23 }, hard, 30);
    expect(state.waterKg).toBeGreaterThan(0);
    expect(state.coreTempC).toBeGreaterThan(38);
  });

  it('a cold astronaut warms back up to 37 °C before the evaporator cools', () => {
    const { state } = simulate({ ...FULL_SUIT, coreTempC: 36 }, env, walk300W, 60);
    expect(state.coreTempC).toBeCloseTo(37, 2);
  });

  it('warns when O₂ is low and when it runs out', () => {
    const low = simulate({ ...FULL_SUIT, o2Kg: 0.03 }, env, walk300W, 1);
    expect(low.warnings.some((w) => w.code === 'O2_LOW')).toBe(true);
    const out = simulate({ ...FULL_SUIT, o2Kg: 0.001 }, env, walk300W, 5);
    expect(out.warnings.some((w) => w.code === 'O2_OUT')).toBe(true);
  });
});
