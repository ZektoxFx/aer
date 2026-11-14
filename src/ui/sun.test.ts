import { describe, expect, it } from 'vitest';
import { MIN_PER_SOL } from '../sim/storm';
import type { GameState } from '../sim/types';
import { compassPoint, dialPoint, sunPosition } from './sun';

const at = (hour: number) => (hour / 24) * MIN_PER_SOL;

describe('sunPosition', () => {
  it('rises in the east, is south at noon (Jezero is north of the equator), and sets in the west', () => {
    expect(sunPosition(at(6.5)).azimuthDeg).toBeGreaterThan(60);
    expect(sunPosition(at(6.5)).azimuthDeg).toBeLessThan(120);
    expect(sunPosition(at(12)).azimuthDeg).toBeCloseTo(180, 0);
    expect(sunPosition(at(17.5)).azimuthDeg).toBeGreaterThan(240);
    expect(sunPosition(at(17.5)).azimuthDeg).toBeLessThan(300);
  });

  it('is up by day and down at night, and the 3D direction agrees', () => {
    const noon = sunPosition(at(12)), night = sunPosition(at(0));
    expect(noon.elevationDeg).toBeGreaterThan(40);
    expect(noon.dir.y).toBeGreaterThan(0.6);
    expect(noon.dir.z).toBeGreaterThan(0); // south is +z
    expect(night.elevationDeg).toBeLessThan(0);
    expect(night.dir.y).toBeLessThan(0);
    const d = noon.dir;
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
  });

  it('uses the season when the data pack has sky geometry', () => {
    const sky = { table: {}, latDeg: 18.44, lsDeg: 90 } as unknown as NonNullable<GameState['sky']>; // the table isn't used here
    // Northern summer: the noon Sun stands higher than at the equinox.
    expect(sunPosition(at(12), sky).elevationDeg).toBeGreaterThan(sunPosition(at(12)).elevationDeg - 25);
    expect(sunPosition(at(9), sky).azimuthDeg).toBeLessThan(180);
  });
});

describe('dial and compass', () => {
  it('puts sunrise on the left, noon on top, sunset on the right', () => {
    expect(dialPoint(6).x).toBeCloseTo(-1);
    expect(dialPoint(12).y).toBeCloseTo(1);
    expect(dialPoint(18).x).toBeCloseTo(1);
    expect(dialPoint(0).y).toBeCloseTo(-1);
  });
  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(95)).toBe('E');
    expect(compassPoint(225)).toBe('SW');
    expect(compassPoint(350)).toBe('N');
  });
});
