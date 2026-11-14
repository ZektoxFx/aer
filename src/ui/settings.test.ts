import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, hudKeyAction, loadSettings, saveSettings } from './settings';

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('settings', () => {
  it('defaults when nothing is stored or storage is unavailable', () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips through storage', () => {
    const st = memoryStorage();
    saveSettings({ skipIntro: true, reducedMotion: false, largeText: true }, st);
    expect(loadSettings(st)).toEqual({ skipIntro: true, reducedMotion: false, largeText: true });
  });

  it('ignores malformed or wrongly typed values', () => {
    const bad = { getItem: () => '{"skipIntro":"yes","largeText":true' };
    expect(loadSettings(bad)).toEqual(DEFAULT_SETTINGS);
    const typed = { getItem: () => '{"skipIntro":"yes","largeText":true,"extra":1}' };
    expect(loadSettings(typed)).toEqual({ ...DEFAULT_SETTINGS, largeText: true });
  });

  it('survives storage that throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
  });
});

describe('hudKeyAction', () => {
  it('maps the documented keys', () => {
    expect(hudKeyAction(' ')).toBe('pause');
    expect(hudKeyAction('3')).toBe('mode:walk');
    expect(hudKeyAction('T')).toBe('storm');
    expect(hudKeyAction('x')).toBeNull();
  });
});
