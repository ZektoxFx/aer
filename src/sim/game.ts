import type { SunlightTable } from '../data/files';
import { sunElevationDeg as nasaSunElevationDeg, solarWm2 as nasaSolarWm2 } from '../data/sunlight';
import type { SolWeather } from '../data/types';
import { BASE_LOADS, CABIN_POWER, approxSolarWm2, powerStep } from './power';
import { FULL_SUIT, simulate } from './simulate';
import { MIN_PER_SOL, conditionsAt, shelterEnvironment, soilingAfter, stormPhase, type SolarFn } from './storm';
import type { Activity, ClockSpeed, Environment, Forecast, GameState, SuitState, TickResult } from './types';

/** Game minutes per real minute at each clock speed (§6.4). traverse is a design value to tune in playtesting. */
// traverse was 60×; 40× keeps 3D walking readable on screen (0.8 m/s shows as ~32 m/s) with the same cost per metre.
export const SPEED_X: Record<ClockSpeed, number> = { paused: 0, traverse: 40, storm: 24, emergency: 1 };

const REST: Activity = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

/**
 * A new run: in the cabin at 08:00 local time on sol 0, with a full suit. Pass `sky` to use NASA sunlight data.
 * Scenario-specific starts (e.g. Sol 1's crash-damaged canister) are set by the UI's scenario code (src/ui/sol1.ts).
 */
export function newGame(weather: SolWeather, sky?: GameState['sky']): GameState {
  const clockMin = (8 / 24) * MIN_PER_SOL;
  return {
    clockMin, weather, activity: REST, shelter: 'cabin', power: CABIN_POWER, loads: [], storm: null, sky,
    suit: { ...FULL_SUIT, elapsedMin: clockMin },
  };
}

/**
 * Sunlight from NASA's table (TM-103623) for the season.
 * shortcut: the table stops at τ 6, so above that its τ-6 value is dimmed further by the approximate fit's ratio.
 */
export function nasaSolar(table: SunlightTable, lsDeg: number): SolarFn {
  const maxTau = table.tau[table.tau.length - 1];
  return (tau, elev) => {
    if (tau <= maxTau) return nasaSolarWm2(table, tau, elev, lsDeg);
    const atMax = approxSolarWm2(maxTau, elev);
    return atMax > 0 ? nasaSolarWm2(table, maxTau, elev, lsDeg) * (approxSolarWm2(tau, elev) / atMax) : 0;
  };
}

/** Local solar hour, 0–24. */
export function localHour(clockMin: number): number {
  return ((((clockMin % MIN_PER_SOL) + MIN_PER_SOL) % MIN_PER_SOL) / MIN_PER_SOL) * 24;
}

/**
 * Sun height above the horizon; negative at night. With `sky`, real geometry for the site's latitude and season.
 * shortcut (no sky): sunrise 06:00, sunset 18:00, 70° at noon (Jezero is at 18° N), no seasons.
 */
export function sunElevationDeg(clockMin: number, sky?: GameState['sky']): number {
  if (sky) return nasaSunElevationDeg(sky.latDeg, sky.lsDeg, localHour(clockMin));
  return 70 * Math.sin(((localHour(clockMin) - 6) / 12) * Math.PI);
}

/**
 * Outdoor weather at this time of day from one sol of MEDA data.
 * shortcut: coldest at 06:00, warmest at 14:00, smooth curves between.
 */
export function weatherAt(sol: SolWeather, clockMin: number): Environment {
  const h = localHour(clockMin);
  const warming = h >= 6 && h < 14;
  const t = warming ? (h - 6) / 8 : ((h + 24 - 14) % 24) / 16;
  const warmth = warming ? (1 - Math.cos(Math.PI * t)) / 2 : (1 + Math.cos(Math.PI * t)) / 2;
  return {
    pressureKPa: sol.pressureKPa,
    tempC: sol.tempMinC + (sol.tempMaxC - sol.tempMinC) * warmth,
    windMS: sol.windMS,
    tau: sol.tau,
  };
}

