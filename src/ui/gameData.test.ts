import { describe, expect, it } from 'vitest';
import type { SunlightTable, WeatherFile } from '../data/files';
import type { DataPack } from '../data/types';
import { dataCaption, skyFor, type GameData } from './gameData';

const SOL = { sol: 312, pressureKPa: 0.626, tempMinC: -77.7, tempMaxC: -7.6, windMS: 3, tau: 0.33 };
const pack = (source: string) => ({ source, sols: [SOL] }) as unknown as DataPack;
const sunlight = { sunElevation: { formula: '', jezeroLatDeg: 18.4 } } as unknown as SunlightTable;
const weather = { sols: [{ sol: 312, ls: 152.9 }] } as unknown as WeatherFile;

describe('skyFor', () => {
  it('uses the sol season from weather.json and Jezero latitude', () => {
    const data: GameData = { pack: pack('NASA'), sunlight, weather };
    expect(skyFor(data, SOL)).toEqual({ table: sunlight, latDeg: 18.4, lsDeg: 152.9 });
  });

  it('falls back to no sky when the sol or the sunlight table is missing', () => {
    expect(skyFor({ pack: pack('NASA'), sunlight, weather }, { ...SOL, sol: 999 })).toBeUndefined();
    expect(skyFor({ pack: pack('NASA'), sunlight: null, weather }, SOL)).toBeUndefined();
  });
});

describe('dataCaption', () => {
  it('names the mission, instruments and sol for real data, and never says live', () => {
    const c = dataCaption(pack('HiRISE ... Perseverance MEDA'), SOL);
    expect(c).toContain('Perseverance MEDA');
    expect(c).toContain('Mastcam-Z');
    expect(c).toContain('Sol 312');
    expect(c.toLowerCase()).not.toContain('live');
  });

  it('keeps the fake data label for fake data', () => {
    expect(dataCaption(pack('FAKE placeholder'), SOL)).toContain('FAKE placeholder');
  });
});
