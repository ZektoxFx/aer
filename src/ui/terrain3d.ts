import * as THREE from 'three';
import type { DataPack } from '../data/types';
import { heightAt, type Pt } from '../map';
import { cssColor } from './astronaut3d';

// Scene pieces for the 3D view. Colours come from the :root variables via cssColor().

export interface Terrain {
  mesh: THREE.Mesh;
  /** Height of the drawn surface at a world (x, z), so things stand exactly on what you see. */
  surfaceY: (x: number, z: number) => number;
  dispose: () => void;
}

/** Fine sand grain, used as a bump map so the ground has texture up close. */
function grainTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  let seed = 3;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < size * size; i++) {
    const v = 110 + rand() * 90 + (rand() < 0.02 ? 50 : 0); // sand with the odd pebble
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/**
 * Terrain from the real elevation grid (height × `exag`, zero at `base`), with the HiRISE image draped on it.
 * World axes: x east, z south, y up; centred on the area.
 */
export function buildTerrain(pack: DataPack, base: Pt, exag: number, segX: number, segY: number, maxAniso: number): Terrain {
  const { elevation: el, area } = pack;
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

  const tex = new THREE.TextureLoader().load(pack.imageUrl || '/data/jezero_base_2m.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  const grain = grainTexture();
  grain.repeat.set(W / 3, H / 3); // a tile every 3 m
  const mat = new THREE.MeshStandardMaterial({
    map: tex, color: cssColor('--mars-sky'), roughness: 1, bumpMap: grain, bumpScale: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

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

  return { mesh, surfaceY, dispose: () => { geo.dispose(); mat.dispose(); tex.dispose(); grain.dispose(); } };
}

/** A sky dome that fades from a bright dusty horizon to a deeper zenith; follows the camera. */
export function buildSky(): { mesh: THREE.Mesh; update: (day: number, dust: number) => THREE.Color } {
  const horizonDay = cssColor('--mars-sky'), zenithDay = cssColor('--mars-rust');
  const night = cssColor('--space');
  const uniforms = { horizon: { value: horizonDay.clone() }, zenith: { value: zenithDay.clone() } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: 'varying float vY; void main() { vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 horizon; uniform vec3 zenith; varying float vY; void main() { gl_FragColor = vec4(mix(horizon, zenith, smoothstep(0.0, 0.55, vY)), 1.0); }',
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), mat);
  mesh.renderOrder = -1;
  const out = new THREE.Color();
  const update = (day: number, dust: number) => {
    // Night darkens the sky; dust washes the zenith out toward the horizon colour.
    uniforms.horizon.value.copy(night).lerp(horizonDay, 0.12 + 0.88 * day);
    uniforms.zenith.value.copy(night).lerp(zenithDay.clone().lerp(horizonDay, dust * 0.8), 0.08 + 0.92 * day);
    return out.copy(uniforms.horizon.value);
  };
  return { mesh, update };
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

/** Two dust devils: tall swirling columns of dust drifting across the plain a few hundred metres away. */
export function buildDustDevils() {
  const PER = 420, H = 140, COUNT = 2;
  const group = new THREE.Group();
  const devils = Array.from({ length: COUNT }, (_, d) => {
    const pts = new Float32Array(PER * 3);
    const seeds = Array.from({ length: PER }, (_, i) => ({ a: (i * 2.39996) % (Math.PI * 2), h: (i / PER) * H, s: 0.7 + ((i * 37) % 10) / 10 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.PointsMaterial({ color: cssColor('--mars-dust'), size: 2.6, transparent: true, opacity: 0, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    group.add(points);
    return { points, geo, mat, pts, seeds, angle: d * 1.9 + 0.6, dist: 170 + d * 120 };
  });
  return {
    group,
    update(dt: number, center: THREE.Vector3, active: boolean, surfaceY: (x: number, z: number) => number) {
      for (const dv of devils) {
        dv.mat.opacity += ((active ? 0.75 : 0) - dv.mat.opacity) * Math.min(1, dt * 0.8);
        if (dv.mat.opacity < 0.01) { dv.points.visible = false; continue; }
        dv.points.visible = true;
        dv.angle += dt * 0.03; // drifts slowly around the astronaut
        const cx = center.x + Math.cos(dv.angle) * dv.dist, cz = center.z + Math.sin(dv.angle) * dv.dist;
        const gy = surfaceY(cx, cz);
        dv.points.position.set(cx, gy, cz);
        for (let i = 0; i < PER; i++) {
          const s = dv.seeds[i];
          s.a += dt * (2.2 + s.s) ; // spin
          const r = 0.8 + Math.pow(s.h / H, 1.6) * 26 * s.s; // a narrow funnel that flares at the top
          dv.pts[i * 3] = Math.cos(s.a) * r;
          dv.pts[i * 3 + 1] = s.h;
          dv.pts[i * 3 + 2] = Math.sin(s.a) * r;
        }
        dv.geo.attributes.position.needsUpdate = true;
      }
    },
    dispose() { devils.forEach((d) => { d.geo.dispose(); d.mat.dispose(); }); },
  };
}
