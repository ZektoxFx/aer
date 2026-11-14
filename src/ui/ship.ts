import type { ContentFile } from '../data/files';
import type { Pt } from '../map/geo';
import type { SuitState } from '../sim/types';
import { fits, type Pack, type PackEntry, type SuitKey } from './inventory';

// The crashed lander as a base: storage with no weight limit, and repairs that bring its systems back.
// Story (UI owner, November 14): repair the ship first so it becomes a base to survive from;
// the win is still calling Earth through Perseverance. Repair recipes and effects are UI design values and game
// fiction; the NASA parts come from real hardware sites in Jezero (see SALVAGE in inventory.ts).

export interface Ship {
  /** Supplies, manual pages and NASA parts kept in the cabin. */
  stored: PackEntry[];
  /** Scrap materials (kg): rocket pieces are broken down when stored. */
  materials: Record<string, number>;
  repaired: RepairId[];
  /** Things built at the workbench (ids), e.g. the rover comms link. */
  built: string[];
}

export const EMPTY_SHIP: Ship = { stored: [], materials: {}, repaired: [], built: [] };

// ---- Where the storage is: a small locker inside the lander, then the storage room built outside ----

/** The lander's inside locker holds this much (stored items plus scrap materials), until the storage room is built. */
export const SHIP_LOCKER_KG = 25;
/** Within this distance of the lander's centre, the astronaut is aboard (through the hatch), metres. */
export const ABOARD_RADIUS_M = 5;
/** The storage room, once built: offset from the lander in map metres (east, south), and how close counts as inside it. */
export const STORAGE_ROOM_AT = { dx: 13, dy: -6 };
export const STORAGE_ROOM_RADIUS_M = 5;
export const STORAGE_ROOM_ID = 'storage_room';
export const SUIT_PATCH_ID = 'suit_patch';

export const hasStorageRoom = (ship: Ship) => ship.built.includes(STORAGE_ROOM_ID);
/** Mass in the ship: stored items plus scrap materials, kg. */
export const shipKg = (ship: Ship) =>
  ship.stored.reduce((a, e) => a + e.massKg, 0) + Object.values(ship.materials).reduce((a, b) => a + b, 0);
/** Room left in the ship's storage, kg (unlimited once the storage room is built). */
export const shipRoomKg = (ship: Ship) => (hasStorageRoom(ship) ? Infinity : Math.max(0, SHIP_LOCKER_KG - shipKg(ship)));
export const shipFits = (ship: Ship, kg: number) => kg <= shipRoomKg(ship) + 1e-9;

/** Inside the lander (through the hatch). */
export const aboard = (pos: Pt, base: Pt) => Math.hypot(pos.x - base.x, pos.y - base.y) <= ABOARD_RADIUS_M;
export const storageRoomPoint = (base: Pt): Pt => ({ x: base.x + STORAGE_ROOM_AT.dx, y: base.y + STORAGE_ROOM_AT.dy });
/** Where the storage can be used: aboard the lander, or in the storage room once it is built. */
export const atStorage = (pos: Pt, base: Pt, ship: Ship) => {
  if (aboard(pos, base)) return true;
  if (!hasStorageRoom(ship)) return false;
  const r = storageRoomPoint(base);
  return Math.hypot(pos.x - r.x, pos.y - r.y) <= STORAGE_ROOM_RADIUS_M;
};

export type RepairId = 'hull' | 'power' | 'life';

export interface Repair {
  id: RepairId | typeof COMMS_LINK_ID | typeof STORAGE_ROOM_ID | typeof SUIT_PATCH_ID;
  name: string;
  /** Game minutes the work takes (time passes in the cabin). */
  minutes: number;
  /** Scrap materials used (material id → kg), from the ship's storage. */
  materials: Record<string, number>;
  /** NASA parts used (SALVAGE ids), from the ship's storage or the backpack. */
  parts: string[];
  /** Manual page needed to know how (in the backpack or the ship). */
  page?: number;
  /** A blueprint needed to know how (in the backpack or the ship), by its id. */
  blueprint?: string;
  /** Needs the repair kit's tools (they are not used up). */
  tool: boolean;
  /** Repairs that must be done first. */
  after?: RepairId[];
  does: string;
}

