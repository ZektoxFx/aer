import * as THREE from 'three';
import type { TerrainTilesFile } from '../data/files';
import { loadTerrainPatch } from '../data/terrainPatch';
import type { DataPack } from '../data/types';
import { heightAt, type Pt } from '../map';
import { cssColor } from './astronaut3d';

// The ground of the 3D view. Colours come from the :root variables via cssColor().

export interface Terrain {
  mesh: THREE.Mesh;
  /** Height of the drawn surface at a world (x, z), so things stand exactly on what you see. */
  surfaceY: (x: number, z: number) => number;
  /** Call every frame: fades the sharper photo tiles and the fine relief in once they have loaded. */
  update: (dt: number) => void;
  dispose: () => void;
}

export interface TerrainOptions {
  /** Largest anisotropic filtering the GPU offers. */
  maxAniso: number;
  /** Load the sharper HiRISE tiles and the 2 m relief (skipped on phones and data-saver connections). */
  hiRes: boolean;
  /** Folder that holds the data files. */
  dataBase?: string;
}

/**
 * A small tileable texture for what the orbital photo can't resolve up close.
 * Red: the height of lumpy sand with fine grain on top. Blue and alpha: that height's slope along x and y, so
 * the shader can light the lumps with one lookup (and far away the slopes average out to flat, as they should).
 * Green: soft, broad mottling.
 * This is set dressing, not data: it only shows within about 150 m of the camera.
 */
const DETAIL_SLOPE_GAIN = 4; // slopes are stored × this, to use the 8 bits well
function detailTexture(): THREE.DataTexture {
  const N = 256;
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // Value noise that wraps: a lattice of `period` random values, smoothly interpolated.
  const lattice = (period: number) => Float32Array.from({ length: period * period }, rand);
  const sample = (lat: Float32Array, period: number, x: number, y: number) => {
    const fx = (x / N) * period, fy = (y / N) * period;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (ix: number, iy: number) => lat[(iy % period) * period + (ix % period)];
    return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
  };
  const coarse = [4, 8, 16, 32].map((p) => ({ p, lat: lattice(p) }));
  const fine = [8, 16, 32, 64, 128].map((p) => ({ p, lat: lattice(p) }));
  // Summed noise bunches up round 0.5; stretch it so the lumps have contrast.
  const stretch = (v: number, k: number) => Math.min(1, Math.max(0, 0.5 + (v - 0.5) * k));
  const fbm = (octaves: { p: number; lat: Float32Array }[], x: number, y: number) => {
    let sum = 0, amp = 0.5, total = 0;
    for (const o of octaves) { sum += sample(o.lat, o.p, x, y) * amp; total += amp; amp *= 0.5; }
    return sum / total;
  };
  // Lumps the size of a hand down to a pebble, plus a little pixel-sized grain. The lumps carry the look:
  // pure grain averages away to flat grey a few metres from the camera.
  const height = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) height[y * N + x] = stretch(fbm(fine, x, y) + (rand() - 0.5) * 0.08, 2.6);
  const hAt = (x: number, y: number) => height[((y + N) % N) * N + ((x + N) % N)];
  const slope = (d: number) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + d * DETAIL_SLOPE_GAIN * 0.5)));
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      data[i] = Math.round(255 * height[y * N + x]);
      data[i + 1] = Math.round(255 * stretch(fbm(coarse, x, y), 2.2));
      data[i + 2] = slope((hAt(x + 1, y) - hAt(x - 1, y)) / 2);
      data[i + 3] = slope((hAt(x, y + 1) - hAt(x, y - 1)) / 2);
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * Ground slopes from a height grid, as a texture the shader turns into surface normals: red = slope toward the
 * east, green = slope toward the south (rise per metre, × `exag`). Row 0 is the north edge. Half-float, so gentle
 * slopes shade smoothly instead of in steps.
 */
