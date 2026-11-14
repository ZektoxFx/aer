import { describe, expect, it } from 'vitest';
import { MIN_PER_SOL } from '../sim/storm';
import { clockLabel, firstToRunOut, formatMinutes } from './hudFormat';

describe('formatMinutes', () => {
  it('shows hours and zero-padded minutes', () => {
    expect(formatMinutes(252.9)).toBe('4:12');
    expect(formatMinutes(5)).toBe('0:05');
  });

  it('shows dashes when the consumable is not being used', () => {
    expect(formatMinutes(Infinity)).toBe('--:--');
  });

  it('never goes negative', () => {
    expect(formatMinutes(-3)).toBe('0:00');
  });
});

describe('firstToRunOut', () => {
  it('picks the smallest finite forecast', () => {
    expect(firstToRunOut({ o2Min: 250, scrubberMin: 400, waterMin: 90, batteryMin: Infinity }))
      .toEqual({ key: 'waterMin', min: 90 });
  });

  it('returns null when nothing is being used up', () => {
    expect(firstToRunOut({ o2Min: Infinity, scrubberMin: Infinity, waterMin: Infinity, batteryMin: Infinity })).toBeNull();
  });
});

describe('clockLabel', () => {
  it('shows the sol and local time', () => {
    expect(clockLabel(MIN_PER_SOL + MIN_PER_SOL / 2)).toEqual({ sol: 1, time: '12:00' });
    expect(clockLabel((8 / 24) * MIN_PER_SOL)).toEqual({ sol: 0, time: '08:00' });
  });
});
