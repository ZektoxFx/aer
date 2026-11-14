import { describe, expect, it } from 'vitest';
import { MIN_PER_SOL } from '../sim/storm';
import { dustDevilsActive, minutesToDustDevils, nextSunEvent, stormForecastAt, upcomingEvents } from './environment';

const at = (day: number, hour: number) => day * MIN_PER_SOL + (hour / 24) * MIN_PER_SOL;

describe('environment timeline', () => {
  it('forecasts the storm for 15:00 local time on the first day, or the next day if already past', () => {
    expect(stormForecastAt(at(0, 8))).toBeCloseTo(at(0, 15));
    expect(stormForecastAt(at(0, 16))).toBeCloseTo(at(1, 15));
  });

  it('runs dust devils around the MEDA midday peak', () => {
    expect(dustDevilsActive(at(0, 12.5))).toBe(true);
    expect(dustDevilsActive(at(0, 9))).toBe(false);
    expect(minutesToDustDevils(at(0, 12))).toBe(0);
    expect(minutesToDustDevils(at(0, 10))).toBeCloseTo(MIN_PER_SOL / 24);
    expect(minutesToDustDevils(at(0, 15))).toBeCloseTo((20 / 24) * MIN_PER_SOL);
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
