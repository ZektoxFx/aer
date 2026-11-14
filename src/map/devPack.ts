// SYNTHETIC terrain for developing the map before the Data role's real Jezero files arrive.
// It is shaped like the Jezero delta area (raised fan with a steep front, a cut channel, small craters,
// a ridge and dunes) but the heights are made up. Never present it as real data.
import type { DataPack } from '../data/types';

export const DEV_SOURCE = 'SYNTHETIC terrain (dev only, not real data)';

/** Deterministic pseudo-random in [0, 1) for a grid corner. */
function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Fractal noise in roughly [-1, 1]. */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x, y, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp /= 2; x *= 2; y *= 2;
  }
  return sum / norm;
}

const smooth = (e0: number, e1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Small impact craters as fractions of the area: centre, radius (m), depth (m). */
export const DEV_CRATERS = [
  { fx: 0.47, fy: 0.42, rM: 160, depthM: 22 },
  { fx: 0.78, fy: 0.3, rM: 95, depthM: 12 },
  { fx: 0.3, fy: 0.74, rM: 70, depthM: 9 },
  { fx: 0.85, fy: 0.8, rM: 55, depthM: 7 },
];

/**
 * Build a synthetic pack: `size` cells per side at `cellM` metres.
 * Area, place name and sols are copied from `base` (the Data role's pack) when given.
 */
export function makeDevPack(base?: DataPack, size = 150, cellM = 20, seed = 7): DataPack {
  const w = size * cellM;
  const heights: number[] = new Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const x = (c + 0.5) * cellM, y = (r + 0.5) * cellM;
      const fx = x / w, fy = y / w;
      let h = -2565;

      // Regional tilt: crater floor dips gently to the south-east.
      h -= (fx + fy) * 8;

      // Delta fan in the north-west: a raised lobe with a steep, wavy front (about 30° in places).
      const lobe = Math.hypot((fx - 0.05) / 0.5, (fy - 0.08) / 0.42) + fbm(fx * 6, fy * 6, seed + 3) * 0.06;
      h += 38 * (1 - smooth(0.82, 0.9, lobe));
      // Terraced layers on top of the fan.
      h += 2.5 * Math.sin(lobe * 60) * (1 - smooth(0.7, 0.85, lobe));

      // Old river channel cut through the fan, running from the north edge to the south-east.
      const along = fx - 0.12 - fy * 0.45;
      h -= 14 * Math.exp(-((along / 0.025) ** 2)) * (1 - smooth(0.85, 0.95, lobe));

      // A long low ridge across the east.
      const ridge = (fx - 0.7) * 0.6 + (fy - 0.55) * -0.8;
      h += 9 * Math.exp(-((ridge / 0.03) ** 2)) * smooth(0.25, 0.4, fy);

      // Craters: bowl plus raised rim.
      for (const k of DEV_CRATERS) {
        const d = Math.hypot(x - k.fx * w, y - k.fy * w) / k.rM;
        if (d < 1) h -= k.depthM * (1 - d * d);
        h += k.depthM * 0.35 * Math.exp(-(((d - 1) / 0.25) ** 2));
      }

      // Dune field in the south-east: regular ripples.
      const duneMask = smooth(0.55, 0.7, fx) * smooth(0.55, 0.68, fy);
      h += duneMask * 2.2 * Math.sin((fx * 0.8 + fy * 0.6) * 90 + fbm(fx * 8, fy * 8, seed + 9) * 3);

      // Rough ground everywhere.
      h += fbm(fx * 14, fy * 14, seed) * 2.5 + fbm(fx * 60, fy * 60, seed + 1, 2) * 0.6;

      heights[r * size + c] = Math.round(h * 100) / 100;
    }
  }
  return {
    source: DEV_SOURCE,
    imageUrl: '',
    area: { name: base?.area.name ?? 'Jezero Crater (synthetic)', lat: base?.area.lat ?? 18.44, lon: base?.area.lon ?? 77.45, widthM: w, heightM: w },
    elevation: { cols: size, rows: size, cellM, heightsM: heights },
    sols: base?.sols ?? [{ sol: 1, pressureKPa: 0.75, tempMinC: -83, tempMaxC: -23, windMS: 5, tau: 0.5 }],
  };
}
