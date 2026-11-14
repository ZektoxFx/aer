import type { ContentFile } from '../data/files';
import type { FieldManualPage } from '../data/types';
import type { MapItem, MapWorldState, Pt } from '../map';
import type { SuitState } from '../sim/types';

// Pickups and the astronaut's pack (proposal §4.1): supplies, rocket pieces as scrap, and field manual pages.
// Everything carried has mass, and mass raises the metabolic rate (§3.4 via Activity.loadKg), so hauling
// everything is never free. Masses and refills come from the Data role's content.json (design values).

/** How close the astronaut must be to pick something up, metres. */
export const PICKUP_RADIUS_M = 8;
/** Above this the pack shows as heavy (a hint, not a limit: the cost is the extra effort). */
export const HEAVY_KG = 15;

export type SuitKey = 'o2Kg' | 'liohKg' | 'waterKg' | 'batteryWh';
const SUIT_KEYS: SuitKey[] = ['o2Kg', 'liohKg', 'waterKg', 'batteryWh'];

export interface PackEntry {
  /** The map item it came from. */
  id: string;
  kind: 'supply' | 'scrap' | 'page';
  name: string;
  massKg: number;
  /** Supplies: what it adds to the suit when used. */
  gives?: Partial<Record<SuitKey, number>>;
  /** Repair kits: faults it can fix. */
  repairs?: number;
  /** Rocket pieces: scrap materials it breaks down into (material id → kg). */
  yields?: Record<string, number>;
  /** Rocket pieces with leftover gas or water inside (rolled when picked up; needs the oxygen tap to recover). */
  contains?: Partial<Record<SuitKey, number>>;
  /** Manual pages: the page number in the pack's fieldManualPages. */
  page?: number;
  note?: string;
}

export interface Pack {
  entries: PackEntry[];
  /** Ids of map items already taken (they disappear from the 3D world). */
  taken: string[];
}

export const EMPTY_PACK: Pack = { entries: [], taken: [] };

const PICKABLE = new Set<MapItem['kind']>(['o2', 'lioh', 'water', 'battery', 'repair', 'scrap', 'manual']);

/** Supplies, rocket pieces and manual pages can be picked up; the base, wreck shelter, NASA sites and the rover cannot. */
export const isPickable = (item: MapItem) => PICKABLE.has(item.kind);

/** The nearest item the astronaut has spotted and can pick up from where they stand, if any. */
export function pickupTarget(world: Pick<MapWorldState, 'items' | 'found'> | null, pos: Pt, taken: readonly string[]): MapItem | null {
  if (!world) return null;
  let best: MapItem | null = null;
  let bestD = PICKUP_RADIUS_M;
  for (const it of world.items) {
    if (!isPickable(it) || taken.includes(it.id)) continue;
    if (it.hidden && !world.found.has(it.id)) continue;
    const d = Math.hypot(it.at.x - pos.x, it.at.y - pos.y);
    if (d <= bestD) { best = it; bestD = d; }
  }
  return best;
}

/** Turn a map item into what goes in the pack, using content.json for mass, refills and scrap yields. */
export function packEntryFor(item: MapItem, content: ContentFile | null | undefined, rng: () => number = Math.random): PackEntry {
  if (item.kind === 'manual') {
    const page = Number(item.contentId ?? item.id.replace(/\D+/g, ''));
    return { id: item.id, kind: 'page', name: item.label, massKg: 0, page: Number.isFinite(page) ? page : undefined };
  }
  const key = item.contentId ?? item.id;
  const supply = content?.supplies.find((s) => s.id === key);
  if (supply) {
    const gives: Partial<Record<SuitKey, number>> = {};
    for (const k of SUIT_KEYS) if (typeof supply.gives[k] === 'number') gives[k] = supply.gives[k];
    return {
      id: item.id, kind: 'supply', name: supply.name, massKg: supply.massKg, gives,
      ...(supply.gives.repairs ? { repairs: supply.gives.repairs } : {}), note: supply.note,
    };
  }
  const piece = content?.rocketPieces.find((p) => p.id === key);
  if (piece) {
    let contains: Partial<Record<SuitKey, number>> | undefined;
    if (piece.mayContain) {
      contains = {};
      for (const [k, [lo, hi]] of Object.entries(piece.mayContain)) {
        if ((SUIT_KEYS as string[]).includes(k)) contains[k as SuitKey] = Math.round((lo + rng() * (hi - lo)) * 100) / 100;
      }
    }
    return { id: item.id, kind: 'scrap', name: piece.name, massKg: piece.massKg, yields: { ...piece.yields }, ...(contains ? { contains } : {}), note: piece.note };
  }
  // Not in content.json (no data yet): still collectable, with a nominal mass.
  return { id: item.id, kind: item.kind === 'scrap' ? 'scrap' : 'supply', name: item.label, massKg: 1 };
}

