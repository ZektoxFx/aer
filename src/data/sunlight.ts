import type { SunlightTable } from './files';

// Pure helpers over sunlight.json. Simulation can pass the result as Environment.solarWm2.

function bracket(axis: number[], v: number): [number, number, number] {
  if (v <= axis[0]) return [0, 0, 0];
  const last = axis.length - 1;
  if (v >= axis[last]) return [last, last, 0];
  let i = 0;
  while (axis[i + 1] < v) i++;
  return [i, i + 1, (v - axis[i]) / (axis[i + 1] - axis[i])];
}

/** Sunlight on flat ground, W/m², interpolated in the NASA table. 0 when the sun is down. */
export function solarWm2(t: SunlightTable, tau: number, sunElevationDeg: number, lsDeg?: number): number {
  if (sunElevationDeg <= 0) return 0;
  const [a0, a1, fa] = bracket(t.tau, tau);
  const [b0, b1, fb] = bracket(t.sunElevationDeg, sunElevationDeg);
  const g = t.globalHorizontalWm2;
  const v0 = g[a0][b0] * (1 - fb) + g[a0][b1] * fb;
  const v1 = g[a1][b0] * (1 - fb) + g[a1][b1] * fb;
  const flux = v0 * (1 - fa) + v1 * fa;
  return lsDeg === undefined ? flux : flux * distanceFactor(lsDeg);
}

/** Mars–Sun distance correction to the mean-distance table (NASA TM-103623). */
export function distanceFactor(lsDeg: number): number {
  const e = 0.093377;
  return (1 + e * Math.cos(((lsDeg - 248) * Math.PI) / 180)) ** 2 / (1 - e * e) ** 2;
}

/** Sun elevation (degrees) for a latitude, season (Ls) and Local True Solar Time in hours. */
export function sunElevationDeg(latDeg: number, lsDeg: number, ltstHours: number): number {
  const r = Math.PI / 180;
  const dec = Math.asin(Math.sin(25.19 * r) * Math.sin(lsDeg * r));
  const h = (ltstHours - 12) * 15 * r;
  const s = Math.sin(latDeg * r) * Math.sin(dec) + Math.cos(latDeg * r) * Math.cos(dec) * Math.cos(h);
  return Math.asin(s) / r;
}
