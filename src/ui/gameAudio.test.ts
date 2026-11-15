import { describe, expect, it } from 'vitest';
import { breathsPerMin, windLevel } from './gameAudio';

describe('game sound levels', () => {
  it('breathes about 12 times a minute at rest, faster with effort and with high CO₂, within 10–32', () => {
    expect(breathsPerMin(100, 0.1)).toBeCloseTo(12, 0);
    expect(breathsPerMin(400, 0.1)).toBeGreaterThan(breathsPerMin(100, 0.1) + 8);
    expect(breathsPerMin(100, 4)).toBeGreaterThan(breathsPerMin(100, 0.1));
    expect(breathsPerMin(2000, 9)).toBe(32);
    expect(breathsPerMin(0, 0)).toBeGreaterThanOrEqual(10);
  });
  it('makes the wind louder with wind speed and much louder in a storm, never above 1', () => {
    expect(windLevel(3, 0)).toBeLessThan(windLevel(15, 0));
    expect(windLevel(3, 1)).toBeGreaterThan(windLevel(20, 0));
    expect(windLevel(40, 1)).toBe(1);
  });
});
