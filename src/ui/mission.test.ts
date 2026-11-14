import { describe, expect, it } from 'vitest';
import type { RelayFile } from '../data/files';
import type { MapItem, MapWorldState } from '../map';
import { MIN_PER_SOL } from '../sim/storm';
import { missionSteps, nextRelayPass } from './mission';
import { pickVoice, RADIO, readingMs } from './introAudio';

const at = (hour: number) => (hour / 24) * MIN_PER_SOL;
const relay = {
  gameWindowsLTST: {
    about: '', values: '',
    windows: [
      { orbiter: 'MRO', centre: '03:09', fromHour: 2.15, toHour: 4.15, passMin: 10 },
      { orbiter: 'ODY', centre: '06:11', fromHour: 5.18, toHour: 7.18, passMin: 14 },
      { orbiter: 'MRO', centre: '15:09', fromHour: 14.15, toHour: 16.15, passMin: 10 },
      { orbiter: 'ODY', centre: '18:11', fromHour: 17.18, toHour: 19.18, passMin: 14 },
    ],
  },
} as unknown as RelayFile;

describe('nextRelayPass', () => {
  it('finds the next window, or says one is open now', () => {
    expect(nextRelayPass(at(10), relay)).toMatchObject({ orbiter: 'MRO', centre: '15:09' });
    expect(nextRelayPass(at(10), relay)!.inMin).toBeCloseTo(4.15 * (MIN_PER_SOL / 24), 1);
    expect(nextRelayPass(at(15), relay)).toMatchObject({ orbiter: 'MRO', inMin: 0 });
  });

  it('wraps past midnight to the first window of the next day', () => {
    const p = nextRelayPass(at(22), relay)!;
    expect(p.orbiter).toBe('MRO');
    expect(p.centre).toBe('03:09');
    expect(p.inMin).toBeCloseTo(4.15 * (MIN_PER_SOL / 24), 1);
  });

  it('is null without relay data', () => {
    expect(nextRelayPass(at(10), null)).toBeNull();
  });
});

describe('missionSteps', () => {
  const item = (id: string, kind: MapItem['kind'], x: number, required = false): MapItem => ({ id, kind, label: id, at: { x, y: 0 }, hidden: true, required });
  const world = (found: string[]) => ({
    items: [item('page-comms', 'manual', 300, true), item('rover', 'rover', 2000)],
    found: new Set(found),
  }) as unknown as MapWorldState;
  const fmt = (m: number) => `${Math.round(m)} min`;

  it('starts with only the crash survived', () => {
    const s = missionSteps(world([]), { x: 0, y: 0 }, null, fmt);
    expect(s.map((x) => x.done)).toEqual([true, false, false, false]);
    expect(s.find((x) => x.id === 'rover')!.detail).toContain('W');
  });

  it('ticks off the rover once seen and the page once picked up, with distances', () => {
    const seen = missionSteps(world(['page-comms', 'rover']), { x: 0, y: 0 }, null, fmt);
    expect(seen.map((x) => x.done)).toEqual([true, false, true, false]);
    expect(seen.find((x) => x.id === 'rover')!.detail).toBe('2.0 km');
    expect(seen.find((x) => x.id === 'page')!.detail).toBe('spotted · 300 m');
    const taken = missionSteps(world(['page-comms', 'rover']), { x: 0, y: 0 }, null, fmt, ['page-comms']);
    expect(taken.map((x) => x.done)).toEqual([true, true, true, false]);
  });

  it('adds the ship repair step when there are repairs to do', () => {
    const s = missionSteps(null, { x: 0, y: 0 }, null, fmt, [], { done: 1, of: 3 });
    expect(s.map((x) => x.id)).toEqual(['crash', 'ship', 'page', 'rover', 'call']);
    expect(s[1]).toMatchObject({ done: false, detail: expect.stringContaining('1/3') });
    expect(missionSteps(null, { x: 0, y: 0 }, null, fmt, [], { done: 3, of: 3 })[1].done).toBe(true);
  });

  it('adds the comms link build and ticks the call once it is sent', () => {
    const s = missionSteps(null, { x: 0, y: 0 }, null, fmt, [], { done: 3, of: 3 }, { linkBuilt: false });
    expect(s.map((x) => x.id)).toEqual(['crash', 'ship', 'page', 'link', 'rover', 'call']);
    expect(s.find((x) => x.id === 'link')!.done).toBe(false);
    const won = missionSteps(null, { x: 0, y: 0 }, null, fmt, [], { done: 3, of: 3 }, { linkBuilt: true, called: true });
    expect(won.find((x) => x.id === 'call')).toMatchObject({ done: true, detail: 'Earth heard you' });
  });

  it('shows the next orbiter pass on the last step', () => {
    const s = missionSteps(null, { x: 0, y: 0 }, { orbiter: 'MRO', centre: '15:09', inMin: 90 }, fmt);
    expect(s[3].detail).toBe('MRO ≈15:09 · in 90 min');
  });
});

describe('intro radio', () => {
  it('picks a clear English voice and skips novelty voices', () => {
    const v = (name: string, lang = 'en-US') => ({ name, lang });
    expect(pickVoice([v('Zarvox'), v('Bad News'), v('Samantha')])!.name).toBe('Samantha');
    expect(pickVoice([v('Thomas', 'fr-FR'), v('Zarvox')])).toBeNull();
    expect(pickVoice([v('Some English Voice', 'en-GB')])!.name).toBe('Some English Voice');
  });

  it('tells the story: divert to Mars, then find Perseverance to call Earth', () => {
    expect(RADIO.mayday.text).toMatch(/meteor/i);
    expect(RADIO.mayday.text).toMatch(/Mars/);
    expect(RADIO.rover.text).toMatch(/Perseverance/);
    expect(RADIO.rover.text).toMatch(/call Earth/);
    expect(readingMs(RADIO.rover.text)).toBeGreaterThan(5000);
  });
});