export const REPAIRS: Repair[] = [
  {
    id: 'hull', name: 'Seal the cabin hull', minutes: 60, materials: { metal: 6, insulation: 3 }, parts: ['parachute_backshell'], tool: true,
    does: 'The cabin holds air again: a sealed base to work from.',
  },
  {
    id: 'power', name: 'Restore ship power', minutes: 40, materials: { solarCells: 2, wiring: 1 }, parts: ['descent_stage'], page: 1, tool: true,
    does: 'At the lander, your suit battery recharges to full.',
  },
  {
    id: 'life', name: 'Restart life support', minutes: 60, materials: { tankParts: 4 }, parts: [], page: 2, tool: true, after: ['hull', 'power'],
    does: "At the lander, the ship's tanks refill your suit's O₂, scrubber and water.",
  },
];

/**
 * Put a backpack item in the ship. Rocket pieces are broken down into their materials. Nothing changes (the same
 * objects come back) when it won't fit in the locker.
 */
export function store(pack: Pack, ship: Ship, id: string): { pack: Pack; ship: Ship } {
  const e = pack.entries.find((x) => x.id === id);
  if (!e || !shipFits(ship, e.kind === 'scrap' ? Object.values(e.yields ?? {}).reduce((a, b) => a + b, 0) : e.massKg)) return { pack, ship };
  const rest = { ...pack, entries: pack.entries.filter((x) => x.id !== id) };
  if (e.kind === 'scrap') {
    const materials = { ...ship.materials };
    for (const [m, kg] of Object.entries(e.yields ?? {})) materials[m] = (materials[m] ?? 0) + kg;
    return { pack: rest, ship: { ...ship, materials } };
  }
  return { pack: rest, ship: { ...ship, stored: [...ship.stored, e] } };
}

export function storeAll(pack: Pack, ship: Ship): { pack: Pack; ship: Ship } {
  return pack.entries.reduce((acc, e) => store(acc.pack, acc.ship, e.id), { pack, ship });
}

/** Take something from the ship into the backpack; null when it would overfill the backpack. */
export function take(pack: Pack, ship: Ship, id: string): { pack: Pack; ship: Ship } | null {
  const e = ship.stored.find((x) => x.id === id);
  if (!e || !fits(pack, e.massKg)) return null;
  return { pack: { ...pack, entries: [...pack.entries, e] }, ship: { ...ship, stored: ship.stored.filter((x) => x.id !== id) } };
}

export interface Need {
  label: string;
  have: boolean;
}

const all = (pack: Pack, ship: Ship) => [...pack.entries, ...ship.stored];

/** What a repair needs, each ticked when the player has it. `names` turns material ids into names. */
export function repairNeeds(r: Repair, pack: Pack, ship: Ship, names: (m: string) => string = (m) => m, partName: (id: string) => string = (id) => id): Need[] {
  const items = all(pack, ship);
  const needs: Need[] = [];
  for (const dep of r.after ?? []) needs.push({ label: `First: ${REPAIRS.find((x) => x.id === dep)!.name.toLowerCase()}`, have: ship.repaired.includes(dep) });
  if (r.tool) needs.push({ label: 'Tools: repair kit', have: items.some((e) => !!e.repairs) });
  if (r.page !== undefined) needs.push({ label: `Manual page ${r.page}`, have: items.some((e) => e.kind === 'page' && e.page === r.page) });
  if (r.blueprint) needs.push({ label: 'Blueprint: storage room', have: items.some((e) => e.blueprint === r.blueprint) });
  for (const p of r.parts) needs.push({ label: partName(p), have: items.some((e) => e.id === p) });
  for (const [m, kg] of Object.entries(r.materials)) {
    const got = ship.materials[m] ?? 0;
    needs.push({ label: `${names(m)} ${kg} kg (stored: ${Math.round(got * 10) / 10})`, have: got + 1e-9 >= kg });
  }
  return needs;
}

export const canRepair = (r: Repair, pack: Pack, ship: Ship) =>
  !(ship.repaired as string[]).includes(r.id) && repairNeeds(r, pack, ship).every((n) => n.have);

/** Do a repair: materials and parts are used up (tools and manual pages are kept). Null if it can't be done. */
export function doRepair(r: Repair, pack: Pack, ship: Ship): { pack: Pack; ship: Ship } | null {
  if (!canRepair(r, pack, ship)) return null;
  const materials = { ...ship.materials };
  for (const [m, kg] of Object.entries(r.materials)) {
    materials[m] = Math.round(((materials[m] ?? 0) - kg) * 1000) / 1000;
    if (materials[m] <= 0) delete materials[m];
  }
  const used = new Set(r.parts);
  return {
    pack: { ...pack, entries: pack.entries.filter((e) => !used.has(e.id)) },
    ship: { ...ship, materials, stored: ship.stored.filter((e) => !used.has(e.id)), repaired: [...ship.repaired, r.id as RepairId] },
  };
}

