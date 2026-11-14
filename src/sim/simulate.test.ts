import { describe, expect, it } from 'vitest';
import { FULL_SUIT, alveolarPCO2, alveolarPO2PureO2, co2Effect, metabolicW, simulate } from './simulate';
import type { Environment } from './types';

const env: Environment = { pressureKPa: 0.75, tempC: -55, windMS: 5, tau: 0.5 };
const walk300W = { speedMS: 1, slopeDeg: 0, loadKg: 0 };

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
    expect(FULL_SUIT.waterKg - state.waterKg).toBeCloseTo(2.64, 2); // 450 W through the evaporator
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

  it('warns when O₂ is low and when it runs out', () => {
    const low = simulate({ ...FULL_SUIT, o2Kg: 0.03 }, env, walk300W, 1);
    expect(low.warnings.some((w) => w.code === 'O2_LOW')).toBe(true);
    const out = simulate({ ...FULL_SUIT, o2Kg: 0.001 }, env, walk300W, 5);
    expect(out.warnings.some((w) => w.code === 'O2_OUT')).toBe(true);
  });
});
