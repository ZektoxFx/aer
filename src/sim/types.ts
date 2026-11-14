// Shared contract: Map and UI call simulate() with these types.
// Change it only after telling the whole team.

export interface SuitState {
  o2Kg: number;             // breathing O₂ left
  liohKg: number;           // unused LiOH scrubber capacity
  waterKg: number;          // cooling + drinking water
  batteryWh: number;
  inspiredPCO2KPa: number;  // CO₂ in the gas the astronaut breathes
  coreTempC: number;
  elapsedMin: number;
}

/** Conditions at the astronaut's position right now. */
export interface Environment {
  pressureKPa: number;
  tempC: number;
  windMS: number;
  tau: number;
  /** Sunlight reaching the surface, W/m² (from PSG for τ and sun angle). Omit or 0 at night. */
  solarWm2?: number;
}

/** What the astronaut is doing. speedMS = 0 means resting. */
export interface Activity {
  speedMS: number;
  slopeDeg: number;   // positive = uphill
  loadKg: number;     // carried scrap and gear
}

export type WarningCode = 'O2_LOW' | 'O2_OUT' | 'CO2' | 'WATER_OUT' | 'BATTERY_LOW' | 'BATTERY_OUT' | 'CORE_TEMP';

export interface SimWarning {
  code: WarningCode;
  level: 'warning' | 'critical';
  message: string;
}

export interface StepResult {
  state: SuitState;
  warnings: SimWarning[];
  metabolicW: number;
}
