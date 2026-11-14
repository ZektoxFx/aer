import { describe, expect, it } from 'vitest';
import type { ContentFile } from '../data/files';
import type { MapItem } from '../map';
import type { SuitState } from '../sim/types';
import {
  applySupply, BACKPACK_MAX_KG, carriedKg, drop, EMPTY_PACK, fits, isPickable, manualPage, packEntryFor, pickUp, pickupTarget, PICKUP_RADIUS_M,
} from './inventory';

const content = {
  supplies: [
    { id: 'o2_bottle', name: 'O₂ bottle', massKg: 2, gives: { o2Kg: 0.3 }, note: '', values: '' },
    { id: 'repair_kit', name: 'Repair kit', massKg: 1, gives: { repairs: 1 }, note: '', values: '' },
  ],
  rocketPieces: [
    { id: 'hull_panel', name: 'Hull panel', massKg: 6, breakdownMin: 10, yields: { metal: 6 }, values: '' },
    { id: 'tank_valves', name: 'Tank and valves', massKg: 4, breakdownMin: 20, yields: { tankParts: 4 }, mayContain: { o2Kg: [0, 0.5], waterKg: [0, 1] }, values: '' },
  ],
} as unknown as ContentFile;

const item = (id: string, kind: MapItem['kind'], x: number, extra: Partial<MapItem> = {}): MapItem =>
  ({ id, kind, label: id, at: { x, y: 0 }, hidden: true, contentId: id, ...extra });
const suit: SuitState = { o2Kg: 0.1, liohKg: 1, waterKg: 3, batteryWh: 900, inspiredPCO2KPa: 0, coreTempC: 37, elapsedMin: 0 };
const FULL = { o2Kg: 0.6, liohKg: 2, waterKg: 3.9, batteryWh: 1000 };
const take = (p: typeof EMPTY_PACK, it: MapItem) => pickUp(p, it, content).pack;

describe('pickup target', () => {
  const world = {
    items: [item('o2_bottle', 'o2', 5), item('hull_panel', 'scrap', 3), item('rover', 'rover', 1), item('page-4', 'manual', 2, { contentId: '4' })],
    found: new Set(['o2_bottle', 'hull_panel', 'rover']),
  };

  it('picks the nearest spotted item within reach, never the rover or unseen items', () => {
    expect(pickupTarget(world, { x: 0, y: 0 }, EMPTY_PACK)!.id).toBe('hull_panel'); // page-4 is nearer but not spotted yet
    expect(pickupTarget(world, { x: 0, y: 0 }, { ...EMPTY_PACK, taken: ['hull_panel'] })!.id).toBe('o2_bottle');
    expect(pickupTarget(world, { x: 5 + PICKUP_RADIUS_M + 1, y: 0 }, EMPTY_PACK)).toBeNull();
    expect(isPickable(item('rover', 'rover', 0))).toBe(false);
    expect(isPickable(item('wreck', 'shelter', 0))).toBe(false);
  });

  it('lets the player salvage a NASA hardware site once, and the site stays on the map', () => {
    const site = item('descent_stage', 'clue', 0, { hidden: false });
    const w = { items: [site], found: new Set<string>() };
    expect(pickupTarget(w, { x: 1, y: 0 }, EMPTY_PACK)!.id).toBe('descent_stage');
    const r = pickUp(EMPTY_PACK, site, content);
    expect(r.ok).toBe(true);
    expect(r.entry).toMatchObject({ kind: 'part', massKg: 4 });
    expect(r.pack.taken).not.toContain('descent_stage');
    expect(pickupTarget(w, { x: 1, y: 0 }, r.pack)).toBeNull();
    expect(isPickable(item('landing_site', 'clue', 0))).toBe(false); // only the salvage sites
  });
});

