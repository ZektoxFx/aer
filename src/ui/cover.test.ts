import { describe, expect, it } from 'vitest';
import { metabolicW } from '../sim/simulate';
import { COVER_RADIUS_M, coverRocks, nearestCover, stormEffort, stormStrength, underCover } from './cover';

const base = { x: 3060, y: 2170 };
const area = { widthM: 6400, heightM: 4000 };

describe('coverRocks', () => {
  const rocks = coverRocks(base, area);
  it('is the same every run and stays inside the map', () => {
    expect(coverRocks(base, area)).toEqual(rocks);
    for (const r of rocks) {
      expect(r.at.x).toBeGreaterThan(0); expect(r.at.x).toBeLessThan(area.widthM);
      expect(r.at.y).toBeGreaterThan(0); expect(r.at.y).toBeLessThan(area.heightM);
    }
  });
  it('has one within about 150 m of the lander, but none on top of it', () => {
    const near = nearestCover(base, rocks)!;
    expect(near.distM).toBeGreaterThan(30);
    expect(near.distM).toBeLessThan(150);
  });
  it('has cover on the walk west to Perseverance', () => {
    expect(rocks.some((r) => r.at.x < base.x - 800 && Math.abs(r.at.y - base.y) < 300)).toBe(true);
  });
  it('knows when the astronaut is under one, and the bearing to the nearest', () => {
    const r = rocks[0];
    expect(underCover({ x: r.at.x + COVER_RADIUS_M - 1, y: r.at.y }, rocks)).toBe(true);
    expect(underCover({ x: r.at.x + COVER_RADIUS_M + 3, y: r.at.y }, [r])).toBe(false);
    const north = nearestCover({ x: r.at.x, y: r.at.y + 20 }, [r])!;
    expect(north.bearingDeg).toBeCloseTo(0, 5);
  });
});

describe('storm effort', () => {
  const walk = { speedMS: 0.8, slopeDeg: 0, loadKg: 15 };
  const rest = { speedMS: 0, slopeDeg: 0, loadKg: 0 };
  it('scales with dust τ', () => {
    expect(stormStrength(0.6)).toBe(0);
    expect(stormStrength(5)).toBeCloseTo(0.5);
    expect(stormStrength(8)).toBe(1);
  });
  it('makes walking and standing in the open burn more O₂ at the peak', () => {
    expect(metabolicW(stormEffort(walk, 1, false)) / metabolicW(walk)).toBeGreaterThan(1.5);
    expect(metabolicW(stormEffort(rest, 1, false)) / metabolicW(rest)).toBeGreaterThan(1.5);
  });
  it('changes nothing under cover or without a storm', () => {
    expect(stormEffort(walk, 1, true)).toBe(walk);
    expect(stormEffort(rest, 0, false)).toBe(rest);
  });
});
