import { describe, expect, it } from 'vitest';
import { REPLAY_S, replayView, START_VIEW_M, trailAdd, trailCut, trailLength } from './replayPath';

describe('route replay', () => {
  it('keeps a breadcrumb only every few metres', () => {
    const t: { x: number; y: number }[] = [];
    for (let x = 0; x <= 100; x += 1) trailAdd(t, { x, y: 0 }, 10);
    expect(t.length).toBe(11);
    expect(trailLength(t)).toBeCloseTo(100, 6);
  });

  it('thins the trail by half when it grows too long, keeping the start and the latest point', () => {
    const t: { x: number; y: number }[] = [];
    for (let x = 0; x <= 50; x += 1) trailAdd(t, { x, y: 0 }, 1, 40);
    expect(t.length).toBeLessThanOrEqual(40);
    expect(t[0]).toEqual({ x: 0, y: 0 });
    expect(t[t.length - 1].x).toBe(50);
  });

  it('cuts the trail by distance, ending part-way along a segment', () => {
    const t = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const half = trailCut(t, 0.5);
    expect(half[half.length - 1]).toEqual({ x: 100, y: 0 });
    const q = trailCut(t, 0.25);
    expect(q[q.length - 1]).toEqual({ x: 50, y: 0 });
    expect(trailCut(t, 1)).toEqual(t);
    expect(trailCut(t, 0)).toEqual([{ x: 0, y: 0 }]);
  });

  it('starts close over the end point and pulls back to the whole map', () => {
    const area = { widthM: 6400, heightM: 4000 };
    const end = { x: 1000, y: 3000 };
    const a = replayView(0, end, area, 800, 500);
    expect(a.cx).toBe(1000);
    expect(a.mPerPx * 800).toBeCloseTo(START_VIEW_M, 6);
    const b = replayView(REPLAY_S + 1, end, area, 800, 500);
    expect(b.cx).toBe(3200);
    expect(b.cy).toBe(2000);
    expect(b.mPerPx).toBeCloseTo(8, 6);
    const m = replayView(REPLAY_S / 2, end, area, 800, 500);
    expect(m.mPerPx).toBeGreaterThan(a.mPerPx);
    expect(m.mPerPx).toBeLessThan(b.mPerPx);
  });
});