export function pickUp(pack: Pack, item: MapItem, content: ContentFile | null | undefined, rng?: () => number): Pack {
  if (pack.taken.includes(item.id)) return pack;
  return { entries: [...pack.entries, packEntryFor(item, content, rng)], taken: [...pack.taken, item.id] };
}

/** Total carried mass, kg. */
export const carriedKg = (pack: Pack) => pack.entries.reduce((sum, e) => sum + e.massKg, 0);

/** Leave something behind (it stays where it was dropped, out of the game). */
export const drop = (pack: Pack, id: string): Pack => ({ ...pack, entries: pack.entries.filter((e) => e.id !== id) });

/** Can this entry be used on the suit right now? */
export const usable = (e: PackEntry) => e.kind === 'supply' && !!e.gives && Object.keys(e.gives).length > 0;

/** Suit keys measured in kg: using them makes the carried container lighter. */
const KG_KEYS = new Set<SuitKey>(['o2Kg', 'liohKg', 'waterKg']);
/** Top-ups smaller than this count as "the suit is already full" (5 g, or half a watt-hour). */
const MIN_TOP_UP: Record<SuitKey, number> = { o2Kg: 0.005, liohKg: 0.005, waterKg: 0.005, batteryWh: 0.5 };

/**
 * Use a supply: the suit is topped up to full, and whatever the suit can't take stays in the pack (lighter by
 * what was used). An emptied container is left behind. If the suit is already full nothing changes (`added` is
 * empty). Returns null when the entry can't be used at all.
 */
export function applySupply(pack: Pack, id: string, suit: SuitState, full: Pick<SuitState, SuitKey>): { pack: Pack; suit: SuitState; added: Partial<Record<SuitKey, number>> } | null {
  const e = pack.entries.find((x) => x.id === id);
  if (!e || !usable(e)) return null;
  const next = { ...suit };
  const added: Partial<Record<SuitKey, number>> = {};
  const left: Partial<Record<SuitKey, number>> = {};
  let usedKg = 0;
  for (const k of SUIT_KEYS) {
    const v = e.gives?.[k];
    if (!v) continue;
    let take = Math.max(0, Math.min(v, full[k] - next[k]));
    if (take < MIN_TOP_UP[k]) take = 0;
    next[k] += take;
    if (take > 0) added[k] = take;
    if (v - take > 1e-9) left[k] = v - take;
    if (KG_KEYS.has(k)) usedKg += take;
  }
  if (Object.keys(added).length === 0) return { pack, suit, added: {} };
  const entries = Object.keys(left).length
    ? pack.entries.map((x) => (x.id === id ? { ...x, gives: left, massKg: Math.max(0, x.massKg - usedKg) } : x))
    : pack.entries.filter((x) => x.id !== id);
  return { pack: { ...pack, entries }, suit: next, added };
}

/** The manual page record for a pack entry (page numbers in the pack JSON may be strings). */
export const manualPage = (pages: FieldManualPage[] | undefined, n: number | undefined) =>
  n === undefined ? undefined : pages?.find((p) => Number(p.pageNumber) === n);

/** Short text for what a supply gives, e.g. "+0.30 kg O₂". */
export function givesLabel(g: Partial<Record<SuitKey, number>> | undefined): string {
  if (!g) return '';
  const parts: string[] = [];
  const kg = (v: number) => v.toFixed(v < 0.1 ? 2 : 1);
  if (g.o2Kg) parts.push(`+${g.o2Kg.toFixed(2)} kg O₂`);
  if (g.liohKg) parts.push(`+${kg(g.liohKg)} kg LiOH`);
  if (g.waterKg) parts.push(`+${kg(g.waterKg)} kg water`);
  if (g.batteryWh) parts.push(`+${Math.round(g.batteryWh)} Wh`);
  return parts.join(' · ');
}
