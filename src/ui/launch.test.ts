import { describe, expect, it } from 'vitest';
import { ascentAt, downrangeAt, EVENTS, LAUNCH_MS, LAUNCH_SEG, launchClock, launchEvent, pitchAt } from './launch';

describe('launch profile', () => {
  it('stays on the pad until liftoff, then climbs and speeds up steadily', () => {
    expect(ascentAt(-2)).toEqual({ alt: 0, v: 0 });
    let prev = ascentAt(0);
    for (let t = 1; t <= 260; t += 1) {
      const s = ascentAt(t);
      expect(s.alt).toBeGreaterThanOrEqual(prev.alt);
      expect(s.v).toBeGreaterThanOrEqual(prev.v);
      prev = s;
    }
  });
  it('puts max-Q low and main engine cut-off high, in that order', () => {
    expect(EVENTS.maxQ).toBeLessThan(EVENTS.meco);
    expect(EVENTS.meco).toBeLessThan(EVENTS.sep);
    expect(ascentAt(EVENTS.maxQ).alt).toBeLessThan(20_000);
    expect(ascentAt(EVENTS.meco).alt).toBeGreaterThan(50_000);
  });
  it('flies straight up first, then turns over and moves downrange', () => {
    expect(pitchAt(5)).toBe(0);
    expect(pitchAt(150)).toBeGreaterThan(45);
    expect(pitchAt(150)).toBeLessThan(70);
    expect(downrangeAt(10)).toBe(0);
    expect(downrangeAt(150)).toBeGreaterThan(downrangeAt(100));
  });
  it('maps animation time onto the mission clock, end to end', () => {
    expect(LAUNCH_MS).toBe(Math.round(LAUNCH_SEG.reduce((a, s) => a + s.s, 0) * 1000));
    expect(launchClock(0)).toMatchObject({ stage: 'pad', t: -10 });
    expect(launchClock(LAUNCH_MS / 1000).t).toBe(200);
    expect(launchClock(99).stage).toBe('ascent');
    expect(launchEvent(-5)).toBe('TERMINAL COUNT');
    expect(launchEvent(EVENTS.sep + 1)).toBe('STAGE SEPARATION');
  });
});
