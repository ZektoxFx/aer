import { describe, expect, it } from 'vitest';
import type { SolWeather } from '../data/types';
import { SPEED_X, forecast, localHour, newGame, sunElevationDeg, tick, weatherAt } from './game';
import { BASE_LOADS } from './power';
import { FULL_SUIT } from './simulate';
import { MIN_PER_SOL, makeStorm } from './storm';
import type { GameState } from './types';

// Sol 13 from the Jezero data pack (MEDA)
const sol13: SolWeather = { sol: 13, pressureKPa: 0.628, tempMinC: -79.2, tempMaxC: -12.4, windMS: 3.8, tau: 0.45 };
const at = (hour: number) => (hour / 24) * MIN_PER_SOL;
const walk = { speedMS: 1, slopeDeg: 0, loadKg: 0 };

describe('time of day', () => {
  it('converts game minutes to local hours, wrapping each sol', () => {
    expect(localHour(at(13.5))).toBeCloseTo(13.5, 6);
    expect(localHour(MIN_PER_SOL + at(2))).toBeCloseTo(2, 6);
  });
  it('the sun peaks at noon, rises at 06:00 and is below the horizon at midnight', () => {
    expect(sunElevationDeg(at(12))).toBeCloseTo(70, 6);
    expect(sunElevationDeg(at(6))).toBeCloseTo(0, 6);
    expect(sunElevationDeg(at(0))).toBeLessThan(0);
  });
  it('MEDA temperatures: coldest at 06:00, warmest at 14:00', () => {
    expect(weatherAt(sol13, at(6)).tempC).toBeCloseTo(-79.2, 6);
    expect(weatherAt(sol13, at(14)).tempC).toBeCloseTo(-12.4, 6);
    const midnight = weatherAt(sol13, at(0)).tempC;
    expect(midnight).toBeGreaterThan(-79.2);
    expect(midnight).toBeLessThan(-12.4);
  });
});

describe('game clock', () => {
  it('a new run starts in the cabin at 08:00 with a full suit, clock and suit in sync', () => {
    const g = newGame(sol13);
    expect(localHour(g.clockMin)).toBeCloseTo(8, 6);
    expect(g.shelter).toBe('cabin');
    expect(g.suit).toEqual({ ...FULL_SUIT, elapsedMin: g.clockMin });
  });

  it('paused: nothing changes', () => {
    const g = newGame(sol13);
    const r = tick(g, 5, true);
    expect(r.speed).toBe('paused');
    expect(r.state.clockMin).toBe(g.clockMin);
    expect(r.state.suit.o2Kg).toBe(g.suit.o2Kg);
  });

  it('walking runs at time warp: 1 real second = 1 game minute', () => {
    const g = { ...newGame(sol13), activity: walk, shelter: 'none' as const };
    const r = tick(g, 1);
    expect(SPEED_X.traverse).toBe(60);
    expect(r.speed).toBe('traverse');
    expect(r.state.clockMin - g.clockMin).toBeCloseTo(1, 9);
    expect(g.suit.o2Kg - r.state.suit.o2Kg).toBeCloseTo(0.0765 / 60, 9); // 300 W for one minute
  });

  it('a storm warning slows the clock to 24× (5 real minutes = 2 Mars hours)', () => {
    const g0 = newGame(sol13);
    const g = { ...g0, storm: makeStorm(g0.clockMin) };
    const r = tick(g, 60);
    expect(r.speed).toBe('storm');
    expect(r.state.clockMin - g.clockMin).toBeCloseTo(24, 9);
  });

  it('a critical alarm drops the clock to 1×', () => {
    const g = { ...newGame(sol13), suit: { ...newGame(sol13).suit, liohKg: 0, inspiredPCO2KPa: 9 } };
    const r = tick(g, 60);
    expect(r.speed).toBe('emergency');
    expect(r.state.clockMin - g.clockMin).toBeCloseTo(1, 9);
  });

  it('clock and suit stay in sync over many frames', () => {
    let g: GameState = { ...newGame(sol13), activity: walk, shelter: 'none' };
    for (let i = 0; i < 300; i++) g = tick(g, 1 / 60).state;
    expect(g.suit.elapsedMin).toBeCloseTo(g.clockMin, 6);
  });

  it('cabin loads draw on the cabin battery at night', () => {
    const g0 = newGame(sol13);
    const g = { ...g0, clockMin: at(23), suit: { ...g0.suit, elapsedMin: at(23) }, loads: [BASE_LOADS.moxie] };
    const r = tick(g, 60); // one game hour
    expect(g.power.batteryWh - r.state.power.batteryWh).toBeCloseTo(300, 6);
  });
});

describe('forecast', () => {
  const env = { pressureKPa: 0.63, tempC: -55, windMS: 4, tau: 0.45 };
  it('O₂ at a 300 W walk lasts ~470 min from full', () => {
    expect(forecast(FULL_SUIT, env, walk).o2Min).toBeCloseTo(0.6 / (0.0765 / 60), 1);
  });
  it('resting in the cold uses no cooling water, so water never runs out', () => {
    expect(forecast(FULL_SUIT, env, { speedMS: 0, slopeDeg: 0, loadKg: 0 }).waterMin).toBe(Infinity);
  });
  it('an empty tank reads 0, not infinity', () => {
    expect(forecast({ ...FULL_SUIT, o2Kg: 0 }, env, walk).o2Min).toBe(0);
  });
});
