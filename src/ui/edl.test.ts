import { describe, expect, it } from 'vitest';
import { edlTimeline, MARS_G, MARS_SOUND, simulateEdl, timelinePos } from './edl';

describe('intro landing physics (LOCAL DRAFT)', () => {
  const run = simulateEdl();
  const { events: e, samples } = run;
  const last = samples[samples.length - 1];

  it('heats up most high in the atmosphere, then cools', () => {
    const peak = samples.find((s) => s.heat === 1)!;
    expect(peak.h).toBeGreaterThan(20_000);
    expect(peak.h).toBeLessThan(80_000);
    expect(samples.find((s) => s.chute === 'open')!.heat).toBeLessThan(0.05);
  });

  it('slows from orbital speed with a peak deceleration of several g', () => {
    const peakG = Math.max(...samples.map((s) => s.gLoad));
    expect(peakG).toBeGreaterThan(5);
    expect(peakG).toBeLessThan(25);
  });

  it('opens the parachute, tears it, fires the retros, then hits the ground hard but slower than free fall', () => {
    expect(e.chute).toBeLessThan(e.tear);
    expect(e.tear).toBeLessThan(e.retro);
    expect(e.retro).toBeLessThan(e.impact);
    expect(last.v).toBeGreaterThan(10);
    expect(last.v).toBeLessThan(80);
  });

  it('falls under Mars gravity, not Earth gravity', () => {
    const vac = simulateEdl({ h0: 1000, v0: 0.001, gammaDeg: -90, beta: 1e12, betaChute: 1e12, retroH: -1 });
    const t = vac.events.impact;
    expect(t).toBeCloseTo(Math.sqrt((2 * 1000) / MARS_G), 0);
  });
});

describe('descent timeline bar', () => {
  const run = simulateEdl();
  const marks = edlTimeline(run);

  it('lists the events in time order, with only the story failures marked failed', () => {
    for (let i = 1; i < marks.length; i++) expect(marks[i].t).toBeGreaterThan(marks[i - 1].t);
    expect(marks.filter((m) => m.failed).map((m) => m.id)).toEqual(['tear', 'retro', 'impact']);
  });

  it('places time on the bar from 0 to 1, each mark at its even step', () => {
    expect(timelinePos(marks, -5)).toBe(0);
    expect(timelinePos(marks, marks[2].t)).toBeCloseTo(2 / 6, 6);
    expect(timelinePos(marks, run.events.impact + 1)).toBe(1);
    const mid = timelinePos(marks, (marks[0].t + marks[1].t) / 2);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1 / 6);
  });

  it('enters at around Mach 20 or more', () => {
    expect(run.samples[0].v / MARS_SOUND).toBeGreaterThan(20);
  });
});
