import { describe, expect, it } from 'vitest';
import { FULL_SUIT } from '../sim/simulate';
import { runTelemetry, solEnvironment } from './telemetry';

const SOL = { sol: 1, pressureKPa: 0.75, tempMinC: -83, tempMaxC: -23, windMS: 5, tau: 0.5 };
const WALK = { speedMS: 1, slopeDeg: 0, loadKg: 10 };

describe('solEnvironment', () => {
  it('uses the mean of min and max temperature', () => {
    expect(solEnvironment(SOL).tempC).toBe(-53);
  });
});

describe('runTelemetry', () => {
  it('samples from minute 0 to the end at each step', () => {
    const pts = runTelemetry(FULL_SUIT, solEnvironment(SOL), WALK, 60, 15);
    expect(pts.map((p) => p.min)).toEqual([0, 15, 30, 45, 60]);
    expect(pts[0].state).toBe(FULL_SUIT);
  });

  it('uses up oxygen as the walk goes on', () => {
    const pts = runTelemetry(FULL_SUIT, solEnvironment(SOL), WALK, 60, 15);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].state.o2Kg).toBeLessThan(pts[i - 1].state.o2Kg);
    }
  });
});
