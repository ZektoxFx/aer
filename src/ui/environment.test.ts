import { describe, expect, it } from 'vitest';
import { MIN_PER_SOL } from '../sim/storm';
import type { DustDevilFile } from '../data/files';
import { dustDevilsActive, dustDevilsInView, minutesToDustDevils, nextSunEvent, stormForecastAt, upcomingEvents } from './environment';

const at = (day: number, hour: number) => day * MIN_PER_SOL + (hour / 24) * MIN_PER_SOL;

describe('environment timeline', () => {
  it('forecasts the storm for 15:00 local time on the first day, or the next day if already past', () => {
    expect(stormForecastAt(at(0, 8))).toBeCloseTo(at(0, 15));
    expect(stormForecastAt(at(0, 16))).toBeCloseTo(at(1, 15));
  });

  it('without the MEDA file, runs dust devils in the 11:00–14:00 fallback window', () => {
    expect(dustDevilsActive(at(0, 12.5))).toBe(true);
    expect(dustDevilsActive(at(0, 9))).toBe(false);
    expect(minutesToDustDevils(at(0, 12))).toBe(0);
    // Found in 10-minute steps, so within 10 minutes of the true start.
    expect(Math.abs(minutesToDustDevils(at(0, 10)) - MIN_PER_SOL / 24)).toBeLessThanOrEqual(10);
  });

  it("with Data's MEDA file, shows devils by the hour's share of the noon peak", () => {
    const rates: Record<number, number> = { 9: 0.05, 10: 0.3, 11: 0.6, 12: 1.0, 13: 0.9, 14: 0.4, 15: 0.1 };
    const file = { hourlyLTST: Array.from({ length: 24 }, (_, hour) => ({ hour, vortices: 0, dusty: 0, expectedPerSol: rates[hour] ?? 0 })) } as unknown as DustDevilFile;
    expect(dustDevilsInView(at(0, 12.5), file)).toBe(2); // peak
    expect(dustDevilsInView(at(0, 10.5), file)).toBe(1); // 30% of peak
    expect(dustDevilsInView(at(0, 9.5), file)).toBe(0);  // 5%: too rare to show
    expect(dustDevilsInView(at(0, 3), file)).toBe(0);
    expect(minutesToDustDevils(at(0, 3), file)).toBeGreaterThan(0);
  });

  it('finds the next sunset in the afternoon and sunrise at night (built-in sun: 06:00 and 18:00)', () => {
    const set = nextSunEvent(at(0, 15))!;
    expect(set.kind).toBe('sunset');
    expect(set.inMin).toBeCloseTo((3 / 24) * MIN_PER_SOL, -1);
    expect(nextSunEvent(at(0, 22))!.kind).toBe('sunrise');
  });

  it('lists upcoming events soonest first and drops a storm that has passed', () => {
    const ev = upcomingEvents(at(0, 8), at(0, 15));
    expect(ev.map((e) => e.id)).toEqual(['devils', 'storm', 'sun']);
    expect(ev.find((e) => e.id === 'storm')!.hazard).toBe(true);
    expect(upcomingEvents(at(0, 16), at(0, 15)).some((e) => e.id === 'storm')).toBe(false);
  });
});
