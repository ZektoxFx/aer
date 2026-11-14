import type { ContentFile } from '../data/files';
import type { FieldManualPage } from '../data/types';
import type { MapItem, MapWorldState, Pt } from '../map';
import type { SuitState } from '../sim/types';

// Pickups and the astronaut's backpack (proposal §4.1): supplies, rocket pieces as scrap, field manual pages, and
// parts salvaged from NASA hardware. Everything carried has mass, and mass raises the metabolic rate (§3.4 via
// Activity.loadKg), so hauling everything is never free. Masses and refills come from the Data role's
// content.json (design values); salvage values are UI design values (game fiction).

/** How close the astronaut must be to pick something up, metres. */
export const PICKUP_RADIUS_M = 8;
/** Most the backpack can hold (design value). Heavier loads go back to the ship's storage. */
export const BACKPACK_MAX_KG = 20;
/** Above this the backpack shows as heavy. */
export const HEAVY_KG = 15;

export type SuitKey = 'o2Kg' | 'liohKg' | 'waterKg' | 'batteryWh';
const SUIT_KEYS: SuitKey[] = ['o2Kg', 'liohKg', 'waterKg', 'batteryWh'];

export interface PackEntry {
  /** The map item it came from. */
  id: string;
  /** supply: used on the suit · scrap: broken down into materials · page: a manual page · part: a salvaged NASA part. */
  kind: 'supply' | 'scrap' | 'page' | 'part';
  name: string;
  massKg: number;
  /** The map kind it came from, so a dropped item looks the same on the ground. */
  itemKind?: MapItem['kind'];
  /** Supplies: what it adds to the suit when used. */
  gives?: Partial<Record<SuitKey, number>>;
  /** Repair kits: a tool for repairs (not used up). */
  repairs?: number;
  /** Rocket pieces: scrap materials it breaks down into (material id → kg). */
  yields?: Record<string, number>;
  /** Rocket pieces with leftover gas or water inside (rolled when picked up; needs the oxygen tap to recover). */
  contains?: Partial<Record<SuitKey, number>>;
  /** Manual pages: the page number in the pack's fieldManualPages. */
  page?: number;
  note?: string;
}

/** Something put down on the ground; it can be picked up again. */
export interface Dropped {
  item: MapItem;
  entry: PackEntry;
}

export interface Pack {
  entries: PackEntry[];
  /** Ids of map items already taken (they disappear from the 3D world). */
  taken: string[];
  /** NASA sites already salvaged (the site itself stays on the map). */
  salvaged: string[];
  /** Things put down on the ground. */
  dropped: Dropped[];
}

export const EMPTY_PACK: Pack = { entries: [], taken: [], salvaged: [], dropped: [] };

/**
 * Parts that can be salvaged from real NASA hardware lying in Jezero (positions from pois.json). Game fiction:
 * the real hardware is untouched; masses and yields are design values.
 */
export const SALVAGE: Record<string, Omit<PackEntry, 'id'>> = {
  descent_stage: {
    kind: 'part', name: 'Descent-stage cable harness', massKg: 4,
    note: 'From the sky crane that lowered Perseverance on cables, then flew off and crashed here (game fiction: salvaging it).',
  },
  parachute_backshell: {
    kind: 'part', name: 'Backshell panel', massKg: 8,
    note: 'A curved panel of the backshell that protected Perseverance on the way down (game fiction: salvaging it).',
  },
  heat_shield: {
    kind: 'scrap', name: 'Heat shield tiles', massKg: 3, yields: { insulation: 3 },
    note: 'The heat shield is covered in PICA tiles, a light carbon ablator that kept out the heat of entry (game fiction: salvaging it).',
  },
};

const PICKABLE = new Set<MapItem['kind']>(['o2', 'lioh', 'water', 'battery', 'repair', 'scrap', 'manual']);

/** Supplies, rocket pieces, manual pages and the NASA salvage sites can be picked up; the base, wreck shelter and rover cannot. */
export const isPickable = (item: MapItem, salvaged: readonly string[] = []) =>
  PICKABLE.has(item.kind) || (item.id in SALVAGE && !salvaged.includes(item.id));

const isSalvage = (item: MapItem) => item.id in SALVAGE && !PICKABLE.has(item.kind);

/** Dropped things as map items, for the 3D world and for picking up again. */
export const droppedItems = (pack: Pack): MapItem[] => pack.dropped.map((d) => d.item);

/** The nearest thing the astronaut has spotted and can pick up from where they stand, if any. */
export function pickupTarget(world: Pick<MapWorldState, 'items' | 'found'> | null, pos: Pt, pack: Pack): MapItem | null {
  let best: MapItem | null = null;
  let bestD = PICKUP_RADIUS_M;
  const consider = (it: MapItem) => {
    const d = Math.hypot(it.at.x - pos.x, it.at.y - pos.y);
    if (d <= bestD) { best = it; bestD = d; }
  };
  for (const it of world?.items ?? []) {
    if (!isPickable(it, pack.salvaged) || pack.taken.includes(it.id)) continue;
    if (it.hidden && !world!.found.has(it.id)) continue;
    consider(it);
  }
  for (const it of droppedItems(pack)) consider(it);
  return best;
}

