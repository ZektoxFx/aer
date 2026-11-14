// Loader for the 2 m height tile around the AER-1 cabin (public/data/terrain_patch_2m.bin + .json).
// Owned by the Data role. Built by tools/data/bake_patch.py; see docs/DATA_SOURCES.md.
import type { TerrainPatchMeta } from './files';

export interface TerrainPatch {
  meta: TerrainPatchMeta;
  /** Heights in metres, row-major from the tile's north-west corner (meta.rows x meta.cols). */
  heightsM: Float32Array;
}

/** Turn the raw .bin bytes (uint16 little-endian) into heights in metres. */
export function decodeTerrainPatch(meta: TerrainPatchMeta, bytes: ArrayBuffer): TerrainPatch {
  const n = meta.rows * meta.cols;
  if (bytes.byteLength !== n * 2) throw new Error(`terrain patch: expected ${n * 2} bytes, got ${bytes.byteLength}`);
  const view = new DataView(bytes);
  const heightsM = new Float32Array(n);
  for (let i = 0; i < n; i++) heightsM[i] = meta.minM + view.getUint16(i * 2, true) * meta.scaleM;
  return { meta, heightsM };
}

/** Fetch and decode the tile. base is the folder that holds the files (the app serves public/data at /data/). */
export async function loadTerrainPatch(base = '/data/'): Promise<TerrainPatch> {
  const meta = (await (await fetch(`${base}terrain_patch_2m.json`)).json()) as TerrainPatchMeta;
  const bytes = await (await fetch(`${base}${meta.file}`)).arrayBuffer();
  return decodeTerrainPatch(meta, bytes);
}

/**
 * Height at a map position (same frame as jezero_pack.json: metres from the map's north-west corner, x east, y south),
 * interpolated between cell centres. Returns null outside the tile, so callers can fall back to the 10 m grid.
 */
export function patchHeightAt(p: TerrainPatch, xM: number, yM: number): number | null {
  const { cols, rows, cellM, x0M, y0M } = p.meta;
  const fx = (xM - x0M) / cellM - 0.5;
  const fy = (yM - y0M) / cellM - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > cols - 0.5 || fy > rows - 0.5) return null;
  const cx = Math.min(Math.max(fx, 0), cols - 1);
  const cy = Math.min(Math.max(fy, 0), rows - 1);
  const c0 = Math.min(Math.floor(cx), cols - 2);
  const r0 = Math.min(Math.floor(cy), rows - 2);
  const tx = cx - c0;
  const ty = cy - r0;
  const h = p.heightsM;
  const a = h[r0 * cols + c0];
  const b = h[r0 * cols + c0 + 1];
  const c = h[(r0 + 1) * cols + c0];
  const d = h[(r0 + 1) * cols + c0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
