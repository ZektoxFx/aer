import { simulate } from './simulate';
import type { Environment, RouteAssessment, RouteLeg, StepResult, SuitState } from './types';

/** O₂ the astronaut must still have on arriving back at shelter (~40 min at rest) [verify]. */
export const O2_RESERVE_KG = 0.05;
const ENV_SAMPLE_MIN = 10; // re-read conditions at least this often so a storm arriving mid-leg counts

/** Conditions at a given game minute (e.g. built from conditionsAt() and a storm). */
export type EnvAt = (gameMin: number) => Environment;

/** Walk the same path back: legs in reverse order, uphill becomes downhill. Only the first `doneMin` count. */
export function returnPath(legs: RouteLeg[], doneMin: number): RouteLeg[] {
  const back: RouteLeg[] = [];
  let left = doneMin;
  for (const leg of legs) {
    if (left <= 0) break;
    const minutes = Math.min(leg.minutes, left);
    back.unshift({ minutes, activity: { ...leg.activity, slopeDeg: -leg.activity.slopeDeg } });
    left -= minutes;
  }
  return back;
}

/** Simulate a series of legs in small chunks so changing conditions are picked up. */
function walk(start: SuitState, legs: RouteLeg[], envAt: EnvAt, onChunk?: (r: StepResult) => boolean): StepResult {
  let last: StepResult = { state: start, warnings: [], metabolicW: 0 };
  for (const leg of legs) {
    for (let done = 0; done < leg.minutes; ) {
      const minutes = Math.min(ENV_SAMPLE_MIN, leg.minutes - done);
      last = simulate(last.state, envAt(last.state.elapsedMin), leg.activity, minutes);
      if (onChunk && !onChunk(last)) return last;
      done += minutes;
    }
  }
  return last;
}

/** Would heading back along `path` from `state` reach shelter with no critical alarm and the O₂ reserve intact? */
export function canReturn(state: SuitState, path: RouteLeg[], envAt: EnvAt): boolean {
  let safe = true;
  const end = walk(state, path, envAt, (r) => (safe = !r.warnings.some((w) => w.level === 'critical')));
  return safe && end.state.o2Kg >= O2_RESERVE_KG;
}

/**
 * Cost out a planned route and find its point of no return, checked every minute.
 * Assumes supplies only run down, so once turning back is unsafe it stays unsafe.
 */
export function assessRoute(start: SuitState, legs: RouteLeg[], envAt: EnvAt): RouteAssessment {
  const totalMin = legs.reduce((sum, l) => sum + l.minutes, 0);
  const minuteLegs = legs.flatMap((l) => {
    const whole = Math.floor(l.minutes);
    const parts = Array.from({ length: whole }, () => ({ activity: l.activity, minutes: 1 }));
    return l.minutes > whole ? [...parts, { activity: l.activity, minutes: l.minutes - whole }] : parts;
  });

  let turnBackByMin: number | null = canReturn(start, [], envAt) ? 0 : null;
  let passedIt = turnBackByMin === null;
  const end = walk(start, minuteLegs, envAt, (r) => {
    if (!passedIt) {
      const outMin = r.state.elapsedMin - start.elapsedMin;
      if (canReturn(r.state, returnPath(legs, outMin), envAt)) turnBackByMin = outMin;
      else passedIt = true;
    }
    return true; // keep walking to the end either way, to report the arrival state
  });

  return { totalMin, end, turnBackByMin };
}