/** Turn a map item into what goes in the backpack, using content.json for mass, refills and scrap yields. */
export function packEntryFor(item: MapItem, content: ContentFile | null | undefined, rng: () => number = Math.random): PackEntry {
  if (isSalvage(item)) return { id: item.id, itemKind: 'scrap', ...SALVAGE[item.id] };
  if (item.kind === 'manual') {
    const page = Number(item.contentId ?? item.id.replace(/\D+/g, ''));
    return { id: item.id, kind: 'page', itemKind: 'manual', name: item.label, massKg: 0, page: Number.isFinite(page) ? page : undefined };
  }
  const key = item.contentId ?? item.id;
  const supply = content?.supplies.find((s) => s.id === key);
  if (supply) {
    const gives: Partial<Record<SuitKey, number>> = {};
    for (const k of SUIT_KEYS) if (typeof supply.gives[k] === 'number') gives[k] = supply.gives[k];
    return {
      id: item.id, kind: 'supply', itemKind: item.kind, name: supply.name, massKg: supply.massKg, gives,
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
    return {
      id: item.id, kind: 'scrap', itemKind: 'scrap', name: piece.name, massKg: piece.massKg, yields: { ...piece.yields },
      ...(contains ? { contains } : {}), note: piece.note,
    };
  }
  // Not in content.json (no data yet): still collectable, with a nominal mass.
  return { id: item.id, kind: item.kind === 'scrap' ? 'scrap' : 'supply', itemKind: item.kind, name: item.label, massKg: 1 };
}

/** Total carried mass, kg. */
export const carriedKg = (pack: Pack) => pack.entries.reduce((sum, e) => sum + e.massKg, 0);

/** Would this fit in the backpack? */
export const fits = (pack: Pack, massKg: number) => carriedKg(pack) + massKg <= BACKPACK_MAX_KG + 1e-9;

/** What picking this item up would put in the backpack (a dropped item comes back as it was). */
export function entryForPickup(pack: Pack, item: MapItem, content: ContentFile | null | undefined, rng?: () => number): PackEntry {
  return pack.dropped.find((d) => d.item.id === item.id)?.entry ?? packEntryFor(item, content, rng);
}

/** Pick an item up. `ok` is false (and nothing changes) when it would overfill the backpack. */
export function pickUp(pack: Pack, item: MapItem, content: ContentFile | null | undefined, rng?: () => number): { pack: Pack; ok: boolean; entry: PackEntry } {
  const entry = entryForPickup(pack, item, content, rng);
  if (!fits(pack, entry.massKg)) return { pack, ok: false, entry };
  const wasDropped = pack.dropped.some((d) => d.item.id === item.id);
  if (wasDropped) return { pack: { ...pack, entries: [...pack.entries, entry], dropped: pack.dropped.filter((d) => d.item.id !== item.id) }, ok: true, entry };
  if (isSalvage(item)) {
    if (pack.salvaged.includes(item.id)) return { pack, ok: false, entry };
    return { pack: { ...pack, entries: [...pack.entries, entry], salvaged: [...pack.salvaged, item.id] }, ok: true, entry };
  }
  if (pack.taken.includes(item.id)) return { pack, ok: false, entry };
  return { pack: { ...pack, entries: [...pack.entries, entry], taken: [...pack.taken, item.id] }, ok: true, entry };
}

/** Put something down where the astronaut stands; it can be picked up again with F. */
export function drop(pack: Pack, id: string, at: Pt): Pack {
  const entry = pack.entries.find((e) => e.id === id);
  if (!entry) return pack;
  const item: MapItem = { id: `drop:${entry.id}`, kind: entry.itemKind ?? 'scrap', label: entry.name, at: { ...at }, hidden: false };
  return { ...pack, entries: pack.entries.filter((e) => e.id !== id), dropped: [...pack.dropped, { item, entry }] };
}

/** Can this entry be used on the suit right now? */
export const usable = (e: PackEntry) => e.kind === 'supply' && !!e.gives && Object.keys(e.gives).length > 0;

/** Suit keys measured in kg: using them makes the carried container lighter. */
const KG_KEYS = new Set<SuitKey>(['o2Kg', 'liohKg', 'waterKg']);
/** Top-ups smaller than this count as "the suit is already full" (5 g, or half a watt-hour). */
const MIN_TOP_UP: Record<SuitKey, number> = { o2Kg: 0.005, liohKg: 0.005, waterKg: 0.005, batteryWh: 0.5 };

/**
 * Use a supply from a list (the backpack or the ship's storage): the suit is topped up to full, and whatever the
 * suit can't take stays in the list (lighter by what was used). An emptied container is left behind. If the suit
 * is already full nothing changes (`added` is empty). Returns null when the entry can't be used at all.
 */
export function applySupply(entries: PackEntry[], id: string, suit: SuitState, full: Pick<SuitState, SuitKey>): { entries: PackEntry[]; suit: SuitState; added: Partial<Record<SuitKey, number>> } | null {
  const e = entries.find((x) => x.id === id);
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
  if (Object.keys(added).length === 0) return { entries, suit, added: {} };
  const out = Object.keys(left).length
    ? entries.map((x) => (x.id === id ? { ...x, gives: left, massKg: Math.max(0, x.massKg - usedKg) } : x))
    : entries.filter((x) => x.id !== id);
  return { entries: out, suit: next, added };
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
