import { describe, expect, it } from 'vitest';
import { pointScale, sunDirection } from './sky3d';

describe('3D sky helpers', () => {
  it('points toward the sun in world axes (x east, y up, z south)', () => {
    const east = sunDirection(90, 0);
    expect(east.x).toBeCloseTo(1);
    expect(east.y).toBeCloseTo(0);
    expect(east.z).toBeCloseTo(0);
    const south = sunDirection(180, 0);
    expect(south.x).toBeCloseTo(0);
    expect(south.z).toBeCloseTo(1);
    const west = sunDirection(270, 30);
    expect(west.x).toBeCloseTo(-Math.cos(Math.PI / 6));
    expect(west.y).toBeCloseTo(0.5);
    expect(sunDirection(123, 90).y).toBeCloseTo(1);
    expect(sunDirection(200, 40).length()).toBeCloseTo(1);
  });

  it('sizes sprites in metres: one metre at one metre fills half the height at a 90 degree view', () => {
    expect(pointScale(720, 90)).toBeCloseTo(360);
    expect(pointScale(720, 55)).toBeGreaterThan(pointScale(720, 68)); // a narrower view magnifies
  });
});
