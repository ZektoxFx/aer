import type { MapItem } from '../map';
import type { Pt } from '../map/geo';

// AER-1's own parts, scattered along the crash path: the lander broke up as it skidded in, so hull panels, straps,
// blankets, wiring and boxes lie in a fan behind it (the same direction as the Map role's skid marks and debris in
// world3d.ts). They are the raw material for survival: repairing the ship, patching the suit, building the storage
// room and the rover radio repair kit. The storage-room blueprint lies among them. Game fiction; masses and yields come
// from the Data role's content.json rocketPieces.

/** The direction the lander slid in from (matches the map's skid, radians). */
const SKID_YAW = 0.6;

interface Spec { id: string; contentId?: string; label: string; d: number; side: number; note?: string }
const SPECS: Spec[] = [
  { id: 'aer1-hull-1', contentId: 'hull_panel', label: 'AER-1 hull panel', d: 45, side: 8 },
  { id: 'aer1-blanket', contentId: 'thermal_blanket', label: 'AER-1 thermal blanket', d: 70, side: -14 },
  { id: 'aer1-wiring', contentId: 'wiring_harness', label: 'AER-1 wiring harness', d: 95, side: 20 },
  { id: 'aer1-hull-2', contentId: 'hull_panel', label: 'AER-1 hull panel', d: 120, side: -25 },
  {
    id: 'blueprint:storage_room', label: 'Blueprint: storage room', d: 140, side: 12,
    note: "AER-1's flight kit: how to put up a storage room from hull panels, parachute fabric and wiring.",
  },
  { id: 'aer1-solar', contentId: 'solar_segment', label: 'AER-1 solar panel segment', d: 150, side: 35 },
  { id: 'aer1-straps', contentId: 'parachute_straps', label: 'AER-1 parachute straps', d: 180, side: -30 },
  { id: 'aer1-avionics', contentId: 'avionics_box', label: 'AER-1 avionics box', d: 210, side: 18 },
  { id: 'aer1-hull-3', contentId: 'hull_panel', label: 'AER-1 hull panel', d: 260, side: -10 },
  { id: 'aer1-tank', contentId: 'tank_valves', label: 'AER-1 tank and valves', d: 300, side: 28 },
];

/** AER-1's scattered parts (and the blueprint) as map items, placed behind the lander along the crash path. */
export function debrisItems(base: Pt, area: { widthM: number; heightM: number }): MapItem[] {
  const c = Math.cos(SKID_YAW), s = Math.sin(SKID_YAW);
  const M = 20;
  return SPECS.map((sp) => {
    // Behind the lander (−d along the skid), spread sideways.
    const x = base.x - c * sp.d - s * sp.side, y = base.y - s * sp.d + c * sp.side;
    return {
      id: sp.id, kind: sp.contentId ? 'scrap' : 'manual', label: sp.label, contentId: sp.contentId, hidden: false,
      at: { x: Math.min(area.widthM - M, Math.max(M, x)), y: Math.min(area.heightM - M, Math.max(M, y)) },
      ...(sp.note ? { note: sp.note } : {}),
    };
  });
}