describe('backpack', () => {
  it('takes masses and refills from content.json', () => {
    expect(packEntryFor(item('o2_bottle', 'o2', 0), content)).toMatchObject({ kind: 'supply', massKg: 2, gives: { o2Kg: 0.3 } });
    expect(packEntryFor(item('repair_kit', 'repair', 0), content)).toMatchObject({ repairs: 1 });
    expect(packEntryFor(item('hull_panel', 'scrap', 0), content)).toMatchObject({ kind: 'scrap', massKg: 6, yields: { metal: 6 } });
    expect(packEntryFor(item('page-4', 'manual', 0, { contentId: '4' }), content)).toMatchObject({ kind: 'page', massKg: 0, page: 4 });
  });

  it('rolls leftover gas and water in a tank within the data range', () => {
    expect(packEntryFor(item('tank_valves', 'scrap', 0), content, () => 0.5).contains).toEqual({ o2Kg: 0.25, waterKg: 0.5 });
  });

  it(`holds at most ${BACKPACK_MAX_KG} kg`, () => {
    let p = EMPTY_PACK;
    for (const id of ['a', 'b', 'c']) p = take(p, item(id, 'scrap', 0, { contentId: 'hull_panel' })); // 18 kg
    expect(carriedKg(p)).toBe(18);
    expect(fits(p, 2)).toBe(true);
    const r = pickUp(p, item('d', 'scrap', 0, { contentId: 'hull_panel' }), content);
    expect(r.ok).toBe(false);
    expect(r.pack).toBe(p);
  });

  it('an item can only be taken once', () => {
    const p = take(take(EMPTY_PACK, item('hull_panel', 'scrap', 0)), item('hull_panel', 'scrap', 0));
    expect(p.entries).toHaveLength(1);
  });

  it('drops things on the ground where they can be picked up again, as they were', () => {
    let p = take(EMPTY_PACK, item('o2_bottle', 'o2', 0));
    p = { ...p, entries: [{ ...p.entries[0], gives: { o2Kg: 0.1 } }] }; // partly used
    const dropped = drop(p, 'o2_bottle', { x: 50, y: 60 });
    expect(dropped.entries).toHaveLength(0);
    const target = pickupTarget({ items: [], found: new Set() }, { x: 52, y: 60 }, dropped)!;
    expect(target).toMatchObject({ id: 'drop:o2_bottle', kind: 'o2' });
    const back = pickUp(dropped, target, content);
    expect(back.ok).toBe(true);
    expect(back.pack.entries[0].gives).toEqual({ o2Kg: 0.1 });
    expect(back.pack.dropped).toHaveLength(0);
  });
});

describe('using supplies', () => {
  const p = take(EMPTY_PACK, item('o2_bottle', 'o2', 0));

  it('fills the suit and leaves the empty bottle behind', () => {
    const r = applySupply(p.entries, 'o2_bottle', suit, FULL)!;
    expect(r.suit.o2Kg).toBeCloseTo(0.4);
    expect(r.added.o2Kg).toBeCloseTo(0.3);
    expect(r.entries).toHaveLength(0);
    expect(applySupply(take(EMPTY_PACK, item('hull_panel', 'scrap', 0)).entries, 'hull_panel', suit, FULL)).toBeNull();
  });

  it('tops up a nearly full suit and keeps the rest, lighter by what was used', () => {
    const r = applySupply(p.entries, 'o2_bottle', { ...suit, o2Kg: 0.5 }, FULL)!;
    expect(r.suit.o2Kg).toBeCloseTo(0.6);
    expect(r.entries[0].gives!.o2Kg).toBeCloseTo(0.2);
    expect(r.entries[0].massKg).toBeCloseTo(1.9);
  });

  it('does nothing when the suit is already full', () => {
    expect(applySupply(p.entries, 'o2_bottle', { ...suit, o2Kg: 0.6 }, FULL)!.added).toEqual({});
    expect(applySupply(p.entries, 'o2_bottle', { ...suit, o2Kg: 0.598 }, FULL)!.added).toEqual({}); // 2 g short: not worth opening
  });

  it('finds manual pages even when the pack stores page numbers as strings', () => {
    const pages = [{ pageNumber: '4', title: 'Calling Earth' }] as unknown as Parameters<typeof manualPage>[0];
    expect(manualPage(pages, 4)?.title).toBe('Calling Earth');
  });
});
