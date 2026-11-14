// The map built from the Data role's real Jezero files: jezero_pack.json (elevation, lander, debris trail,
// manual pages), pois.json (NASA hardware, samples, rover positions, traverse), layers_20m.json (terrain class)
// and content.json (supply and rocket-piece ids, recipes, history cards, science target). Positions come from Data wherever Data gives them;
// only the off-trail pieces and pages are placed by the Map role (design values, tune in playtesting).
import type { ContentFile, PoiFile, TerrainLayers } from '../data/files';
import type { DataPack } from '../data/types';
import type { Pt } from './geo';
import { dist } from './geo';
import type { HazardKind, HazardZone, ItemKind, Layout, MapItem } from './layout';
import { HAZARD_EFFECT, seeded } from './layout';

/** The parts of the Data role's content.json the map reads (all optional, so the map still works without it). */
export type MapContent = Partial<Pick<ContentFile, 'supplies' | 'rocketPieces' | 'recipes' | 'historyCards' | 'scienceTarget'>>;

/** Pack easting/northing (metres from the landing site) to map metres from the north-west corner. */
export function packXY(area: DataPack['area'], eastingM: number, northingM: number): Pt {
  const eMin = area.eMin ?? -area.widthM / 2, nMax = area.nMax ?? area.heightM / 2;
  return { x: eastingM - eMin, y: nMax - northingM };
}

/** layers_20m.json terrain classes that slow walking: 1 rocky, 2 loose sand likely (see docs/DATA_SOURCES.md). */
const CLASS_ZONES: { cls: number; id: string; kind: HazardKind; label: string }[] = [
  { cls: 1, id: 'rocky', kind: 'rocks', label: 'Rocky ground (HiRISE roughness)' },
  { cls: 2, id: 'loose-sand', kind: 'sand', label: 'Loose sand likely (THEMIS thermal inertia)' },
];

/** Hazard zones from layers_20m.json terrain classes. Steep and cliff cells are left to the slope check. */
export function hazardsFromLayers(layers: TerrainLayers): HazardZone[] {
  return CLASS_ZONES.map(({ cls, id, kind, label }) => {
    const on = new Uint8Array(layers.cols * layers.rows);
    layers.terrainClass.forEach((c, i) => { if (c === cls) on[i] = 1; });
    return { id, kind, ...HAZARD_EFFECT[kind], label, poly: [], mask: { cols: layers.cols, rows: layers.rows, cellM: layers.cellM, on } };
  });
}

/** Nearest firm, gentle 20 m cell to `p` (within 400 m), so placed items never sit on sand or a cliff. */
export function openSpot(layers: TerrainLayers | null, p: Pt): Pt {
  if (!layers) return p;
  const { cols, rows, cellM } = layers;
  const c0 = Math.floor(p.x / cellM), r0 = Math.floor(p.y / cellM);
  for (let ring = 0; ring <= 400 / cellM; ring++) {
    let best: Pt | null = null, bestD = Infinity;
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
        if (c < 2 || r < 2 || c >= cols - 2 || r >= rows - 2) continue;
        const i = r * cols + c;
        if (layers.terrainClass[i] !== 0 || layers.slopeDeg[i] > 12) continue;
        const q = { x: (c + 0.5) * cellM, y: (r + 0.5) * cellM };
        const d = dist(p, q);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    if (best) return best;
  }
  return p;
}

/** Spread several items found at one spot onto a small ring so their icons don't overlap. */
const around = (p: Pt, k: number, n: number, rM = 22): Pt =>
  n <= 1 ? p : { x: p.x + rM * Math.cos((2 * Math.PI * k) / n), y: p.y + rM * Math.sin((2 * Math.PI * k) / n) };

const KIND: Record<string, ItemKind> = {
  o2_bottle: 'o2', lioh_canister: 'lioh', water_pack: 'water', battery_pack: 'battery', repair_kit: 'repair', wreck: 'shelter',
};
const NAME: Record<string, string> = {
  o2_bottle: 'O₂ bottle', lioh_canister: 'LiOH canister', water_pack: 'Water pack', battery_pack: 'Battery pack', repair_kit: 'Repair kit',
  hull_panel: 'Hull or fairing panel', parachute_straps: 'Parachute and straps', thermal_blanket: 'Thermal blanket',
  wiring_harness: 'Wiring harness', avionics_box: 'Avionics box or antenna', solar_segment: 'Solar array segment',
  tank_valves: 'Tank and valves', wreck: 'Large wreck piece (storm shelter)',
};

