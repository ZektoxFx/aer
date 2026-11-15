import { describe, expect, it } from 'vitest';
import type { ContentFile } from '../data/files';
import type { MapItem } from '../map';
import { EMPTY_PACK, type Pack, type PackEntry } from './inventory';
import type { MissionStep } from './mission';
import { bearing, currentQuest, type QuestInput } from './quest';
import { commsLinkJob, EMPTY_SHIP, SUIT_PATCH_JOB, type Ship } from './ship';

const content = {
  materials: [{ id: 'fabric', name: 'Fabric' }, { id: 'insulation', name: 'Insulation' }],
  rocketPieces: [
    { id: 'parachute_straps', yields: { fabric: 5 } },
    { id: 'thermal_blanket', yields: { insulation: 3 } },
  ],
} as unknown as ContentFile;

const item = (id: string, kind: MapItem['kind'], x: number, y: number, extra: Partial<MapItem> = {}): MapItem =>
  ({ id, kind, label: id, at: { x, y }, hidden: false, ...extra });

const base = { x: 0, y: 0 };
const kit = item('kit-far', 'repair', 300, 0);
const kitNear = item('kit-near', 'repair', 50, 0);
const straps = item('aer1-straps', 'scrap', 0, 80, { contentId: 'parachute_straps' });
const blanket = item('aer1-blanket', 'scrap', 0, -60, { contentId: 'thermal_blanket' });
const rover = item('rover', 'rover', -2000, 0);

const steps = (open: MissionStep['id']): MissionStep[] =>
  (['crash', 'suit', 'ship', 'page', 'link', 'rover', 'call'] as const).map((id, i, all) => ({ id, label: id, done: i < all.indexOf(open) }));

const input = (over: Partial<QuestInput> = {}): QuestInput => ({
  steps: steps('suit'), items: [kit, kitNear, straps, blanket], pack: EMPTY_PACK, ship: EMPTY_SHIP, content, base, me: base,
  suitJob: SUIT_PATCH_JOB, linkJob: commsLinkJob(null), rover, linked: false, pass: null, fmtMin: (m) => `${m} min`, ...over,
});

const entry = (e: Partial<PackEntry> & { id: string }): PackEntry => ({ kind: 'supply', name: e.id, massKg: 1, ...e });

describe('bearing', () => {
  it('gives distance and compass direction (y runs south)', () => {
    expect(bearing(base, { x: 0, y: -100 })).toMatchObject({ m: 100, dir: 'N' });
    expect(bearing(base, { x: 100, y: 0 }).dir).toBe('E');
    expect(bearing(base, { x: -70, y: 70 }).dir).toBe('SW');
  });
});

describe('quest guide', () => {
  it('starts the suit patch by sending the player to the NEAREST repair kit', () => {
    const q = currentQuest(input());
    expect(q.step).toBe('suit');
    expect(q.task).toMatch(/repair kit/);
    expect(q.target?.label).toBe('kit-near');
    expect(q.needs.some((n) => !n.done)).toBe(true);
  });

  it('then sends them to the scrap that has the missing material', () => {
    const pack: Pack = { ...EMPTY_PACK, entries: [entry({ id: 'kit-near', repairs: 1 })] };
    const q = currentQuest(input({ pack }));
    expect(q.task).toMatch(/aer1-straps.*fabric/);
    expect(q.target?.at).toEqual(straps.at);
  });

  it('collects every missing material before sending them home to store', () => {
    const pack: Pack = { ...EMPTY_PACK, entries: [entry({ id: 'kit-near', repairs: 1 }), entry({ id: 'aer1-straps', kind: 'scrap', yields: { fabric: 5 } })] };
    const q = currentQuest(input({ pack, items: [blanket] }));
    expect(q.task).toMatch(/aer1-blanket.*insulation/);
  });

  it('asks them to store carried scrap at the lander', () => {
    const pack: Pack = { ...EMPTY_PACK, entries: [entry({ id: 'kit-near', repairs: 1 }), entry({ id: 'aer1-straps', kind: 'scrap', yields: { fabric: 5 } })] };
    const ship: Ship = { ...EMPTY_SHIP, materials: { insulation: 3 } };
    const q = currentQuest(input({ pack, ship }));
    expect(q.task).toMatch(/store/i);
    expect(q.target?.at).toEqual(base);
  });

  it('says to start the job once everything is there', () => {
    const pack: Pack = { ...EMPTY_PACK, entries: [entry({ id: 'kit-near', repairs: 1 })] };
    const ship: Ship = { ...EMPTY_SHIP, materials: { fabric: 5, insulation: 3 } };
    const q = currentQuest(input({ pack, ship }));
    expect(q.task).toMatch(/PACK → REPAIRS.*Patch the suit leak/);
    expect(q.needs.every((n) => n.done)).toBe(true);
  });

  it('points at the rover for the rover step, and explains the call stages', () => {
    expect(currentQuest(input({ steps: steps('rover') })).target?.at).toEqual(rover.at);
    const pack: Pack = { ...EMPTY_PACK, entries: [entry({ id: 'comms_link', kind: 'part' })] };
    expect(currentQuest(input({ steps: steps('call'), pack })).task).toMatch(/press F to fit/);
    expect(currentQuest(input({ steps: steps('call'), linked: true, pass: { orbiter: 'MRO', centre: '15:00', inMin: 40 } })).task).toMatch(/MRO passes overhead in 40 min: press F/);
    expect(currentQuest(input({ steps: steps('call'), linked: true, pass: { orbiter: 'MRO', centre: '15:00', inMin: 0 } })).task).toMatch(/call Earth/);
  });

  it('turns open findings into side quests after the call', () => {
    const done = steps('call').map((s) => ({ ...s, done: true }));
    const science = item('sample_12', 'science', 500, 500);
    const q = currentQuest(input({ steps: done, found: ['air', 'build', 'storm', 'cold'], allItems: [science] }));
    expect(q.step).toBe('journal');
    expect(q.target?.at).toEqual(science.at);
  });
});
