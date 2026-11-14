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
}

export interface DataPack {
  source: string;       // attribution: mission / instrument / product, or "FAKE"
  imageUrl: string;     // base map image covering `area`, relative to /public
  area: { name: string; lat: number; lon: number; widthM: number; heightM: number };
  /** Elevation grid, row-major from the north-west corner. */
  elevation: { cols: number; rows: number; cellM: number; heightsM: number[] };
  sols: SolWeather[];
}
