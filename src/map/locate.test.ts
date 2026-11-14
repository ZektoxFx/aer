import { describe, expect, it } from 'vitest';
import { geoToLocal, JEZERO, localToGeo, MARS_M_PER_DEG, niceScale, shotAt, ZOOM_ALT, ZOOM_S } from './locate';

describe('locating shot (orbit → cabin)', () => {
  const cabin = { lat: 18.4485, lon: 77.4402 };

  it('puts the cabin inside Jezero crater, west of its centre', () => {
    const j = geoToLocal(JEZERO.lat, JEZERO.lon, cabin);
    expect(j.x).toBeGreaterThan(0); // the centre is east of the cabin
    expect(Math.hypot(j.x, j.z)).toBeLessThan(JEZERO.radiusM);
  });

  it('converts lat/lon to metres and back', () => {
    expect(geoToLocal(cabin.lat + 1, cabin.lon, cabin).z).toBeCloseTo(-MARS_M_PER_DEG, 3);
    const p = localToGeo(1234, -567, cabin);
    const q = geoToLocal(p.lat, p.lon, cabin);
    expect(q.x).toBeCloseTo(1234, 6);
    expect(q.z).toBeCloseTo(-567, 6);
  });

  it('drops from orbit to low altitude, aims at the cabin, then tilts and locks', () => {
    expect(shotAt(0).alt).toBeCloseTo(ZOOM_ALT.from, 0);
    expect(shotAt(0).stage).toBe('orbit');
    expect(shotAt(0).aim).toBe(0);
    const end = shotAt(ZOOM_S.descend);
    expect(end.alt).toBeCloseTo(ZOOM_ALT.to, 0);
    expect(end.aim).toBe(1);
    expect(end.tilt).toBe(0);
    const last = shotAt(ZOOM_S.descend + ZOOM_S.tilt + ZOOM_S.hold);
    expect(last.tilt).toBe(1);
    expect(last.stage).toBe('locked');
    let prev = Infinity;
    for (let t = 0; t <= ZOOM_S.descend; t += 0.1) { const a = shotAt(t).alt; expect(a).toBeLessThanOrEqual(prev + 1e-6); prev = a; }
  });

  it('picks round scale-bar lengths that fit', () => {
    expect(niceScale(10, 120)).toMatchObject({ m: 1000, label: '1 km' });
    expect(niceScale(0.9, 120).m).toBe(100);
    expect(niceScale(3, 120).m).toBe(200);
    expect(niceScale(3, 120).px).toBeLessThanOrEqual(120);
  });
});
