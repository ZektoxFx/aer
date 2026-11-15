// Map role: the camera path and geometry for the "locating" shot (OrbitZoom.tsx), kept pure so it can be tested.
// After the crash the suit's navigation computer finds the astronaut: the view drops from orbit onto Jezero
// crater, onto the real HiRISE map tile, and settles on the AER-1 cabin.

/** Metres per degree of latitude on Mars (mean radius 3389.5 km). */
export const MARS_M_PER_DEG = (2 * Math.PI * 3_389_500) / 360;

/** Jezero crater, approximate centre and size (NASA: "45-kilometer-wide"; centre ≈ 18.38°N 77.58°E). */
export const JEZERO = { lat: 18.38, lon: 77.58, radiusM: 22_500 };

/** Seconds of each part of the shot. */
export const ZOOM_S = { descend: 7.0, tilt: 2.8, hold: 2.3 };
export const ORBIT_ZOOM_MS = Math.round((ZOOM_S.descend + ZOOM_S.tilt + ZOOM_S.hold) * 1000);

/** Start and end height of the drop (m above the cabin), and the final oblique view. */
export const ZOOM_ALT = { from: 420_000, to: 1_800 };
export const OBLIQUE = { distM: 1_250, elevDeg: 34, headingDeg: 20, orbitDeg: 12 };

export interface GeoRef { lat: number; lon: number }

/** Latitude/longitude → metres from `ref` in the map's frame (x east, z south). Fine over a few hundred km. */
export function geoToLocal(lat: number, lon: number, ref: GeoRef): { x: number; z: number } {
  const k = MARS_M_PER_DEG;
  return { x: (lon - ref.lon) * k * Math.cos((ref.lat * Math.PI) / 180), z: -(lat - ref.lat) * k };
}

/** The inverse of geoToLocal. */
export function localToGeo(x: number, z: number, ref: GeoRef): GeoRef {
  const k = MARS_M_PER_DEG;
  return { lat: ref.lat - z / k, lon: ref.lon + x / (k * Math.cos((ref.lat * Math.PI) / 180)) };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export type ZoomStage = 'orbit' | 'crater' | 'site' | 'locked';
export interface Shot {
  /** Camera height above the cabin during the drop (m). */
  alt: number;
  /** 0 = aiming at Jezero's centre, 1 = aiming at the cabin. */
  aim: number;
  /** 0 = looking straight down, 1 = the final oblique view. */
  tilt: number;
  /** Heading of the oblique camera from the cabin (degrees from east toward south). */
  headingDeg: number;
  stage: ZoomStage;
}

/** Where the camera is `T` seconds into the shot. */
export function shotAt(T: number): Shot {
  const { descend: D, tilt: TL, hold: H } = ZOOM_S;
  const e = easeInOut(clamp01(T / D));
  const alt = Math.exp(Math.log(ZOOM_ALT.from) + (Math.log(ZOOM_ALT.to) - Math.log(ZOOM_ALT.from)) * e);
  const tilt = easeInOut(clamp01((T - D) / TL));
  const headingDeg = OBLIQUE.headingDeg + OBLIQUE.orbitDeg * clamp01((T - D) / (TL + H));
  const stage: ZoomStage = T > D + TL * 0.85 ? 'locked' : T > D || alt < 7_000 ? 'site' : alt < 60_000 ? 'crater' : 'orbit';
  return { alt, aim: smooth(0.25, 0.8, e), tilt, headingDeg, stage };
}

/** A round scale-bar length for `mPerPx` metres per pixel that is at most `maxPx` wide. */
export function niceScale(mPerPx: number, maxPx = 120): { m: number; px: number; label: string } {
  const raw = mPerPx * maxPx;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = [5, 2, 1].map((f) => f * p).find((v) => v <= raw) ?? p;
  return { m, px: m / mPerPx, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}
