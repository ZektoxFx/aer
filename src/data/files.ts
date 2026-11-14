// Types for the extra baked files in public/data/ (beside jezero_pack.json, whose type is DataPack in types.ts).
// Owned by the Data role. These are new files, so adding types here does not change the shared contract.
// Where each value comes from: docs/DATA_SOURCES.md.

/** pois.json: points of interest and the rover's real traverse inside the map area. */
export interface PoiFile {
  source: string;
  coordinates: string;
  pois: Poi[];
  traverse: { sol: number; lengthM: number; pointsXY: [number, number][] }[];
}

export type PoiKind = 'nasa_site' | 'nasa_hardware' | 'science_sample' | 'rover_candidate';

export interface Poi {
  id: string;
  name: string;
  kind: PoiKind;
  /** Metres from the map's north-west corner: x to the east, y to the south (same frame as the elevation grid). */
  xM: number;
  yM: number;
  /** Metres east / north of the landing site. */
  eastM: number;
  northM: number;
  lon: number;
  lat: number;
  elevM?: number;
  waypointSol?: number;
  note?: string;
  photos?: string[];          // file names in /data/photos/
  positionAccuracyM?: number;
  // science samples
  sampleNo?: number;
  target?: string;
  solSealed?: number;
  sampleType?: string;
  copyInThreeForksDepot?: boolean;
  distanceFromLandingM?: number;
}

/** layers_20m.json: per-cell terrain layers on a 20 m grid, row-major from the north-west corner. */
export interface TerrainLayers {
  source: string;
  cols: number;
  rows: number;
  cellM: number;
  slopeDeg: number[];
  roughnessM: number[];
  thermalInertia: number[];   // J m^-2 K^-1 s^-1/2
  /** Index into terrainClassNames: 0 firm, 1 rocky, 2 loose sand likely, 3 steep > 25°, 4 cliff > 35°. */
  terrainClass: number[];
  terrainClassNames: string[];
}

/** weather.json: one entry per sampled sol of Perseverance MEDA data. */
export interface WeatherFile {
  source: string;
  notes: string[];
  sols: WeatherSol[];
}

export interface WeatherSol {
  sol: number;
  ls: number;                 // solar longitude, degrees (season)
  tau: number;                // Mastcam-Z dust optical depth, 630 nm
  tauFromSol: number;         // the sol the tau was measured on (nearest available)
  pressurePa: [number, number, number] | null;   // min, mean, max of hourly means
  airTempC: [number, number, number] | null;
  windMS: [number, number] | null;               // mean, 99th percentile
  /** Arrays of 24 values by Local True Solar Time hour; null where MEDA had no data. */
  hourly: Partial<Record<'pressurePa' | 'airTempC' | 'windMS' | 'windDirDeg' | 'groundTempC' | 'skyTempC' | 'downLW_Wm2', (number | null)[]>>;
  medaFiles: string[] | null;
}

/** dust.json: dust optical depth record, including the real Jan 2022 Jezero storm. */
export interface DustFile {
  source: string;
  channel: string;
  tauDaily: Record<string, number>;   // sol -> median tau
  lsBySol: Record<string, number>;
  jezeroStorm2022: {
    description: string;
    daily: { sol: number; tau: number | null; pressurePa: number[] | null; airTempC: number[] | null; windMS: number[] | null }[];
    /** Every Mastcam-Z measurement in sols 300-330; sol is decimal (sol + LTST/24). */
    measurements: { sol: number; tau: number; ls: number }[];
  };
  references: Record<string, unknown>;
}

/** sunlight.json: surface sunlight by dust and sun elevation (NASA TM-103623). */
export interface SunlightTable {
  source: string;
  use: string;
  albedo: number;
  tau: number[];
  sunElevationDeg: number[];
  globalHorizontalWm2: number[][];    // [tauIndex][elevationIndex]
  beamHorizontalWm2: number[][];
  notes: string[];
  distanceFactor: { formula: string; byLsDeg: Record<string, number> };
  sunElevation: { formula: string; jezeroLatDeg: number };
}
