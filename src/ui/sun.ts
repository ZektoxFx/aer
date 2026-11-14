import { localHour, sunElevationDeg } from '../sim/game';
import type { GameState } from '../sim/types';

// Where the Sun is in Jezero's sky, for day and night in the 3D view and the HUD's sun dial.
// Elevation comes from the sim (NASA geometry when the data pack has the sky table). The compass direction uses the
// same geometry: Mars' axial tilt is 25.19°, so the Sun's declination is asin(sin 25.19° · sin Ls).

/** Jezero Crater's latitude, used when the data pack has no sky block. */
export const JEZERO_LAT_DEG = 18.44;

export interface SunPosition {
  /** Local True Solar Time, hours. */
  hour: number;
  /** Height above the horizon, degrees (negative at night). */
  elevationDeg: number;
  /** Compass direction, degrees clockwise from north (90 = east). */
  azimuthDeg: number;
  /** Unit vector toward the Sun in the 3D world: x east, y up, z south (map y). */
  dir: { x: number; y: number; z: number };
}

export function sunPosition(clockMin: number, sky?: GameState['sky']): SunPosition {
  const r = Math.PI / 180;
  const lat = (sky?.latDeg ?? JEZERO_LAT_DEG) * r;
  const dec = sky ? Math.asin(Math.sin(25.19 * r) * Math.sin(sky.lsDeg * r)) : 0;
  const hour = localHour(clockMin);
  const h = (hour - 12) * 15 * r;
  const east = -Math.cos(dec) * Math.sin(h);
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(h);
  const azimuthDeg = ((Math.atan2(east, north) / r) % 360 + 360) % 360;
  const elevationDeg = sunElevationDeg(clockMin, sky);
  const ce = Math.cos(elevationDeg * r);
  return {
    hour, elevationDeg, azimuthDeg,
    dir: { x: ce * Math.sin(azimuthDeg * r), y: Math.sin(elevationDeg * r), z: -ce * Math.cos(azimuthDeg * r) },
  };
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Eight-point compass name for a bearing in degrees. */
export const compassPoint = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/**
 * Where to draw the Sun on the HUD dial, a circle with the horizon across the middle (facing south, so east is on
 * the left): noon at the top, midnight at the bottom. Returns x, y in −1..1 (y up).
 */
export function dialPoint(hour: number): { x: number; y: number } {
  const a = ((hour - 12) / 24) * Math.PI * 2;
  return { x: Math.sin(a), y: Math.cos(a) };
}
