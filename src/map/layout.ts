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

/** Item kinds from proposal §4.1: supplies (o2, lioh, water, battery, repair), rocket pieces (scrap), manual pages. */
export type ItemKind = 'base' | 'o2' | 'lioh' | 'water' | 'battery' | 'repair' | 'scrap' | 'manual' | 'shelter' | 'rover';

export interface MapItem {
  id: string;
  kind: ItemKind;
  label: string;
  at: Pt;
  /** Hidden items appear only once the astronaut has seen them. */
  hidden: boolean;
  /** Rocket pieces: scrap materials they break down into (§4.1 table). */
  yields?: string[];
  /** Manual pages: the build the page unlocks. */
  unlocks?: string;
  /** Needed to win (the rover comms link page). */
  required?: boolean;
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

/**
 * The lander's crash path (§4.1): it came in from the south-east, shedding cargo, and the cabin
 * stopped at the base. Old orbital maps predate the crash, so the scar only shows once seen.
 */
export const CRASH_PATH: F[] = [[0.98, 0.93], [0.9, 0.82], [0.81, 0.71], [0.72, 0.6], [0.62, 0.48]];
export const BASE_F: F = [0.62, 0.48];

type ItemSpec = Omit<MapItem, 'at' | 'hidden'> & { f: F; hidden?: boolean };
const ITEMS: ItemSpec[] = [
  { id: 'base', kind: 'base', label: 'Lander cabin (base)', f: BASE_F, hidden: false },

  // Dropped along the crash path, roughly in the order they fell.
  { id: 'hull', kind: 'scrap', label: 'Hull and fairing panels', yields: ['metal'], f: [0.94, 0.86] },
  { id: 'tank', kind: 'scrap', label: 'Tanks and valves', yields: ['tank parts', 'leftover gas or water'], f: [0.87, 0.77] },
  { id: 'o2-1', kind: 'o2', label: 'O₂ bottle', f: [0.82, 0.73] },
  { id: 'wreck', kind: 'shelter', label: 'Large wreck piece (storm shelter)', f: [0.78, 0.66] },
  { id: 'solar', kind: 'scrap', label: 'Solar array segment', yields: ['solar cells', 'wiring'], f: [0.745, 0.625] },
  { id: 'water-1', kind: 'water', label: 'Water pack', f: [0.7, 0.56] },
  { id: 'page-solar', kind: 'manual', label: 'Manual page: solar patch', unlocks: 'Solar patch', f: [0.665, 0.535] },
  // Broke off at the impact, close to the cabin (one is in sight at the start).
  { id: 'wiring', kind: 'scrap', label: 'Wiring harnesses', yields: ['wiring'], f: [0.6, 0.455] },
  { id: 'blanket', kind: 'scrap', label: 'Thermal blankets', yields: ['insulation'], f: [0.66, 0.38] },

  // The debris field where Sol 1's scrubber runs low (§6.2).
  { id: 'lioh-1', kind: 'lioh', label: 'LiOH canister', f: [0.765, 0.645] },

  // Thrown or blown off the path.
  { id: 'avionics', kind: 'scrap', label: 'Avionics box and antenna', yields: ['electronics'], f: [0.8, 0.2] },
  { id: 'page-o2tap', kind: 'manual', label: 'Manual page: oxygen tap', unlocks: 'Oxygen tap', f: [0.72, 0.24] },
  { id: 'repair-1', kind: 'repair', label: 'Repair kit', f: [0.9, 0.4] },
  { id: 'battery-1', kind: 'battery', label: 'Battery pack', f: [0.36, 0.56] },
  { id: 'page-df', kind: 'manual', label: 'Manual page: direction finder', unlocks: 'Direction finder', f: [0.4, 0.8] },
  // The parachute was cut loose high up, so the wind carried it far to the west.
  { id: 'chute', kind: 'scrap', label: 'Parachute and straps', yields: ['fabric'], f: [0.22, 0.62] },
  { id: 'page-comms', kind: 'manual', label: 'Manual page: rover comms link', unlocks: 'Rover comms link', required: true, f: [0.12, 0.55] },
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
  /** The crash scar, base last. */
  crashPath: Pt[];
}

export function buildLayout(area: DataPack['area'], seed = 1): Layout {
  const at = ([fx, fy]: F): Pt => ({ x: fx * area.widthM, y: fy * area.heightM });
  const zones = ZONES.map((z) => ({ id: z.id, kind: z.kind, poly: z.poly.map(at), ...HAZARD_EFFECT[z.kind] }));
  const roverIdx = Math.floor(seeded(seed)() * ROVER_SPOTS.length);
  const items: MapItem[] = [
    ...ITEMS.map(({ f, hidden, ...rest }) => ({ ...rest, at: at(f), hidden: hidden ?? true })),
    { id: 'rover', kind: 'rover', label: 'Lost rover', at: at(ROVER_SPOTS[roverIdx]), hidden: true },
  ];
  return { zones, items, base: at(BASE_F), crashPath: CRASH_PATH.map(at) };
}

/** The hazard zone at a point, if any (the first listed wins where zones overlap). */
export function zoneAt(zones: HazardZone[], p: Pt): HazardZone | undefined {
  return zones.find((z) => inPolygon(p, z.poly));
}
