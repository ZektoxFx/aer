import { describe, expect, it } from 'vitest';
import { daysSinceJ2000, earthMars, meanLongitude } from './heliocentric';

const day = (y: number, m: number, d: number) => daysSinceJ2000(Date.UTC(y, m - 1, d));
const sep = (d: number) => {
  const x = Math.abs(meanLongitude('Mars', d) - meanLongitude('Earth', d)) % (2 * Math.PI);
  return Math.min(x, 2 * Math.PI - x) * (180 / Math.PI);
};

describe('planet positions for the title screen (approximate)', () => {
  it('lines Earth and Mars up near the real oppositions and conjunctions', () => {
    expect(sep(day(2027, 2, 19))).toBeLessThan(20);   // opposition, 19 Feb 2027
    expect(sep(day(2025, 1, 16))).toBeLessThan(20);   // opposition, 16 Jan 2025
    expect(sep(day(2026, 1, 9))).toBeGreaterThan(160); // solar conjunction, 9 Jan 2026
  });

  it('gives a radio delay between the real extremes of about 3 and 22 minutes', () => {
    for (let d = 0; d < 800; d += 20) {
      const m = earthMars(day(2026, 1, 1) + d).lightMin;
      expect(m).toBeGreaterThan(3);
      expect(m).toBeLessThan(22);
    }
    expect(earthMars(day(2026, 1, 9)).lightMin).toBeGreaterThan(18);
  });
});
