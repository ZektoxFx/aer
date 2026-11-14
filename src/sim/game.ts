import type { SolWeather } from '../data/types';
import { CABIN_POWER, powerStep } from './power';
import { FULL_SUIT, simulate } from './simulate';
import { MIN_PER_SOL, conditionsAt, shelterEnvironment, soilingAfter, stormPhase } from './storm';
import type { Activity, ClockSpeed, Environment, Forecast, GameState, SuitState, TickResult } from './types';

/** Game minutes per real minute at each clock speed (§6.4). traverse is a design value to tune in playtesting. */
export const SPEED_X: Record<ClockSpeed, number> = { paused: 0, traverse: 60, storm: 24, emergency: 1 };

const REST: Activity = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

/** A new run: in the cabin at 08:00 local time on sol 0, with a full suit. */
export function newGame(weather: SolWeather): GameState {
  const clockMin = (8 / 24) * MIN_PER_SOL;
  return {
    clockMin, weather, activity: REST, shelter: 'cabin', power: CABIN_POWER, loads: [], storm: null,
    suit: { ...FULL_SUIT, elapsedMin: clockMin },
  };
}

/** Local solar hour, 0–24. */
export function localHour(clockMin: number): number {
  return ((((clockMin % MIN_PER_SOL) + MIN_PER_SOL) % MIN_PER_SOL) / MIN_PER_SOL) * 24;
}

/**
 * Sun height above the horizon; negative at night.
 * shortcut: sunrise 06:00, sunset 18:00, 70° at noon (Jezero is at 18° N); ignores the season.
 */
export function sunElevationDeg(clockMin: number): number {
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
  return conditionsAt(weatherAt(s.weather, s.clockMin), s.storm, s.clockMin, sunElevationDeg(s.clockMin));
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

  const suit = simulate(s.suit, shelterEnvironment(env, s.shelter), s.activity, gameMin);
  const power = powerStep(s.power, env, s.loads, gameMin);
  const soiling = soilingAfter(power.state.soiling, env.tau, gameMin);

  return {
    state: { ...s, clockMin: s.clockMin + gameMin, suit: suit.state, power: { ...power.state, soiling } },
    env, speed, warnings: suit.warnings, power,
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
