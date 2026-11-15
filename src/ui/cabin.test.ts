import { describe, expect, it } from 'vitest';
import { CABIN_S, CRUISE, cruiseAt, marsAngularRadius } from './cabin';

describe('intro cabin cruise (time-lapse of a 203-day transfer)', () => {
  it('runs the days from 1 to 203 and ends just before entry', () => {
    expect(cruiseAt(0).day).toBeCloseTo(1, 5);
    const end = cruiseAt(CABIN_S.lapse);
    expect(end.day).toBeCloseTo(CRUISE.days, 1);
    expect(end.marsKm).toBeCloseTo(CRUISE.entryKm, 0);
    let prev = 0;
    for (let t = 0; t <= CABIN_S.lapse; t += 0.1) { const d = cruiseAt(t).day; expect(d).toBeGreaterThanOrEqual(prev); prev = d; }
  });

  it('gives an Earth signal delay of about 11 minutes at arrival', () => {
    expect(cruiseAt(CABIN_S.lapse).signalMin).toBeGreaterThan(11);
    expect(cruiseAt(CABIN_S.lapse).signalMin).toBeLessThan(12);
  });

  it('keeps Mars a dot until the final approach, then it fills the window', () => {
    expect(marsAngularRadius(cruiseAt(CABIN_S.lapse * 0.5).marsKm)).toBeLessThan(0.001);
    expect(marsAngularRadius(cruiseAt(CABIN_S.lapse).marsKm)).toBeGreaterThan(0.15);
  });

  it('sounds the alarm only after the time-lapse', () => {
    expect(cruiseAt(CABIN_S.lapse - 0.1).alarm).toBe(0);
    expect(cruiseAt(CABIN_S.lapse + 0.5).alarm).toBe(1);
  });
});
