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

/** A base power system: solar panels charging one battery (cabin, shelter, solar patch). §3.5 */
export interface PowerState {
  batteryWh: number;
  capacityWh: number;
  panelAreaM2: number;
  soiling: number;      // 0 = clean panels, 1 = fully covered by dust
}

/** Something drawing power. The order of the loads array is priority: the last one is cut first. */
export interface Load {
  id: string;
  watts: number;
}

export interface PowerResult {
  state: PowerState;
  solarW: number;                          // panel output at the end of the step
  deliveredWh: Record<string, number>;     // energy each load actually received
  shed: string[];                          // loads that lost power at any point in the step
}

/** A dust storm. All times are game minutes since the start of the run. §3.6, §6.3 */
export interface StormEvent {
  warnedAtMin: number;  // when "DUST STORM APPROACHING" appears; it arrives STORM_WARNING_LEAD_MIN later
  peakTau: number;      // dust optical depth at the worst point (10.8 was Opportunity's last reading)
  rampMin: number;      // arrival → peak
  peakMin: number;      // time at peak
  clearMin: number;     // peak → back to normal
}

export type StormPhase = 'none' | 'warning' | 'building' | 'peak' | 'clearing' | 'over';

/** Where the astronaut waits out a storm, best to worst. §6.3 */
export type Shelter = 'cabin' | 'builtShelter' | 'wreck' | 'none';

/** One straight stretch of a planned walk. Map turns waypoints into legs. */
export interface RouteLeg {
  activity: Activity;
  minutes: number;
}

export interface RouteAssessment {
  totalMin: number;
  /** The suit on arriving at the end of the route (warnings show whether you get there alive). */
  end: StepResult;
  /**
   * Point of no return: the latest minute after setting out at which turning back along the same path
   * still reaches shelter safely. Equals totalMin when you could turn back even at the end.
   * null when turning back is unsafe even right now.
   */
  turnBackByMin: number | null;
}

export interface StepResult {
  state: SuitState;
  warnings: SimWarning[];
  metabolicW: number;
}
