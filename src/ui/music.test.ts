import { describe, expect, it } from 'vitest';
import audioRaw from '../../public/audio/audio.json?raw';
import creditsRaw from '../../public/data/credits.json?raw';
import type { CreditsFile } from '../data/files';
import { MARS_WIND } from './gameAudio';
import { gameTrack, MUSIC_FILES, STORM_MUSIC_AT } from './music';

const audio = JSON.parse(audioRaw) as { tracks: Record<string, { page: string; loopStartS?: number; loopEndS?: number }> };
const credits = JSON.parse(creditsRaw) as CreditsFile;
/** Files in public/audio, as /audio/... URLs. */
const files = new Set(Object.keys(import.meta.glob('../../public/audio/*.mp3')).map((k) => k.replace('../../public', '')));

describe('music', () => {
  it('plays the ending track, the storm track in a real storm, and exploring music otherwise', () => {
    expect(gameTrack(null, 0)).toBe('explore');
    expect(gameTrack(null, STORM_MUSIC_AT - 0.01)).toBe('explore');
    expect(gameTrack(null, 0.8)).toBe('storm');
    expect(gameTrack('won', 0.8)).toBe('won');
    expect(gameTrack('lost', 0)).toBe('lost');
    expect(gameTrack(null, 0, 'warning')).toBe('storm');
    expect(gameTrack(null, 0.1, 'clearing')).toBe('explore');
    expect(gameTrack('won', 0, 'peak')).toBe('won');
  });

  it('has every music file and the Mars wind loop in public/audio, with a source page for each', () => {
    for (const [track, url] of Object.entries(MUSIC_FILES)) {
      expect(files.has(url), url).toBe(true);
      expect(audio.tracks[track]?.page).toMatch(/^https:\/\//);
    }
    expect(files.has(MARS_WIND.url)).toBe(true);
    expect(audio.tracks.wind.loopStartS).toBe(MARS_WIND.loopStartS);
    expect(audio.tracks.wind.loopEndS).toBe(MARS_WIND.loopEndS);
  });

  it('credits the Mars wind recording and every music author', () => {
    const lines = (credits.audioCredits ?? []).join('\n');
    expect(lines).toContain('SuperCam');
    for (const who of ['compose.py', 'yd', 'SRG774', 'nene']) expect(lines).toContain(who);
  });
});
