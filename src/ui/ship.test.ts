import { describe, expect, it } from 'vitest';
import type { SuitState } from '../sim/types';
import { EMPTY_PACK, type Pack, type PackEntry } from './inventory';
import {
  aboard, atStorage, canBuild, canRepair, commsLinkJob, doBuild, doRepair, EMPTY_SHIP, repairNeeds, REPAIRS, SHIP_LOCKER_KG, shipKg, shipRoomKg,
  shipTopUp, store, storeAll, STORAGE_ROOM_AT, STORAGE_ROOM_ID, STORAGE_ROOM_JOB, SUIT_PATCH_JOB, suitLeaking, take, type Ship,
} from './ship';

const e = (id: string, kind: PackEntry['kind'], massKg: number, extra: Partial<PackEntry> = {}): PackEntry => ({ id, kind, name: id, massKg, ...extra });
const pack = (...entries: PackEntry[]): Pack => ({ ...EMPTY_PACK, entries });
const hull = REPAIRS.find((r) => r.id === 'hull')!;
const power = REPAIRS.find((r) => r.id === 'power')!;
const life = REPAIRS.find((r) => r.id === 'life')!;

describe('ship storage', () => {
  it('breaks rocket pieces into materials and keeps everything else as it is', () => {
    const p = pack(e('hull_panel', 'scrap', 6, { yields: { metal: 6 } }), e('o2', 'supply', 2), e('blanket', 'scrap', 3, { yields: { insulation: 3 } }));
    const r = storeAll(p, EMPTY_SHIP);
    expect(r.pack.entries).toHaveLength(0);
    expect(r.ship.materials).toEqual({ metal: 6, insulation: 3 });
    expect(r.ship.stored.map((x) => x.id)).toEqual(['o2']);
  });

  it('takes things back only if they fit in the backpack', () => {
    const ship: Ship = { ...EMPTY_SHIP, stored: [e('part', 'part', 8)] };
    expect(take(pack(), ship, 'part')!.pack.entries).toHaveLength(1);
    expect(take(pack(e('heavy', 'scrap', 15)), ship, 'part')).toBeNull();
    expect(store(pack(), ship, 'missing').ship).toBe(ship);
  });
});

describe('ship repairs', () => {
  const kit = e('repair_kit', 'supply', 1, { repairs: 1 });

  it('lists what is missing for the hull', () => {
    const needs = repairNeeds(hull, pack(), EMPTY_SHIP);
    expect(needs.every((n) => !n.have)).toBe(true);
    expect(needs.map((n) => n.label).join(' | ')).toMatch(/repair kit.*parachute_backshell.*metal 6 kg.*insulation 3 kg/);
  });

  it('seals the hull with the kit, the backshell panel and stored materials; the kit is kept', () => {
    const ship: Ship = { ...EMPTY_SHIP, materials: { metal: 10, insulation: 3 }, stored: [e('parachute_backshell', 'part', 8)] };
    expect(canRepair(hull, pack(), ship)).toBe(false); // no tools
    const r = doRepair(hull, pack(kit), ship)!;
    expect(r.ship.repaired).toEqual(['hull']);
    expect(r.ship.materials).toEqual({ metal: 4 });
    expect(r.ship.stored).toHaveLength(0);
    expect(r.pack.entries.map((x) => x.id)).toEqual(['repair_kit']);
    expect(doRepair(hull, r.pack, r.ship)).toBeNull(); // already done
  });

  it('needs the manual page for power, and both hull and power before life support', () => {
    const ship: Ship = { ...EMPTY_SHIP, materials: { solarCells: 2, wiring: 1, tankParts: 4 }, stored: [e('descent_stage', 'part', 4)] };
    expect(canRepair(power, pack(kit), ship)).toBe(false);
    const withPage = pack(kit, e('page-1', 'page', 0, { page: 1 }), e('page-2', 'page', 0, { page: 2 }));
    const p = doRepair(power, withPage, ship)!;
    expect(canRepair(life, p.pack, p.ship)).toBe(false); // hull not sealed yet
    expect(canRepair(life, p.pack, { ...p.ship, repaired: ['power', 'hull'] })).toBe(true);
  });

  it('a repaired ship refills the suit at the lander', () => {
    const suit: SuitState = { o2Kg: 0.1, liohKg: 0.2, waterKg: 1, batteryWh: 100, inspiredPCO2KPa: 0, coreTempC: 37, elapsedMin: 0 };
    const full = { o2Kg: 0.6, liohKg: 0.8, waterKg: 3.9, batteryWh: 640 };
    expect(shipTopUp(EMPTY_SHIP, suit, full)).toBe(suit);
    expect(shipTopUp({ ...EMPTY_SHIP, repaired: ['power'] }, suit, full)).toMatchObject({ batteryWh: 640, o2Kg: 0.1 });
    expect(shipTopUp({ ...EMPTY_SHIP, repaired: ['power', 'life'] }, suit, full)).toMatchObject({ batteryWh: 640, o2Kg: 0.6, liohKg: 0.8, waterKg: 3.9 });
  });
});

