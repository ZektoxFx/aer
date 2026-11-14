import { describe, expect, it } from 'vitest';
import packRaw from '../../public/data/jezero_pack.json?raw';
import layersRaw from '../../public/data/layers_20m.json?raw';
import poisRaw from '../../public/data/pois.json?raw';
import type { PoiFile, TerrainLayers } from '../data/files';
import type { DataPack } from '../data/types';
import { FULL_SUIT } from '../sim/simulate';
import type { Environment } from '../sim/types';
import { zoneAt } from './layout';
import { cellOf, costField, findPath, makeGrid, rangeField } from './pathfind';
import { buildJezeroLayout, hazardsFromLayers, openSpot, packXY, rockFor } from './realData';
import { planRoute } from './route';

const pack = JSON.parse(packRaw) as DataPack;
const pois = JSON.parse(poisRaw) as PoiFile;
const layers = JSON.parse(layersRaw) as TerrainLayers;
const env: Environment = { pressureKPa: 0.63, tempC: -40, windMS: 5, tau: 0.5 };
const model = { speedMS: 0.8, loadKg: 10, env };

describe('real Jezero data (Data role files)', () => {
  it('puts pack coordinates in the same frame as pois.json', () => {
    const land = pois.pois.find((p) => p.id === 'landing_site');
    expect(land).toBeDefined();
    expect(packXY(pack.area, 0, 0)).toEqual({ x: land?.xM, y: land?.yM });
    for (const h of pack.hardwareSites ?? []) {
      const p = pois.pois.find((q) => q.id === h.id);
      if (!p) continue;
      const at = packXY(pack.area, h.eastingM, h.northingM);
      expect(Math.hypot(at.x - p.xM, at.y - p.yM)).toBeLessThan(5);
    }
  });

  it('turns terrain classes into hazard zones cell by cell', () => {
    const zones = hazardsFromLayers(layers);
    const sand = zones.find((z) => z.kind === 'sand');
    const count = layers.terrainClass.filter((c) => c === 2).length;
    expect(sand?.mask?.on.reduce((s, v) => s + v, 0)).toBe(count);
    const i = layers.terrainClass.indexOf(2);
    const p = { x: ((i % layers.cols) + 0.5) * layers.cellM, y: (Math.floor(i / layers.cols) + 0.5) * layers.cellM };
    expect(zoneAt(zones, p)?.kind).toBe('sand');
  });

  it('places the base at the crashed lander and the rover at a real parking spot', () => {
    const cab = pack.crashedLander?.cabinLocation;
    expect(cab).toBeDefined();
    const spots = pois.pois.filter((p) => p.kind === 'rover_candidate').map((p) => `${p.xM},${p.yM}`);
    const roverAt = (seed: number) => {
      const r = buildJezeroLayout({ pack, pois, layers }, seed).items.find((i) => i.kind === 'rover');
      return `${r?.at.x},${r?.at.y}`;
    };
    const L = buildJezeroLayout({ pack, pois, layers }, 1);
    expect(L.base).toEqual(packXY(pack.area, cab?.eastingM ?? 0, cab?.northingM ?? 0));
    expect(spots).toContain(roverAt(1));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(roverAt)).size).toBeGreaterThan(1);
    expect(L.searchArea).toBeDefined();
    expect(L.archiveTraverse?.length).toBeGreaterThan(0);
    expect(L.roverTracks?.length).toBeGreaterThan(0);
  });

  it('uses content.json ids, the pack manual pages and the real NASA sites', () => {
    const { items } = buildJezeroLayout({ pack, pois, layers }, 1);
    const ids = new Set(items.map((i) => i.contentId));
    for (const id of ['o2_bottle', 'lioh_canister', 'water_pack', 'battery_pack', 'repair_kit',
      'hull_panel', 'parachute_straps', 'thermal_blanket', 'wiring_harness', 'avionics_box', 'solar_segment', 'tank_valves']) {
      expect(ids).toContain(id);
    }
    const pages = items.filter((i) => i.kind === 'manual');
    expect(pages).toHaveLength(pack.fieldManualPages?.length ?? 0);
    const comms = pages.filter((p) => p.required);
    expect(comms).toHaveLength(1);
    // The comms page is far from the cabin (out of sight at the start), toward the rover's area.
    const L = buildJezeroLayout({ pack, pois, layers }, 1);
    expect(Math.hypot(comms[0].at.x - L.base.x, comms[0].at.y - L.base.y)).toBeGreaterThan(1000);
    expect(items.find((i) => i.id === 'descent_stage')).toMatchObject({ kind: 'clue', hidden: false });
    expect(items.find((i) => i.id === 'sample_12')?.kind).toBe('science');
    expect(items.filter((i) => i.fiction && i.kind !== 'base').every((i) => i.hidden)).toBe(true);
  });

  it('moves placed items off sand and steep ground', () => {
    const p = openSpot(layers, { x: 3000, y: 2000 });
    const i = Math.floor(p.y / layers.cellM) * layers.cols + Math.floor(p.x / layers.cellM);
    expect(layers.terrainClass[i]).toBe(0);
    expect(layers.slopeDeg[i]).toBeLessThanOrEqual(12);
  });

  it('can walk from the cabin to every item and every rover spot on the real terrain', () => {
    const L = buildJezeroLayout({ pack, pois, layers }, 1);
    const g = makeGrid(pack.elevation, L.zones);
    const f = costField(g, model, L.base, 'out');
    const targets = [...L.items.filter((i) => i.kind !== 'sample'), ...pois.pois.filter((p) => p.kind === 'rover_candidate').map((p) => ({ id: p.id, at: { x: p.xM, y: p.yM } }))];
    const unreachable = targets.filter((t) => !Number.isFinite(f.use[cellOf(pack.elevation, t.at) * 5])).map((t) => t.id);
    expect(unreachable).toEqual([]);
  });

  it('hands Sim a leg list whose time matches the route, with Sim’s point of no return', () => {
    const L = buildJezeroLayout({ pack, pois, layers }, 1);
    const g = makeGrid(pack.elevation, L.zones);
    const router = (a: { x: number; y: number }, b: { x: number; y: number }) => findPath(g, model, a, b);
    const target = L.items.find((i) => i.contentId === 'tank_valves');
    expect(target).toBeDefined();
    const r = planRoute(pack.elevation, L.zones, L.base, L.base, [target?.at ?? L.base], FULL_SUIT, { ...model, router });
    const simMin = r.simLegs.reduce((s, l) => s + l.minutes, 0);
    expect(simMin).toBeCloseTo(r.minutes, 6);
    expect(r.turnBackByMin).not.toBeNull();
    expect(r.pnrIndex).toBeNull(); // a short walk from the cabin with a full suit
  });

  it('computes the safe zone on the full 640 × 400 grid fast enough to use', () => {
    const L = buildJezeroLayout({ pack, pois, layers }, 1);
    const g = makeGrid(pack.elevation, L.zones);
    const t0 = performance.now();
    const rf = rangeField(g, model, L.base, L.base, FULL_SUIT);
    const ms = performance.now() - t0;
    expect(rf.safe[cellOf(pack.elevation, L.base)]).toBeGreaterThan(0.5);
    expect(ms).toBeLessThan(3000);
  });

  it('links samples to the Data role’s rock formations by target name', () => {
    const delta = (pack.rockFormations ?? []).find((r) => /wildcat ridge/i.test(r.associatedTarget));
    expect(delta).toBeDefined();
    expect(rockFor(pack, 'Wildcat Ridge')).toContain(delta?.name ?? '?');
    expect(rockFor(pack, 'Nowhere Rock')).toBe('');
    const sci = buildJezeroLayout({ pack, pois, layers }, 1).items.find((i) => i.id === 'sample_12');
    expect(sci?.rock).toContain(delta?.name ?? '?');
    expect(sci?.note).toContain('Rock:');
    // Values the Data role has not checked stay marked.
    if (/\[verify/i.test(`${delta?.description} ${delta?.mineralogy}`)) expect(sci?.rock).toContain('[verify]');
  });
});
