import { describe, expect, it } from 'vitest';
import type { MapItem } from '../map';
import type { SuitState } from '../sim/types';
import { callStage, FAIL_AFTER_MIN, fatalState, hasCommsLink, installLink, roverInReach, ROVER_REACH_M, watchFailure } from './ending';
import { EMPTY_PACK } from './inventory';
import { canBuild, commsLinkEntry, commsLinkJob, doBuild, EMPTY_SHIP, type Ship } from './ship';

const rover: MapItem = { id: 'rover', kind: 'rover', label: 'Lost rover', at: { x: 100, y: 100 }, hidden: true };
const suit: SuitState = { o2Kg: 0.3, liohKg: 0.5, waterKg: 2, batteryWh: 300, inspiredPCO2KPa: 0.2, coreTempC: 37, elapsedMin: 0 };

describe('building the comms link', () => {
  const job = commsLinkJob(null);
  const kit = { id: 'repair_kit', kind: 'supply' as const, name: 'Repair kit', massKg: 1, repairs: 1 };
  const page4 = { id: 'page-4', kind: 'page' as const, name: 'Page 4', massKg: 0, page: 4 };
  const ready: Ship = { ...EMPTY_SHIP, repaired: ['power'], materials: { electronics: 2, wiring: 2.5 } };

  it("uses the recipe's needs and needs ship power, tools and manual page 4", () => {
    expect(job).toMatchObject({ minutes: 60, materials: { electronics: 2, wiring: 2 }, page: 4, after: ['power'] });
    const pack = { ...EMPTY_PACK, entries: [kit, page4] };
    expect(canBuild(job, pack, { ...ready, repaired: [] })).toBe(false); // no power yet
    expect(canBuild(job, { ...EMPTY_PACK, entries: [kit] }, ready)).toBe(false); // no manual page
    expect(canBuild(job, pack, ready)).toBe(true);
  });

  it('puts the built link in the backpack and uses up the materials, once', () => {
    const pack = { ...EMPTY_PACK, entries: [kit, page4] };
    const r = doBuild(job, pack, ready, commsLinkEntry())!;
    expect(r.inPack).toBe(true);
    expect(hasCommsLink(r.pack)).toBe(true);
    expect(r.ship.materials).toEqual({ wiring: 0.5 });
    expect(r.ship.built).toEqual(['comms_link']);
    expect(doBuild(job, r.pack, r.ship, commsLinkEntry())).toBeNull();
  });
});

describe('calling Earth', () => {
  it('reaches the rover only once it has been found and the astronaut is close', () => {
    const world = { items: [rover], found: new Set<string>() };
    expect(roverInReach(world, { x: 100, y: 100 })).toBeNull();
    const seen = { items: [rover], found: new Set(['rover']) };
    expect(roverInReach(seen, { x: 100 + ROVER_REACH_M - 1, y: 100 })?.id).toBe('rover');
    expect(roverInReach(seen, { x: 100 + ROVER_REACH_M + 1, y: 100 })).toBeNull();
  });

  it('goes: need the link → connect → wait for a pass → send', () => {
    const pass = (inMin: number) => ({ orbiter: 'MRO', centre: '15:09', inMin });
    expect(callStage(false, false, pass(0))).toBe('need-link');
    expect(callStage(false, true, pass(0))).toBe('connect');
    expect(callStage(true, false, pass(40))).toBe('wait');
    expect(callStage(true, false, null)).toBe('wait');
    expect(callStage(true, false, pass(0))).toBe('send');
  });

  it('plugging in takes the link out of the backpack', () => {
    const pack = { ...EMPTY_PACK, entries: [commsLinkEntry()] };
    expect(hasCommsLink(installLink(pack))).toBe(false);
  });
});

describe('suit failure', () => {
  it('is fatal when O₂ is gone or CO₂ passes the unconsciousness line', () => {
    expect(fatalState(suit)).toBeNull();
    expect(fatalState({ ...suit, o2Kg: 0 })).toBe('o2');
    expect(fatalState({ ...suit, inspiredPCO2KPa: 8.5 })).toBe('co2');
  });

  it(`ends the run only after ${FAIL_AFTER_MIN} game minutes, and recovers if the suit does`, () => {
    let r = watchFailure(null, { ...suit, o2Kg: 0 }, 100);
    expect(r.failed).toBeNull();
    r = watchFailure(r.watch, { ...suit, o2Kg: 0 }, 100 + FAIL_AFTER_MIN - 1);
    expect(r.failed).toBeNull();
    expect(watchFailure(r.watch, suit, 109.5)).toEqual({ watch: null, failed: null }); // topped up in time
    expect(watchFailure(r.watch, { ...suit, o2Kg: 0 }, 100 + FAIL_AFTER_MIN).failed).toBe('o2');
  });
});
