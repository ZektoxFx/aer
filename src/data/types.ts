// Shared contract: Data bakes files in this shape; Map, Sim and UI read them.
// Change it only after telling the whole team.

/** One sol of Perseverance MEDA weather, already averaged by the Data role. */
export interface SolWeather {
  sol: number;          // Perseverance mission sol number
  pressureKPa: number;  // mean surface pressure
  tempMinC: number;
  tempMaxC: number;
  windMS: number;       // mean wind speed, m/s
  tau: number;          // dust optical depth (≈0.5 clear, >5 storm)
  label?: string;
  scenario?: string;
  notes?: string;
}

export interface HardwareSite {
  id: string;
  name: string;
  type: string;
  sol: number;
  lat: number;
  lon: number;
  eastingM: number;
  northingM: number;
  history: string;
  scientificValue: string;
  clue?: string;
}

export interface RockFormation {
  id: string;
  name: string;
  type: string;
  associatedTarget: string;
  mineralogy: string;
  elementsOxidesWtPercent: Record<string, number>;
  description: string;
  survivalApplication?: string;
  isruYields?: {
    extractableWaterWtPercent: number;
    bakingTempRequiredC: number;
    perchlorateContentWtPercent: number;
    hazardWarning: string;
  };
}

export interface RoverWaypoint {
  sol: number;
  site: number;
  drive: number;
  lat: number;
  lon: number;
  eastingM: number;
  northingM: number;
  elevGeoidM: number;
  totalDistM: number;
  note: string;
}

export interface SupplyItem {
  id: string;
  name: string;
  type: string;
  eastingM: number;
  northingM: number;
  description: string;
  scrapYield?: Record<string, number>;
  suppliesYield?: Record<string, number>;
}

export interface FieldManualPage {
  pageNumber: number;
  title: string;
  category: string;
  unlocksRecipe: string;
  sciencePrinciple: string;
  source: string;
  diagram: string;
}

export interface MarsVisuals {
  daylightSky: { colorHex: string; description: string; mieScattering: string };
  sunsetSky: { colorHex: string; description: string; timing: string };
  terrainColors: Record<string, string>;
  lighting: { solarConstantWm2: number; shadowSharpness: string; stormDarkness: string };
}

export interface CrashedLander {
  name: string;
  designation: string;
  imageUrl: string;
  cabinLocation: { lat: number; lon: number; eastingM: number; northingM: number; description: string };
  technicalSpecs: Record<string, unknown>;
}

export interface DataPack {
  source: string;       // attribution: mission / instrument / product, or "FAKE"
  imageUrl: string;     // base map image covering `area`, relative to /public
  area: {
    name: string;
    lat: number;
    lon: number;
    widthM: number;
    heightM: number;
    eMin?: number;
    eMax?: number;
    nMin?: number;
    nMax?: number;
  };
  /** Elevation grid, row-major from the north-west corner. */
  elevation: { cols: number; rows: number; cellM: number; heightsM: number[] };
  sols: SolWeather[];

  // Optional extensions baked from NASA and simulation telemetry
  crashedLander?: CrashedLander;
  hardwareSites?: HardwareSite[];
  rockFormations?: RockFormation[];
  roverWaypoints?: RoverWaypoint[];
  scatteredSupplies?: SupplyItem[];
  fieldManualPages?: FieldManualPage[];
  marsVisuals?: MarsVisuals;
}