function slopeTexture(heights: ArrayLike<number>, cols: number, rows: number, cellM: number, exag: number): THREE.DataTexture {
  const data = new Uint16Array(cols * rows * 2);
  const half = THREE.DataUtils.toHalfFloat;
  for (let r = 0; r < rows; r++) {
    const r0 = Math.max(r - 1, 0), r1 = Math.min(r + 1, rows - 1);
    for (let c = 0; c < cols; c++) {
      const c0 = Math.max(c - 1, 0), c1 = Math.min(c + 1, cols - 1);
      const i = (r * cols + c) * 2;
      data[i] = half(((heights[r * cols + c1] - heights[r * cols + c0]) / ((c1 - c0) * cellM)) * exag);
      data[i + 1] = half(((heights[r1 * cols + c] - heights[r0 * cols + c]) / ((r1 - r0) * cellM)) * exag);
    }
  }
  const t = new THREE.DataTexture(data, cols, rows, THREE.RGFormat, THREE.HalfFloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** A 1 × 1 stand-in until a real texture arrives (a sampler must always have something bound). */
function blankTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

const TERRAIN_PARS = /* glsl */ `
varying vec3 vTerrainPos;
uniform sampler2D uTileMid;
uniform sampler2D uTileHi;
uniform sampler2D uSlopeArea;
uniform sampler2D uSlopePatch;
uniform sampler2D uDetail;
uniform vec4 uMidRect;   // xy: north-west corner in world x, z; zw: 1 / size
uniform vec4 uHiRect;
uniform vec4 uAreaRect;
uniform vec4 uPatchRect;
uniform float uMidOn;
uniform float uHiOn;
uniform float uPatchOn;
uniform vec3 uTintLow;
uniform vec3 uTintHigh;
// Detail lumps: height in metres × texels per tile ÷ tile size in metres ÷ the stored slope gain.
const float DETAIL_BUMP_1 = 0.02 * 256.0 / 2.3 / ${(DETAIL_SLOPE_GAIN * 0.5).toFixed(1)};
const float DETAIL_BUMP_2 = 0.07 * 256.0 / 7.9 / ${(DETAIL_SLOPE_GAIN * 0.5).toFixed(1)};
// 1 inside a tile, falling to 0 at its edge, so a tile blends in instead of showing a border.
float aerEdge(vec2 uv, float feather) {
  vec2 d = min(uv, 1.0 - uv);
  return smoothstep(0.0, feather, min(d.x, d.y));
}
`;

// Colour: the HiRISE photo is greyscale. Take the sharpest tile that covers this spot, add close-up grain,
// then tint it (darker ground toward rust, brighter ground toward pale dust).
const TERRAIN_MAP = /* glsl */ `
  float aerDist = length(vViewPosition);
  float aerLum = texture2D(map, vMapUv).g;
  vec2 aerUm = (vTerrainPos.xz - uMidRect.xy) * uMidRect.zw;
  aerLum = mix(aerLum, texture2D(uTileMid, aerUm).g, aerEdge(aerUm, 0.05) * uMidOn);
  vec2 aerUh = (vTerrainPos.xz - uHiRect.xy) * uHiRect.zw;
  aerLum = mix(aerLum, texture2D(uTileHi, aerUh).g, aerEdge(aerUh, 0.1) * uHiOn);
  // Close-up detail at two sizes. The second is turned 37 degrees so the two never line up into a grid.
  vec4 aerD1 = texture2D(uDetail, vTerrainPos.xz / 2.3);
  vec4 aerD2 = texture2D(uDetail, (mat2(0.8, 0.6, -0.6, 0.8) * vTerrainPos.xz) / 7.9);
  float aerMottle = texture2D(uDetail, (mat2(0.6, -0.8, 0.8, 0.6) * vTerrainPos.xz) / 37.0).g - 0.5;
  float aerNear1 = 1.0 - smoothstep(2.0, 26.0, aerDist);
  float aerNear2 = 1.0 - smoothstep(10.0, 70.0, aerDist);
  aerLum *= 1.0 + (aerD1.r - 0.5) * 0.28 * aerNear1 + (aerD2.r - 0.5) * 0.24 * aerNear2
    + aerMottle * 0.16 * (1.0 - smoothstep(40.0, 150.0, aerDist));
  aerLum = clamp(aerLum, 0.0, 1.0);
  diffuseColor.rgb *= aerLum * mix(uTintLow, uTintHigh, smoothstep(0.03, 0.5, aerLum));
`;

// Lighting: the mesh is 20 m per triangle, so its own normals miss small relief. Use the slopes of the real
// elevation instead: the 10 m grid everywhere, and the 2 m tile round the cabin while it is near enough to see.
const TERRAIN_NORMAL = /* glsl */ `
  {
    vec2 aerSlope = texture2D(uSlopeArea, (vTerrainPos.xz - uAreaRect.xy) * uAreaRect.zw).rg;
    vec2 aerUp = (vTerrainPos.xz - uPatchRect.xy) * uPatchRect.zw;
    float aerFine = aerEdge(aerUp, 0.06) * uPatchOn * (1.0 - smoothstep(200.0, 480.0, length(vViewPosition)));
    aerSlope = mix(aerSlope, texture2D(uSlopePatch, aerUp).rg, aerFine);
    // Sand lumps a few centimetres high, from the detail texture's stored slopes (the second set turned back).
    aerSlope += (aerD1.ba - 0.5) * DETAIL_BUMP_1 * aerNear1 + (mat2(0.8, -0.6, 0.6, 0.8) * (aerD2.ba - 0.5)) * DETAIL_BUMP_2 * aerNear2;
    normal = normalize((viewMatrix * vec4(normalize(vec3(-aerSlope.x, 1.0, -aerSlope.y)), 0.0)).xyz);
  }
`;

/**
 * Terrain from the real elevation grid (height × `exag`, zero at `base`), with the HiRISE image draped on it.
 * World axes: x east, z south, y up; centred on the area.
 *
 * What the shader adds, all from the same USGS HiRISE products as the base photo and the elevation grid:
 * - sharper photo tiles (1 m and 25 cm per pixel) where the astronaut walks, blended over the 2 m photo;
 * - lighting from the slopes of the real elevation (10 m everywhere, 2 m near the cabin).
 * Close-up sand grain is the only part that is not data.
 */
export function buildTerrain(pack: DataPack, base: Pt, exag: number, segX: number, segY: number, opts: TerrainOptions): Terrain {
  const { elevation: el, area } = pack;
  const dataBase = opts.dataBase ?? '/data/';
  const h0 = heightAt(el, base);
  const W = area.widthM, H = area.heightM, nx = segX + 1;
  const geo = new THREE.PlaneGeometry(W, H, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const heights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const y = (heightAt(el, { x: pos.getX(i) + W / 2, y: pos.getZ(i) + H / 2 }) - h0) * exag;
    heights[i] = y;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();

  const owned: { dispose: () => void }[] = [geo];
  const keep = <T extends { dispose: () => void }>(x: T): T => { owned.push(x); return x; };

  const tex = keep(new THREE.TextureLoader().load(pack.imageUrl || `${dataBase}jezero_base_2m.jpg`));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = opts.maxAniso;
  const detail = keep(detailTexture());
  detail.anisotropy = Math.min(4, opts.maxAniso);
  const blank = keep(blankTexture());
  const areaSlopes = keep(slopeTexture(el.heightsM, el.cols, el.rows, el.cellM, exag));

  const sky = cssColor('--mars-sky');
  const uniforms = {
    uTileMid: { value: blank as THREE.Texture },
    uTileHi: { value: blank as THREE.Texture },
    uSlopeArea: { value: areaSlopes as THREE.Texture },
    uSlopePatch: { value: areaSlopes as THREE.Texture },
    uDetail: { value: detail as THREE.Texture },
    uMidRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHiRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uAreaRect: { value: new THREE.Vector4(-W / 2, -H / 2, 1 / W, 1 / H) },
    uPatchRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMidOn: { value: 0 },
    uHiOn: { value: 0 },
    uPatchOn: { value: 0 },
    uTintLow: { value: sky.clone().lerp(cssColor('--mars-rust'), 0.4) },
    uTintHigh: { value: sky.clone().lerp(cssColor('--mars-dust'), 0.3) },
  };
  const mat = keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TERRAIN_PARS}`)
      .replace('#include <map_fragment>', TERRAIN_MAP)
      .replace('#include <normal_fragment_maps>', `${TERRAIN_NORMAL}\n#include <normal_fragment_maps>`);
  };
  mat.customProgramCacheKey = () => 'aer-terrain-2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  // ---- Sharper data, loaded after the first frame is up; the view works without any of it ----
  let disposed = false;
  const fades = [
    { u: uniforms.uMidOn, target: 0 },
    { u: uniforms.uHiOn, target: 0 },
    { u: uniforms.uPatchOn, target: 0 },
  ];
  const worldRect = (v: THREE.Vector4, x0M: number, y0M: number, wM: number, hM: number) => v.set(x0M - W / 2, y0M - H / 2, 1 / wM, 1 / hM);
  async function loadTiles() {
    const file = (await (await fetch(`${dataBase}terrain_tiles.json`)).json()) as TerrainTilesFile;
    // Coarsest first: slot 0 is the wide tile, slot 1 the finest one drawn on top of it.
    const tiles = [...file.tiles].sort((a, b) => b.metresPerPixel - a.metresPerPixel).slice(-2);
    const slots = [
      { map: uniforms.uTileMid, rect: uniforms.uMidRect, fade: fades[0] },
      { map: uniforms.uTileHi, rect: uniforms.uHiRect, fade: fades[1] },
    ].slice(2 - tiles.length);
    const loader = new THREE.ImageBitmapLoader(); // decodes off the main thread, so no hitch when a tile arrives
    await Promise.all(tiles.map(async (tile, i) => {
      const bitmap = await loader.loadAsync(`${dataBase}${tile.file}`);
      if (disposed) { bitmap.close(); return; }
      const t = keep(new THREE.Texture(bitmap));
      t.flipY = false; // bitmaps upload top row first: row 0 is the tile's north edge
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, opts.maxAniso);
      t.needsUpdate = true;
      const slot = slots[i];
      worldRect(slot.rect.value, tile.x0M, tile.y0M, tile.widthM, tile.heightM);
      slot.map.value = t;
      slot.fade.target = 1;
    }));
  }
  async function loadFineRelief() {
    const patch = await loadTerrainPatch(dataBase);
    if (disposed) return;
    const m = patch.meta;
    const t = keep(slopeTexture(patch.heightsM, m.cols, m.rows, m.cellM, exag));
    worldRect(uniforms.uPatchRect.value, m.x0M, m.y0M, m.cols * m.cellM, m.rows * m.cellM);
    uniforms.uSlopePatch.value = t;
    fades[2].target = 1;
  }
  if (opts.hiRes) {
    loadTiles().catch(() => { /* optional: the 2 m photo stays */ });
    loadFineRelief().catch(() => { /* optional: the 10 m slopes stay */ });
  }
  const update = (dt: number) => {
    for (const f of fades) if (f.u.value !== f.target) f.u.value = Math.min(f.target, f.u.value + dt / 1.5);
  };

  // Same triangles three.js draws: cell (ix, iy) is split into (a, b, d) and (b, c, d).
  const dx = W / segX, dz = H / segY;
  const surfaceY = (x: number, z: number) => {
    const fx = Math.min(segX - 1e-6, Math.max(0, (x + W / 2) / dx));
    const fz = Math.min(segY - 1e-6, Math.max(0, (z + H / 2) / dz));
    const ix = Math.floor(fx), iy = Math.floor(fz), u = fx - ix, v = fz - iy;
    const a = heights[iy * nx + ix], b = heights[(iy + 1) * nx + ix];
    const c = heights[(iy + 1) * nx + ix + 1], d = heights[iy * nx + ix + 1];
    return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  };

  return { mesh, surfaceY, update, dispose: () => { disposed = true; owned.forEach((o) => o.dispose()); } };
}