describe('storage inside the lander, then the storage room', () => {
  const base = { x: 1000, y: 1000 };
  const kit = e('repair_kit', 'supply', 1, { repairs: 1 });
  const blueprint = e('blueprint:storage_room', 'page', 0, { blueprint: STORAGE_ROOM_ID });

  it('is only usable aboard the lander, or in the storage room once built', () => {
    expect(aboard({ x: 1003, y: 1002 }, base)).toBe(true);
    expect(aboard({ x: 1010, y: 1000 }, base)).toBe(false);
    const room = { x: base.x + STORAGE_ROOM_AT.dx, y: base.y + STORAGE_ROOM_AT.dy };
    expect(atStorage(room, base, EMPTY_SHIP)).toBe(false);
    expect(atStorage(room, base, { ...EMPTY_SHIP, built: [STORAGE_ROOM_ID] })).toBe(true);
  });

  it(`holds ${SHIP_LOCKER_KG} kg in the locker, counting materials, and stores what fits`, () => {
    const p = pack(e('a', 'scrap', 6, { yields: { metal: 6 } }), e('b', 'part', 8), e('c', 'part', 8), e('d', 'supply', 4));
    const r = storeAll(p, EMPTY_SHIP);
    expect(shipKg(r.ship)).toBeLessThanOrEqual(SHIP_LOCKER_KG);
    expect(r.pack.entries.map((x) => x.id)).toEqual(['d']);
    expect(store(r.pack, r.ship, 'd').pack).toBe(r.pack); // full: nothing changes
  });

  it('has no limit once the storage room is built from the blueprint and AER-1 parts', () => {
    const ship: Ship = { ...EMPTY_SHIP, materials: { metal: 8, fabric: 3, wiring: 1 } };
    expect(canBuild(STORAGE_ROOM_JOB, pack(kit), ship)).toBe(false); // no blueprint
    const built = doBuild(STORAGE_ROOM_JOB, pack(kit, blueprint), ship)!;
    expect(built.ship.built).toContain(STORAGE_ROOM_ID);
    expect(built.ship.materials).toEqual({});
    expect(built.pack.entries).toHaveLength(2); // tools and blueprint are kept
    expect(shipRoomKg(built.ship)).toBe(Infinity);
    expect(store(pack(e('big', 'part', 40)), built.ship, 'big').pack.entries).toHaveLength(0);
  });

  it('patches the suit leak with fabric and insulation', () => {
    const ship: Ship = { ...EMPTY_SHIP, materials: { fabric: 1, insulation: 1 } };
    expect(suitLeaking(ship)).toBe(true);
    const r = doBuild(SUIT_PATCH_JOB, pack(kit), ship)!;
    expect(suitLeaking(r.ship)).toBe(false);
  });

  it('calls the comms link the rover radio repair kit', () => {
    expect(commsLinkJob().name).toBe('Rover radio repair kit');
  });
});
