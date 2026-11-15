// Then and now at the real NASA sites (Map/Aiman, story work with UI's OK): when the astronaut stands at a place
// Perseverance photographed, the HUD shows that archived photo (the "then") beside the live 3D view (the "now").
// Photos and their sol, instrument and credit come from the Data role's public/data/photos/photos.json.
import type { MapItem, Pt } from '../map';

export interface SitePhoto { poi: string; file: string; sol: number; instrument: string; date_taken_utc: string; credit: string }

/** How close the astronaut must be to a site for its photo to show, metres. */
export const PHOTO_REACH_M = 25;

const CAMERA: Record<string, string> = {
  MCZ_LEFT: 'Mastcam-Z (left)', MCZ_RIGHT: 'Mastcam-Z (right)', NAVCAM_LEFT: 'Navcam', NAVCAM_RIGHT: 'Navcam',
  FRONT_HAZCAM_LEFT_A: 'front Hazcam', REAR_HAZCAM_LEFT: 'rear Hazcam', HELI_RTE: 'Ingenuity color camera', HELI_NAV: 'Ingenuity nav camera',
};
/** A readable camera name for an instrument code (falls back to the code). */
export const cameraName = (code: string) => CAMERA[code] ?? (code.includes(' ') ? code : code.replace(/_/g, ' ').toLowerCase());

/**
 * The first photo of each site. pois.json lists each site's photo files; photos.json describes each file (its own
 * `poi` names differ from the map's ids, so files are matched by name). A file without a description still shows.
 */
export function photosByPoi(pois: { id: string; photos?: string[] }[], list: SitePhoto[]): Map<string, SitePhoto> {
  const byFile = new Map(list.map((p) => [p.file, p]));
  const m = new Map<string, SitePhoto>();
  for (const poi of pois) {
    const file = poi.photos?.[0];
    if (!file) continue;
    m.set(poi.id, byFile.get(file) ?? { poi: poi.id, file, sol: NaN, instrument: '', date_taken_utc: '', credit: 'NASA/JPL-Caltech' });
  }
  return m;
}

/** Load the site photos once (both files are small). */
export async function loadSitePhotos(): Promise<Map<string, SitePhoto>> {
  const [pois, list] = await Promise.all([
    fetch('/data/pois.json').then((r) => r.json()) as Promise<{ pois: { id: string; photos?: string[] }[] }>,
    fetch('/data/photos/photos.json').then((r) => r.json()) as Promise<SitePhoto[]>,
  ]);
  return photosByPoi(pois.pois ?? [], Array.isArray(list) ? list : []);
}

/** The nearest site within reach that has a photo, or null. */
export function photoSiteNear(items: MapItem[], pos: Pt, photos: Map<string, SitePhoto>, reachM = PHOTO_REACH_M): { item: MapItem; photo: SitePhoto } | null {
  let best: { item: MapItem; photo: SitePhoto } | null = null, bestD = reachM;
  for (const i of items) {
    const photo = i.poiId ? photos.get(i.poiId) : undefined;
    if (!photo) continue;
    const d = Math.hypot(i.at.x - pos.x, i.at.y - pos.y);
    if (d <= bestD) { best = { item: i, photo }; bestD = d; }
  }
  return best;
}
