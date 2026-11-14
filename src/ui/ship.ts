import type { ContentFile } from '../data/files';
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

export type RepairId = 'hull' | 'power' | 'life';

export interface Repair {
  id: RepairId | typeof COMMS_LINK_ID;
  name: string;
  /** Game minutes the work takes (time passes in the cabin). */
  minutes: number;
  /** Scrap materials used (material id → kg), from the ship's storage. */
  materials: Record<string, number>;
  /** NASA parts used (SALVAGE ids), from the ship's storage or the backpack. */
  parts: string[];
  /** Manual page needed to know how (in the backpack or the ship). */
  page?: number;
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

/** Put a backpack item in the ship. Rocket pieces are broken down into their materials. */
export function store(pack: Pack, ship: Ship, id: string): { pack: Pack; ship: Ship } {
  const e = pack.entries.find((x) => x.id === id);
  if (!e) return { pack, ship };
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
  const does = r?.does ?? "Connects to the rover's radio to send the distress call";
  return {
    id: COMMS_LINK_ID, name: r?.name ?? 'Rover comms link', minutes: r?.buildMin ?? 60,
    materials: { ...(r?.needs ?? { electronics: 2, wiring: 2 }) }, parts: [], page: r?.manualPage ?? 4, tool: true, after: ['power'],
    does: `${does}${does.endsWith('.') ? '' : '.'}`,
  };
}

export const commsLinkEntry = (name = 'Rover comms link'): PackEntry => ({
  id: COMMS_LINK_ID, kind: 'part', name, massKg: COMMS_LINK_KG,
  note: "Built from field manual page 4. It plugs into Perseverance's UHF radio. Mass is a design value.",
});

export const canBuild = (job: Repair, pack: Pack, ship: Ship) =>
  !ship.built.includes(job.id) && repairNeeds(job, pack, ship).every((n) => n.have);

/** Build at the workbench: materials are used up, and the product goes in the backpack (or the ship if it won't fit). */
export function doBuild(job: Repair, pack: Pack, ship: Ship, product: PackEntry): { pack: Pack; ship: Ship; inPack: boolean } | null {
  if (!canBuild(job, pack, ship)) return null;
  const materials = { ...ship.materials };
  for (const [m, kg] of Object.entries(job.materials)) {
    materials[m] = Math.round(((materials[m] ?? 0) - kg) * 1000) / 1000;
    if (materials[m] <= 0) delete materials[m];
  }
  const nextShip = { ...ship, materials, built: [...ship.built, job.id] };
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