/** A soft dark disc under the astronaut's feet, so they read as standing on the ground. */
export function buildContactShadow(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const geo = new THREE.PlaneGeometry(1.2, 1.2);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(c), color: cssColor('--space'), transparent: true, opacity: 0.7, depthWrite: false,
  }));
  mesh.renderOrder = 1;
  return mesh;
}

/** Boot prints left behind while walking; a storm erases them (proposal §6.3: tracks disappear). */
export function buildFootprints(max = 900) {
  const geo = new THREE.PlaneGeometry(0.13, 0.3);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({
    color: cssColor('--space'), transparent: true, opacity: 0.38, depthWrite: false,
  }), max);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  let next = 0, used = 0, oldest = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    add(x: number, y: number, z: number, heading: number) {
      q.setFromAxisAngle(up, -heading);
      m4.compose(p.set(x, y, z), q, one);
      mesh.setMatrixAt(next, m4);
      next = (next + 1) % max;
      if (used < max) used++; else oldest = next;
      mesh.count = used;
      mesh.instanceMatrix.needsUpdate = true;
    },
    /** Remove the oldest `n` prints (the storm wipes the trail from its far end). */
    erase(n: number) {
      for (let i = 0; i < n && used > 0; i++) {
        mesh.setMatrixAt(oldest, zero);
        oldest = (oldest + 1) % max;
        used--;
      }
      if (used === 0) { next = 0; oldest = 0; mesh.count = 0; }
      mesh.instanceMatrix.needsUpdate = true;
    },
    get size() { return used; },
  };
}