// ---- The workbench: building the rover comms link (the way home, proposal §6.2) ----

export const COMMS_LINK_ID = 'comms_link';
/** Mass of the built comms link (design value). */
export const COMMS_LINK_KG = 1.5;

/**
 * The rover comms link as a workbench job, from the Data role's content.json recipe (falls back to its current
 * values). It needs ship power for the tools, the repair kit, and manual page 4.
 */
export function commsLinkJob(content?: ContentFile | null): Repair {
  const r = content?.recipes.find((x) => x.id === 'rover_comms_link');
  // Story (UI owner, November 15): this is the kit that repairs Perseverance's radio link. Recipe from content.json.
  const does = "Repairs Perseverance's radio link, so it can send your distress call";
  return {
    id: COMMS_LINK_ID, name: 'Rover radio repair kit', minutes: r?.buildMin ?? 60,
    materials: { ...(r?.needs ?? { electronics: 2, wiring: 2 }) }, parts: [], page: r?.manualPage ?? 4, tool: true, after: ['power'],
    does: `${does}${does.endsWith('.') ? '' : '.'}`,
  };
}

export const commsLinkEntry = (name = 'Rover radio repair kit'): PackEntry => ({
  id: COMMS_LINK_ID, kind: 'part', name, massKg: COMMS_LINK_KG,
  note: "Built from AER-1 parts and field manual page 4. It repairs Perseverance's UHF radio link. Mass is a design value.",
});

/**
 * Build the storage room outside the lander from the blueprint and hull scrap. Afterwards storage has no weight limit,
 * and it can be used in the room too. Recipe: design values.
 */
export const STORAGE_ROOM_JOB: Repair = {
  id: STORAGE_ROOM_ID, name: 'Storage room', minutes: 90, materials: { metal: 8, fabric: 3, wiring: 1 }, parts: [],
  blueprint: STORAGE_ROOM_ID, tool: true,
  does: `A room beside the lander: storage with no weight limit (the locker inside holds ${SHIP_LOCKER_KG} kg).`,
};

/** Patch the suit damage from the crash: stops the slow oxygen leak. Recipe: design values. */
export const SUIT_PATCH_JOB: Repair = {
  id: SUIT_PATCH_ID, name: 'Patch the suit leak', minutes: 30, materials: { fabric: 1, insulation: 1 }, parts: [], tool: true,
  does: 'Seals the tear from the crash: the suit stops leaking oxygen.',
};

/** Until it is patched, the crash-damaged suit loses this share of extra O₂ on top of breathing (design value). */
export const SUIT_LEAK = 0.25;
export const suitLeaking = (ship: Ship) => !ship.built.includes(SUIT_PATCH_ID);

export const canBuild = (job: Repair, pack: Pack, ship: Ship) =>
  !ship.built.includes(job.id) && repairNeeds(job, pack, ship).every((n) => n.have);

/**
 * Build at the workbench: materials are used up, and the product (if any) goes in the backpack, or the ship if it
 * won't fit.
 */
export function doBuild(job: Repair, pack: Pack, ship: Ship, product?: PackEntry): { pack: Pack; ship: Ship; inPack: boolean } | null {
  if (!canBuild(job, pack, ship)) return null;
  const materials = { ...ship.materials };
  for (const [m, kg] of Object.entries(job.materials)) {
    materials[m] = Math.round(((materials[m] ?? 0) - kg) * 1000) / 1000;
    if (materials[m] <= 0) delete materials[m];
  }
  const nextShip = { ...ship, materials, built: [...ship.built, job.id] };
  if (!product) return { pack, ship: nextShip, inPack: false };
  if (fits(pack, product.massKg)) return { pack: { ...pack, entries: [...pack.entries, product] }, ship: nextShip, inPack: true };
  return { pack, ship: { ...nextShip, stored: [...nextShip.stored, product] }, inPack: false };
}

/** The repaired ship's help at the lander: power recharges the battery; life support refills the rest. */
export function shipTopUp(ship: Ship, suit: SuitState, full: Pick<SuitState, SuitKey>): SuitState {
  const power = ship.repaired.includes('power');
  const life = ship.repaired.includes('life');
  if (!power && !life) return suit;
  return {
    ...suit,
    ...(power ? { batteryWh: Math.max(suit.batteryWh, full.batteryWh) } : {}),
    ...(life ? { o2Kg: Math.max(suit.o2Kg, full.o2Kg), liohKg: Math.max(suit.liohKg, full.liohKg), waterKg: Math.max(suit.waterKg, full.waterKg) } : {}),
  };
}