/** Outdoor conditions right now, with time of day and any storm applied. */
export function outdoorEnv(s: GameState): Environment {
  const solar = s.sky ? nasaSolar(s.sky.table, s.sky.lsDeg) : approxSolarWm2;
  return conditionsAt(weatherAt(s.weather, s.clockMin), s.storm, s.clockMin, sunElevationDeg(s.clockMin, s.sky), solar);
}

/** Emergency (1×) on any critical alarm, 24× while a storm is approaching, otherwise time warp. */
export function pickSpeed(s: GameState, outside: Environment): ClockSpeed {
  const now = simulate(s.suit, shelterEnvironment(outside, s.shelter), s.activity, 0);
  if (now.warnings.some((w) => w.level === 'critical')) return 'emergency';
  if (s.storm && ['warning', 'building'].includes(stormPhase(s.storm, s.clockMin))) return 'storm';
  return 'traverse';
}

/**
 * Advance the game by `realSeconds` of wall-clock time. Pure: returns a new state.
 * Conditions are read once per tick, so call it every frame (or at least every second), not with big jumps.
 */
export function tick(s: GameState, realSeconds: number, paused = false): TickResult {
  const env = outdoorEnv(s);
  const speed: ClockSpeed = paused ? 'paused' : pickSpeed(s, env);
  const gameMin = (realSeconds / 60) * SPEED_X[speed];

  const suitEnv = shelterEnvironment(env, s.shelter);
  const suit = simulate(s.suit, suitEnv, s.activity, gameMin);

  // In the cabin the suit plugs into cabin power. The charger refills what the suit's electronics used, up to its
  // rating, and goes first in the load list so it is the last load cut when the cabin runs short.
  const docked = s.shelter === 'cabin';
  const charger = BASE_LOADS.suitCharger;
  const chargerW = docked && gameMin > 0
    ? Math.min(charger.watts, ((FULL_SUIT.batteryWh - suit.state.batteryWh) * 60) / gameMin)
    : 0;
  const loads = docked
    ? [...(chargerW > 0 ? [{ id: charger.id, watts: chargerW }] : []), ...s.loads.filter((l) => l.id !== charger.id)]
    : s.loads;
  const power = powerStep(s.power, env, loads, gameMin);
  const soiling = soilingAfter(power.state.soiling, env.tau, gameMin);

  const chargedWh = docked ? (power.deliveredWh[charger.id] ?? 0) : 0;
  const suitState = { ...suit.state, batteryWh: Math.min(FULL_SUIT.batteryWh, suit.state.batteryWh + chargedWh) };
  const warnings = docked ? simulate(suitState, suitEnv, s.activity, 0).warnings : suit.warnings;
  const fc = forecast(suitState, suitEnv, s.activity);
  const charging = docked && !power.shed.includes(charger.id);

  return {
    state: { ...s, clockMin: s.clockMin + gameMin, suit: suitState, power: { ...power.state, soiling } },
    env, speed, warnings, power,
    forecast: charging ? { ...fc, batteryMin: Infinity } : fc,
  };
}

/** Minutes until each consumable runs out at the current rate, for the HUD ("O₂ out in 2:14"). */
export function forecast(suit: SuitState, env: Environment, activity: Activity): Forecast {
  const next = simulate(suit, env, activity, 1).state;
  const minutesLeft = (now: number, after: number) => (now <= 0 ? 0 : now > after ? now / (now - after) : Infinity);
  return {
    o2Min: minutesLeft(suit.o2Kg, next.o2Kg),
    scrubberMin: minutesLeft(suit.liohKg, next.liohKg),
    waterMin: minutesLeft(suit.waterKg, next.waterKg),
    batteryMin: minutesLeft(suit.batteryWh, next.batteryWh),
  };
}
