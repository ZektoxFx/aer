// Hand-placed map content: hazard zones and items. Positions are fractions of the area,
// so the same layout fits the synthetic terrain and the Data role's real pack.
// Speed and effort numbers are game-design values to tune in playtesting [verify].
import type { DataPack } from '../data/types';
import type { Pt } from './geo';
import { inPolygon } from './geo';

export type HazardKind = 'rocks' | 'sand';

export interface HazardZone {
  id: string;
  kind: HazardKind;
  label: string;
  poly: Pt[];
  /** Walking speed is multiplied by this inside the zone. */
  speedFactor: number;
  /** Extra effort, as degrees of "virtual uphill" added to the suit model's slope. */
  extraSlopeDeg: number;
}

export type ItemKind = 'base' | 'o2' | 'lioh' | 'water' | 'battery' | 'scrap' | 'manual' | 'shelter' | 'rover';

export interface MapItem {
  id: string;
  kind: ItemKind;
  label: string;
  at: Pt;
  /** Hidden items appear only once the astronaut has seen them. */
  hidden: boolean;
}

export const HAZARD_EFFECT: Record<HazardKind, { speedFactor: number; extraSlopeDeg: number; label: string }> = {
  rocks: { speedFactor: 0.6, extraSlopeDeg: 2, label: 'Boulder field' },
  sand: { speedFactor: 0.5, extraSlopeDeg: 5, label: 'Soft sand' },
};

/** Slope bands (degrees). Above BLOCKED the astronaut cannot walk. */
export const SLOPE_CAUTION = 10;
export const SLOPE_STEEP = 18;
export const SLOPE_BLOCKED = 25;

type F = [number, number];
const ZONES: { id: string; kind: HazardKind; poly: F[] }[] = [
  // Dune field, south-east (matches the synthetic ripples).
  { id: 'sand-se', kind: 'sand', poly: [[0.6, 0.6], [0.82, 0.57], [0.98, 0.66], [0.97, 0.95], [0.74, 0.97], [0.58, 0.82]] },
  // Sand trapped in the old channel.
  { id: 'sand-channel', kind: 'sand', poly: [[0.18, 0.06], [0.24, 0.07], [0.33, 0.3], [0.37, 0.48], [0.31, 0.47], [0.25, 0.28]] },
  // Boulders shed from the delta front.
  { id: 'rocks-delta', kind: 'rocks', poly: [[0.4, 0.05], [0.5, 0.12], [0.48, 0.3], [0.38, 0.42], [0.3, 0.44], [0.33, 0.3], [0.41, 0.2]] },
  // Ejecta around the big crater.
  { id: 'rocks-crater', kind: 'rocks', poly: [[0.5, 0.33], [0.58, 0.38], [0.58, 0.48], [0.5, 0.53], [0.42, 0.5], [0.4, 0.4]] },
];

type ItemSpec = { id: string; kind: ItemKind; label: string; f: F; hidden: boolean };
const ITEMS: ItemSpec[] = [
  { id: 'base', kind: 'base', label: 'Crashed lander (base)', f: [0.62, 0.48], hidden: false },
  { id: 'o2-1', kind: 'o2', label: 'O₂ canister', f: [0.72, 0.22], hidden: true },
  { id: 'o2-2', kind: 'o2', label: 'O₂ canister', f: [0.22, 0.62], hidden: true },
  { id: 'lioh-1', kind: 'lioh', label: 'LiOH cartridge', f: [0.55, 0.7], hidden: true },
  { id: 'water-1', kind: 'water', label: 'Water bladder', f: [0.9, 0.42], hidden: true },
  { id: 'battery-1', kind: 'battery', label: 'Battery pack', f: [0.36, 0.56], hidden: true },
  { id: 'scrap-1', kind: 'scrap', label: 'Rocket piece: fuel line', f: [0.68, 0.6], hidden: true },
  { id: 'scrap-2', kind: 'scrap', label: 'Rocket piece: antenna dish', f: [0.44, 0.24], hidden: true },
  { id: 'scrap-3', kind: 'scrap', label: 'Rocket piece: valve', f: [0.82, 0.88], hidden: true },
  { id: 'manual-1', kind: 'manual', label: 'Manual page: suit refill', f: [0.58, 0.55], hidden: true },
  { id: 'manual-2', kind: 'manual', label: 'Manual page: comms link', f: [0.12, 0.55], hidden: true },
  { id: 'shelter-1', kind: 'shelter', label: 'Wreck: storm shelter', f: [0.8, 0.12], hidden: true },
];

/** Possible rover spots; the seed picks one so each game is different. */
export const ROVER_SPOTS: F[] = [[0.15, 0.88], [0.92, 0.18], [0.1, 0.35], [0.5, 0.92]];

/** Small seeded generator (mulberry32) so a seed always gives the same game. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Layout {
  zones: HazardZone[];
  items: MapItem[];
  base: Pt;
}

export function buildLayout(area: DataPack['area'], seed = 1): Layout {
  const at = ([fx, fy]: F): Pt => ({ x: fx * area.widthM, y: fy * area.heightM });
  const zones = ZONES.map((z) => ({ id: z.id, kind: z.kind, poly: z.poly.map(at), ...HAZARD_EFFECT[z.kind] }));
  const roverIdx = Math.floor(seeded(seed)() * ROVER_SPOTS.length);
  const items: MapItem[] = [
    ...ITEMS.map((i) => ({ id: i.id, kind: i.kind, label: i.label, at: at(i.f), hidden: i.hidden })),
    { id: 'rover', kind: 'rover', label: 'Lost rover', at: at(ROVER_SPOTS[roverIdx]), hidden: true },
  ];
  return { zones, items, base: items[0].at };
}

/** The hazard zone at a point, if any (the first listed wins where zones overlap). */
export function zoneAt(zones: HazardZone[], p: Pt): HazardZone | undefined {
  return zones.find((z) => inPolygon(p, z.poly));
}