/** What each debris spot in the pack's scatteredSupplies holds, as content.json ids (matches the pack's yields). */
const AT_DEBRIS: Record<string, string[]> = {
  scrap_metal: ['hull_panel', 'thermal_blanket'],
  supplies: ['o2_bottle', 'lioh_canister', 'water_pack'],
  scrap_electronics: ['solar_segment', 'wiring_harness'],
  battery: ['battery_pack'],
  scrap_tank: ['tank_valves', 'wreck'],
  tools: ['repair_kit'],
};

/**
 * Off-trail pieces and manual pages (Map design values): metres east / south of the cabin, then moved to
 * the nearest firm ground. The comms page lies toward the rover's area so the search pulls the player west.
 */
const OFF_TRAIL: { id: string; dx: number; dy: number }[] = [
  { id: 'avionics_box', dx: 250, dy: -700 },
  { id: 'parachute_straps', dx: -1100, dy: 150 }, // cut loose high up; the wind carried it west
];
/** Page spots by the recipe the page unlocks (works with both the old 'Rover Comms Link' and new 'rover_comms_link' names). */
const PAGE_SPOTS: Record<string, { dx: number; dy: number }> = {
  solar_patch: { dx: 400, dy: 330 },
  oxygen_tap: { dx: 600, dy: -350 },
  direction_finder: { dx: -500, dy: 600 },
  rover_comms_link: { dx: -1300, dy: -350 },
};
const OTHER_PAGE_SPOTS = [{ dx: -150, dy: -250 }, { dx: 300, dy: 650 }, { dx: -700, dy: -150 }];
const recipeKey = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

/** Data's rock formation for a sample target (matched by name in `associatedTarget`), as one line of text.
 *  Unchecked values stay marked [verify]. Empty when the pack has no matching formation. */
