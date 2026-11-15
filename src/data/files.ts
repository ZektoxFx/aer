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
  ls: number;                 // solar longitude of this sol, degrees (season)
  tau: number;                // Mastcam-Z dust optical depth, 630 nm
  tauFromSol: number;         // the sol the tau was measured on (nearest available)
  pressurePa: [number, number, number] | null;   // lowest, mean, highest of all 1 Hz readings
  airTempC: [number, number, number] | null;     // min, mean, max of the hourly means
  windMS: [number, number] | null;               // mean, 99th percentile of all readings
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

/** content.json: game content. Amounts marked `values` are design values to tune, not data. */
export interface ContentFile {
  about: string;
  materials: { id: string; name: string; note: string }[];
  supplies: { id: string; name: string; massKg: number; gives: Record<string, number>; note: string; values: string }[];
  rocketPieces: {
    id: string;
    name: string;
    massKg: number;
    breakdownMin: number;
    yields: Record<string, number>;           // material id -> kg
    mayContain?: Record<string, [number, number]>;
    note?: string;
    values: string;
  }[];
  recipes: {
    id: string;
    name: string;
    needs: Record<string, number>;            // material id -> kg
    buildMin: number;
    knowledge: 'training' | 'manual' | 'manual_required';
    manualPage?: number;                      // pageNumber in jezero_pack.json fieldManualPages
    does: string;
    catch: string;
    values: string;
  }[];
  improvise: { materialsMultiplier: number; timeMultiplier: number; failChance: number; rule: string; values: string };
  historyCards: { poiId: string; title: string; text: string; sources: string[]; photos: string[] }[];
  scienceTarget: { poiId: string; name: string; why: string; alternatives: string[] };
}

/** credits.json: text for the credits screen and chart labels. Replace {sol} in chartLabels. */
export interface CreditsFile {
  heading: string;
  intro: string;
  dataSources: { what: string; mission: string; instrument: string; product: string; provider: string; citation: string; credit: string }[];
  imageCredits: string[];
  /** Sound and music credits (the Mars wind recording, the CC0 music). */
  audioCredits?: string[];
  fiction: string;
  aiDisclosure: string[];
  noAffiliation: string;
  chartLabels: Record<'pressure' | 'airTemp' | 'groundTemp' | 'wind' | 'dust' | 'sunlight' | 'map', string>;
}

/** terrain_patch_2m.json: header for terrain_patch_2m.bin, a 2 m height tile around the AER-1 cabin (load with terrainPatch.ts). */
export interface TerrainPatchMeta {
  source: string;
  use: string;
  file: string;
  cols: number;
  rows: number;
  cellM: number;
  /** North-west corner of the tile in the jezero_pack.json elevation frame (metres from the map's NW corner, x east, y south). */
  x0M: number;
  y0M: number;
  centre: { what: string; eastM: number; northM: number };
  minM: number;
  maxM: number;
  /** heightM = minM + uint16 value * scaleM */
  scaleM: number;
  checkAgainst10mGrid: { meanAbsDiffM: number; maxAbsDiffM: number };
  notes: string[];
}

/** relay.json: when Perseverance can reach a relay orbiter (NASA Mars Relay Network Handbook). */
export interface RelayFile {
  source: string;
  use: string;
  jezeroLatDeg: number;
  orbiters: {
    id: string;
    name: string;
    orbit: string;
    periodMin: number;
    /** Local mean solar time of the orbit's two equator crossings; null when the orbit is not Sun-synchronous. */
    nodesLMST: string[] | null;
    passesPerSol?: string;
    usablePassMin?: [number, number];
    shortPassMin?: [number, number];
    averagePassMin?: number;
    typicalSessionMin?: number;
    note: string;
  }[];
  notMoreAvailable: Record<string, string>;
  /** A simple daily schedule for the game: one pass inside each window. */
  gameWindowsLTST: {
    about: string;
    windows: { orbiter: string; centre: string; fromHour: number; toHour: number; passMin: number }[];
    values: string;
  };
}

/** terrain_tiles.json: sharper HiRISE photo tiles for the 3D view, drawn over jezero_base_2m.jpg (built by tools/data/bake_tiles.py). */
export interface TerrainTilesFile {
  source: string;
  use: string;
  frame: string;
  credit: string;
  tiles: {
    file: string;
    metresPerPixel: number;
    /** North-west corner of the tile in the jezero_pack.json frame (metres from the map's NW corner, x east, y south). */
    x0M: number;
    y0M: number;
    widthM: number;
    heightM: number;
    cols: number;
    rows: number;
  }[];
}

/** dustdevils.json: dust devil (vortex) timing and size at Jezero from MEDA. */
export interface DustDevilFile {
  source: string;
  use: string;
  perSol: number;
  perSolNote: string;
  peakPerHourNoon: number;
  peakNote: string;
  dustyFraction: number;
  dustyNote: string;
  diameterM: { min: number; mean: number; max: number };
  strongest: { dropPa: number; windMS: number; note: string };
  activityPerKm2PerSol: [number, number];
  pressureDropPa: { min: number; median: number; max: number; over1Pa: number; over2Pa: number };
  duringStorm: string;
  /** 24 entries, hour 0-23 LTST. expectedPerSol sums to perSol. */
  hourlyLTST: { hour: number; vortices: number; dusty: number; expectedPerSol: number }[];
  notes: string[];
}
