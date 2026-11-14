// Map geometry: map metres, terrain sampling, slope and lat/lon.
// Map coordinates are metres from the area's north-west corner: x grows east, y grows south.
// Pure functions only, so they are easy to test.
import type { DataPack } from '../data/types';

export interface Pt { x: number; y: number }

/** Mean radius of Mars (m), for lat/lon conversion. */
const MARS_RADIUS_M = 3_389_500;
const M_PER_DEG_LAT = (Math.PI * MARS_RADIUS_M) / 180;

export type Elevation = DataPack['elevation'];

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Height (m) at a map point, bilinear between grid cell centres; clamped at the edges. */
export function heightAt(el: Elevation, p: Pt): number {
  const gx = Math.min(Math.max(p.x / el.cellM - 0.5, 0), el.cols - 1);
  const gy = Math.min(Math.max(p.y / el.cellM - 0.5, 0), el.rows - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, el.cols - 1), y1 = Math.min(y0 + 1, el.rows - 1);
  const fx = gx - x0, fy = gy - y0;
  const h = (c: number, r: number) => el.heightsM[r * el.cols + c];
  const top = h(x0, y0) * (1 - fx) + h(x1, y0) * fx;
  const bot = h(x0, y1) * (1 - fx) + h(x1, y1) * fx;
  return top * (1 - fy) + bot * fy;
}

/** Steepest ground slope (degrees, always ≥ 0) at a point, from central differences. */
export function slopeAt(el: Elevation, p: Pt): number {
  const d = el.cellM;
  const dzdx = (heightAt(el, { x: p.x + d, y: p.y }) - heightAt(el, { x: p.x - d, y: p.y })) / (2 * d);
  const dzdy = (heightAt(el, { x: p.x, y: p.y + d }) - heightAt(el, { x: p.x, y: p.y - d })) / (2 * d);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

/** Slope along a short step from a to b (degrees; positive = uphill). */
export function stepSlope(el: Elevation, a: Pt, b: Pt): number {
  const run = dist(a, b);
  if (run === 0) return 0;
  return (Math.atan((heightAt(el, b) - heightAt(el, a)) / run) * 180) / Math.PI;
}

/** Map point → latitude/longitude (degrees), around the area's centre. */
export function toLatLon(area: DataPack['area'], p: Pt): { lat: number; lon: number } {
  const lat = area.lat - (p.y - area.heightM / 2) / M_PER_DEG_LAT;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((area.lat * Math.PI) / 180);
  return { lat, lon: area.lon + (p.x - area.widthM / 2) / mPerDegLon };
}

/** Evenly spaced points from a to b, at most `stepM` apart (includes both ends). */
export function samplePath(a: Pt, b: Pt, stepM: number): Pt[] {
  const n = Math.max(1, Math.ceil(dist(a, b) / stepM));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Is a point inside a polygon (ray casting)? */
export function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Shaded-relief value per grid cell (0 = dark, 1 = lit), sun from the north-west at 35° altitude.
 * `exaggerate` makes gentle Mars terrain readable on screen; it never changes the slope numbers.
 */
export function hillshade(el: Elevation, exaggerate = 3): Float32Array {
  const out = new Float32Array(el.cols * el.rows);
  const az = (315 * Math.PI) / 180, alt = (35 * Math.PI) / 180;
  const h = (c: number, r: number) =>
    el.heightsM[Math.min(Math.max(r, 0), el.rows - 1) * el.cols + Math.min(Math.max(c, 0), el.cols - 1)];
  for (let r = 0; r < el.rows; r++) {
    for (let c = 0; c < el.cols; c++) {
      const dzdx = ((h(c + 1, r) - h(c - 1, r)) / (2 * el.cellM)) * exaggerate;
      const dzdy = ((h(c, r + 1) - h(c, r - 1)) / (2 * el.cellM)) * exaggerate;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const v = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
      out[r * el.cols + c] = Math.min(1, Math.max(0, v));
    }
  }
  return out;
}