export function rockFor(pack: DataPack, target: string): string {
  const t = target.trim().toLowerCase();
  const f = (pack.rockFormations ?? []).find((r) => r.associatedTarget.toLowerCase().split(/[,&()]| and /).some((s) => s.trim() === t || s.trim().startsWith(`${t} `)));
  if (!f) return '';
  const unchecked = /\[verify/i.test(`${f.description} ${f.mineralogy}`);
  const source = /Source[^:]*:\s*([^'(]+)/.exec(f.description)?.[1].trim().replace(/[,.;]+$/, '');
  return `Rock: ${f.name} (${f.type}). ${f.mineralogy}${source ? ` (Source: ${source}.)` : ''}${unchecked ? ' [verify]' : ''}`;
}

export interface JezeroFiles {
  pack: DataPack;
  pois: PoiFile;
  layers: TerrainLayers | null;
  content?: MapContent | null;
}

/** Everything the map places on the real Jezero area. `seed` picks which real rover position is the live one. */
export function buildJezeroLayout({ pack, pois, layers, content }: JezeroFiles, seed = 1): Layout {
  const area = pack.area;
  const clampPt = (p: Pt): Pt => ({ x: Math.min(area.widthM - 40, Math.max(40, p.x)), y: Math.min(area.heightM - 40, Math.max(40, p.y)) });
  const cab = pack.crashedLander?.cabinLocation;
  const base = cab ? packXY(area, cab.eastingM, cab.northingM) : { x: area.widthM / 2, y: area.heightM / 2 };

  const names = new Map<string, string>([...(content?.supplies ?? []), ...(content?.rocketPieces ?? [])].map((s) => [s.id, s.name]));
  const yields = new Map((content?.rocketPieces ?? []).map((p) => [p.id, Object.keys(p.yields ?? {})]));
  const fictionItem = (id: string, at: Pt): MapItem => ({
    id, contentId: id === 'wreck' ? undefined : id, kind: KIND[id] ?? 'scrap', label: names.get(id) ?? NAME[id] ?? id,
    at: clampPt(at), hidden: true, fiction: true, ...(yields.get(id)?.length ? { yields: yields.get(id) } : {}),
  });

  const items: MapItem[] = [{ id: 'base', kind: 'base', label: `${pack.crashedLander?.name ?? 'Lander'} cabin (base)`, at: base, hidden: false, fiction: true, note: cab?.description }];

  // The crash trail: Data's debris spots, ordered from the far south-east end to the far north-west end.
  const debris = (pack.scatteredSupplies ?? []).map((s) => ({ s, at: packXY(area, s.eastingM, s.northingM) }));
  const axis = debris.length > 1 ? { x: debris[0].at.x - debris[debris.length - 1].at.x, y: debris[0].at.y - debris[debris.length - 1].at.y } : { x: 1, y: 1 };
  const along = (p: Pt) => (p.x - base.x) * axis.x + (p.y - base.y) * axis.y;
  const trail = [...debris.map((d) => d.at), base].sort((a, b) => along(b) - along(a));
  for (const d of debris) {
    const ids = AT_DEBRIS[d.s.type] ?? [];
    ids.forEach((id, k) => items.push(fictionItem(id, around(d.at, k, ids.length))));
  }
  for (const o of OFF_TRAIL) items.push(fictionItem(o.id, openSpot(layers, clampPt({ x: base.x + o.dx, y: base.y + o.dy }))));
  let other = 0;
  // The page the player must find: Data marks its recipe 'manual_required' (fallback: the comms recipe).
  const requiredPages = new Set((content?.recipes ?? []).filter((r) => r.knowledge === 'manual_required' && r.manualPage).map((r) => r.manualPage));
  const isRequired = (pageNumber: number, unlocks?: string) => (requiredPages.size ? requiredPages.has(pageNumber) : /comms/i.test(unlocks ?? ''));
  (pack.fieldManualPages ?? []).forEach((pg) => {
    const spot = PAGE_SPOTS[recipeKey(pg.unlocksRecipe ?? '')] ?? OTHER_PAGE_SPOTS[other++ % OTHER_PAGE_SPOTS.length];
    const unlocks = pg.unlocksRecipe || undefined;
    items.push({
      id: `page-${pg.pageNumber}`, contentId: String(pg.pageNumber), kind: 'manual', label: `Manual page ${pg.pageNumber}: ${pg.title}`,
      at: openSpot(layers, clampPt({ x: base.x + spot.dx, y: base.y + spot.dy })), hidden: true, fiction: true,
      ...(unlocks ? { unlocks } : {}), ...(isRequired(pg.pageNumber, unlocks) ? { required: true } : {}),
    });
  });

  // Real NASA sites: always on the map, because the cabin has the archive maps.
  const clues = new Map((pack.hardwareSites ?? []).map((h) => [h.id, h.clue]));
  const history = new Map((content?.historyCards ?? []).map((h) => [h.poiId, h.title]));
  const scienceId = content?.scienceTarget?.poiId ?? 'sample_12';
  const spotCount = new Map<string, number>();
  for (const p of pois.pois) {
    if (p.kind === 'rover_candidate') continue;
    const key = `${Math.round(p.xM)},${Math.round(p.yM)}`;
    const k = spotCount.get(key) ?? 0;
    spotCount.set(key, k + 1);
    const at = k ? around({ x: p.xM, y: p.yM }, k, 6, 14) : { x: p.xM, y: p.yM };
    const kind: ItemKind = p.id === scienceId ? 'science' : p.kind === 'science_sample' ? 'sample' : 'clue';
    const rock = p.target ? rockFor(pack, p.target) : '';
    const card = history.get(p.id);
    const note = [clues.get(p.id) || p.note, rock, card ? `History card: ${card}.` : ''].filter(Boolean).join(' ');
    items.push({ id: p.id, poiId: p.id, kind, label: p.name, at, hidden: false, ...(note ? { note } : {}), ...(rock ? { rock } : {}) });
  }

  // The rover: one of the real positions where Perseverance parked (seeded), plus its last known area.
  const spots = pois.pois.filter((p) => p.kind === 'rover_candidate').sort((a, b) => a.id.localeCompare(b.id));
  let searchArea: Layout['searchArea'];
  let archiveTraverse: Pt[][] = [], roverTracks: Pt[][] = [];
  if (spots.length) {
    const live = spots[Math.floor(seeded(seed)() * spots.length)];
    items.push({ id: 'rover', poiId: live.id, kind: 'rover', label: 'Perseverance (rover)', at: { x: live.xM, y: live.yM }, hidden: true, note: `Parked here on sol ${live.waypointSol}.` });
    const c = { x: spots.reduce((s, p) => s + p.xM, 0) / spots.length, y: spots.reduce((s, p) => s + p.yM, 0) / spots.length };
    searchArea = { at: c, r: Math.max(...spots.map((p) => dist(c, { x: p.xM, y: p.yM }))) + 400 };
    // The archive ends before the earliest parking sol; tracks after that lead to the live position.
    const archiveSol = Math.min(...spots.map((p) => p.waypointSol ?? Infinity)) - 20;
    const toPts = (xy: [number, number][]) => xy.map(([x, y]) => ({ x, y }));
    archiveTraverse = pois.traverse.filter((t) => t.sol < archiveSol).map((t) => toPts(t.pointsXY));
    roverTracks = pois.traverse.filter((t) => t.sol >= archiveSol && t.sol <= (live.waypointSol ?? 0)).map((t) => toPts(t.pointsXY));
  }

  return { zones: layers ? hazardsFromLayers(layers) : [], items, base, crashPath: trail, archiveTraverse, roverTracks, searchArea };
}
