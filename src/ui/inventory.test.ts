import { describe, expect, it } from 'vitest';
import type { ContentFile } from '../data/files';
import type { MapItem } from '../map';
import type { SuitState } from '../sim/types';
import { applySupply, carriedKg, drop, EMPTY_PACK, isPickable, manualPage, packEntryFor, pickUp, pickupTarget, PICKUP_RADIUS_M } from './inventory';

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

describe('pickup target', () => {
  const world = {
    items: [item('o2_bottle', 'o2', 5), item('hull_panel', 'scrap', 3), item('rover', 'rover', 1), item('page-4', 'manual', 2, { contentId: '4' })],
    found: new Set(['o2_bottle', 'hull_panel', 'rover']),
  };

  it('picks the nearest spotted item within reach, never the rover or unseen items', () => {
    expect(pickupTarget(world, { x: 0, y: 0 }, [])!.id).toBe('hull_panel'); // page-4 is nearer but not spotted yet
    expect(pickupTarget(world, { x: 0, y: 0 }, ['hull_panel'])!.id).toBe('o2_bottle');
    expect(pickupTarget(world, { x: 5 + PICKUP_RADIUS_M + 1, y: 0 }, [])).toBeNull();
    expect(isPickable(item('rover', 'rover', 0))).toBe(false);
    expect(isPickable(item('wreck', 'shelter', 0))).toBe(false);
  });
});

describe('pack', () => {
  it('takes masses and refills from content.json', () => {
    const o2 = packEntryFor(item('o2_bottle', 'o2', 0), content);
    expect(o2).toMatchObject({ kind: 'supply', massKg: 2, gives: { o2Kg: 0.3 } });
    expect(packEntryFor(item('repair_kit', 'repair', 0), content)).toMatchObject({ repairs: 1 });
    expect(packEntryFor(item('hull_panel', 'scrap', 0), content)).toMatchObject({ kind: 'scrap', massKg: 6, yields: { metal: 6 } });
    expect(packEntryFor(item('page-4', 'manual', 0, { contentId: '4' }), content)).toMatchObject({ kind: 'page', massKg: 0, page: 4 });
  });

  it('rolls leftover gas and water in a tank within the data range', () => {
    const half = packEntryFor(item('tank_valves', 'scrap', 0), content, () => 0.5);
    expect(half.contains).toEqual({ o2Kg: 0.25, waterKg: 0.5 });
  });

  it('adds up carried mass, and an item can only be taken once', () => {
    let p = pickUp(EMPTY_PACK, item('o2_bottle', 'o2', 0), content);
    p = pickUp(p, item('hull_panel', 'scrap', 0), content);
    p = pickUp(p, item('hull_panel', 'scrap', 0), content);
    expect(p.entries).toHaveLength(2);
    expect(carriedKg(p)).toBe(8);
    expect(carriedKg(drop(p, 'hull_panel'))).toBe(2);
    expect(drop(p, 'hull_panel').taken).toContain('hull_panel'); // dropped things don't come back
  });

  it('using a supply fills the suit and leaves the empty bottle behind', () => {
    const p = pickUp(EMPTY_PACK, item('o2_bottle', 'o2', 0), content);
    const r = applySupply(p, 'o2_bottle', suit, FULL)!;
    expect(r.suit.o2Kg).toBeCloseTo(0.4);
    expect(r.added.o2Kg).toBeCloseTo(0.3);
    expect(r.pack.entries).toHaveLength(0);
    expect(applySupply(pickUp(EMPTY_PACK, item('hull_panel', 'scrap', 0), content), 'hull_panel', suit, FULL)).toBeNull();
  });

  it('tops up a nearly full suit and keeps the rest, lighter by what was used', () => {
    const p = pickUp(EMPTY_PACK, item('o2_bottle', 'o2', 0), content);
    const r = applySupply(p, 'o2_bottle', { ...suit, o2Kg: 0.5 }, FULL)!;
    expect(r.suit.o2Kg).toBeCloseTo(0.6);
    expect(r.added.o2Kg).toBeCloseTo(0.1);
    expect(r.pack.entries[0].gives!.o2Kg).toBeCloseTo(0.2);
    expect(r.pack.entries[0].massKg).toBeCloseTo(1.9);
  });

  it('does nothing when the suit is already full', () => {
    const p = pickUp(EMPTY_PACK, item('o2_bottle', 'o2', 0), content);
    const r = applySupply(p, 'o2_bottle', { ...suit, o2Kg: 0.6 }, FULL)!;
    expect(r.added).toEqual({});
    expect(r.pack).toBe(p);
    expect(applySupply(p, 'o2_bottle', { ...suit, o2Kg: 0.598 }, FULL)!.added).toEqual({}); // 2 g short: not worth opening
  });

  it('finds manual pages even when the pack stores page numbers as strings', () => {
    const pages = [{ pageNumber: '4', title: 'Calling Earth' }] as unknown as Parameters<typeof manualPage>[0];
    expect(manualPage(pages, 4)?.title).toBe('Calling Earth');
  });
});
