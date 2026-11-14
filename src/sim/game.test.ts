import { describe, expect, it } from 'vitest';
import sunRaw from '../../public/data/sunlight.json?raw';
import type { SunlightTable } from '../data/files';
import { solarWm2 } from '../data/sunlight';
import type { SolWeather } from '../data/types';
import {
  CRASH_CANISTER_LIOH_KG, SPEED_X, forecast, localHour, nasaSolar, newGame, outdoorEnv, sunElevationDeg, tick, weatherAt,
} from './game';
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

  it('cabin loads draw on the cabin battery at night, including the docked suit', () => {
    const g0 = newGame(sol13);
    const g = { ...g0, clockMin: at(23), suit: { ...g0.suit, elapsedMin: at(23) }, loads: [BASE_LOADS.moxie] };
    const r = tick(g, 60); // one game hour
    expect(g.power.batteryWh - r.state.power.batteryWh).toBeCloseTo(380, 6); // MOXIE 300 W + suit electronics 80 W
    expect(r.state.suit.batteryWh).toBeCloseTo(FULL_SUIT.batteryWh, 6);
  });
});

describe('cabin charging', () => {
  const atNight = (g: GameState): GameState => ({ ...g, clockMin: at(23), suit: { ...g.suit, elapsedMin: at(23) } });

  it('docked in the cabin, the suit battery refills from cabin power', () => {
    const g0 = atNight(newGame(sol13));
    const g = { ...g0, suit: { ...g0.suit, batteryWh: 300 } };
    const r = tick(g, 60); // one game hour: 200 W charger − 80 W electronics = +120 Wh
    expect(r.state.suit.batteryWh).toBeCloseTo(420, 6);
    expect(g.power.batteryWh - r.state.power.batteryWh).toBeCloseTo(200, 6);
    expect(r.forecast.batteryMin).toBe(Infinity);
  });

  it('never charges past full', () => {
    const g0 = atNight(newGame(sol13));
    const r = tick({ ...g0, suit: { ...g0.suit, batteryWh: FULL_SUIT.batteryWh - 10 } }, 60);
    expect(r.state.suit.batteryWh).toBeCloseTo(FULL_SUIT.batteryWh, 6);
  });

  it('with the cabin battery flat at night, the charger is cut and the suit drains', () => {
    const g0 = atNight(newGame(sol13));
    const r = tick({ ...g0, power: { ...g0.power, batteryWh: 0 } }, 60);
    expect(r.power.shed).toContain('suitCharger');
    expect(r.state.suit.batteryWh).toBeCloseTo(FULL_SUIT.batteryWh - 80, 6);
    expect(Number.isFinite(r.forecast.batteryMin)).toBe(true);
  });

  it('outside the cabin nothing charges the suit', () => {
    const g0 = atNight(newGame(sol13));
    const r = tick({ ...g0, shelter: 'none' }, 60);
    expect(r.state.suit.batteryWh).toBeCloseTo(FULL_SUIT.batteryWh - 80, 6);
    expect(r.state.power.batteryWh).toBe(g0.power.batteryWh);
    expect(Number.isFinite(r.forecast.batteryMin)).toBe(true);
  });
});

describe('scenario start', () => {
  it('Scrubber Saturation starts with the partly used canister from the crash', () => {
    const g = newGame({ ...sol13, scenario: 'Sol 1: Scrubber Saturation' });
    expect(g.suit.liohKg).toBe(CRASH_CANISTER_LIOH_KG);
    expect(g.suit.o2Kg).toBe(FULL_SUIT.o2Kg);
  });
  it('other scenarios start with a full suit', () => {
    expect(newGame({ ...sol13, scenario: 'Sol 2: Cooling and Water' }).suit.liohKg).toBe(FULL_SUIT.liohKg);
  });
});

describe('NASA sky (sunlight.json)', () => {
  const table = JSON.parse(sunRaw) as SunlightTable;
  const sky = (lsDeg: number) => ({ table, latDeg: 18.44, lsDeg });

  it('at the equinox the noon sun stands 90° − latitude high', () => {
    expect(sunElevationDeg(at(12), sky(0))).toBeCloseTo(90 - 18.44, 1);
  });

  it('northern-summer days at Jezero are longer than winter days', () => {
    expect(sunElevationDeg(at(6), sky(90))).toBeGreaterThan(0);  // already up at 06:00
    expect(sunElevationDeg(at(6), sky(270))).toBeLessThan(0);    // still dark at 06:00
  });

  it('inside the table, sunlight is exactly NASA’s value', () => {
    expect(nasaSolar(table, 0)(0.45, 50)).toBeCloseTo(solarWm2(table, 0.45, 50, 0), 9);
  });

  it('beyond the table’s τ 6, storms keep getting darker, never negative', () => {
    const f = nasaSolar(table, 0);
    expect(f(8, 50)).toBeLessThan(f(6, 50));
    expect(f(10.8, 50)).toBeLessThan(f(8, 50));
    expect(f(10.8, 50)).toBeGreaterThan(0);
    expect(f(8, -5)).toBe(0);
  });

  it('with NASA data a τ 8 storm still cuts sunlight to under 20% of a clear day', () => {
    const f = nasaSolar(table, 0);
    expect(f(8, 60) / f(0.45, 60)).toBeLessThan(0.2);
  });

  it('a game given the sky uses NASA sunlight and sun position', () => {
    const g = newGame(sol13, sky(0));
    const expected = solarWm2(table, sol13.tau, sunElevationDeg(g.clockMin, g.sky), 0);
    expect(outdoorEnv(g).solarWm2).toBeCloseTo(expected, 9);
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
