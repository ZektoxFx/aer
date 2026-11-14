import type { SolWeather } from '../data/types';
import { simulate } from '../sim/simulate';
import type { Activity, Environment, SimWarning, SuitState } from '../sim/types';

/** One sample on the strip charts. */
export interface TelemetryPoint {
  min: number;
  state: SuitState;
  metabolicW: number;
  warnings: SimWarning[];
}

/** Suit environment for a sol. Uses the mean of the day's min and max temperature. */
export function solEnvironment(sol: SolWeather): Environment {
  return {
    pressureKPa: sol.pressureKPa,
    tempC: (sol.tempMinC + sol.tempMaxC) / 2,
    windMS: sol.windMS,
    tau: sol.tau,
  };
}

/**
 * Steps the suit simulation over a walk, sampling every `stepMin` minutes, for the strip charts.
 * The first point is the starting suit at minute 0.
 */
export function runTelemetry(
  start: SuitState,
  env: Environment,
  activity: Activity,
  totalMin: number,
  stepMin: number,
): TelemetryPoint[] {
  const points: TelemetryPoint[] = [{ min: 0, state: start, metabolicW: 0, warnings: [] }];
  let state = start;
  for (let min = stepMin; min <= totalMin; min += stepMin) {
    const r = simulate(state, env, activity, stepMin);
    state = r.state;
    points.push({ min, state, metabolicW: r.metabolicW, warnings: r.warnings });
  }
  return points;
}
