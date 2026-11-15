import * as THREE from 'three';
import { buildLander, cssColor } from './astronaut3d';
import { STORAGE_ROOM_AT } from './ship';

// More built-in 3D models for the game view, from simple shapes (no downloaded assets, no logos):
// the lander base with its storage room, solar array and life-support tanks, which change as the player stores
// things and repairs the ship; NASA's Perseverance rover; rock overhangs to shelter under in a storm; and welding
// sparks for the repair animation. Colours come from the :root variables (src/index.css).

const std = (color: THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true, ...extra });

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** What the base looks like right now, from the ship's state. */
export interface BaseLook {
  /** Items kept in the ship's storage. */
  stored: number;
  /** Scrap materials kept, kg. */
  materialsKg: number;
  repaired: string[];
  built: string[];
  /** The storage room has been built from the blueprint (until then, storage is a locker inside the lander). */
  room: boolean;
}

export interface BaseModel {
  group: THREE.Group;
  update: (look: BaseLook, t: number) => void;
}

/**
 * The crashed lander as a base. `groundAt(dx, dz)` is the ground height at an offset from the lander (metres east,
 * south), relative to the lander's own ground, so the outbuildings sit on the real terrain.
 */
export function buildBase(groundAt: (dx: number, dz: number) => number): BaseModel {
  const metal = cssColor('--metal'), dark = cssColor('--metal-dark'), panel = cssColor('--sat-panel');
  const alarm = cssColor('--alarm'), ok = cssColor('--earth-glow'), warm = cssColor('--mars-dust'), warn = cssColor('--warning');
  const g = new THREE.Group();

  // ---- The lander itself, with hull damage that gets patched ----
  const lander = buildLander();
  lander.position.y = -0.6;
  g.add(lander);
  const gashMat = std(cssColor('--mars-shadow'), { roughness: 1 });
  const patchMat = std(metal.clone().lerp(warm, 0.25), { metalness: 0.5, roughness: 0.4 });
  const gashes: THREE.Mesh[] = [], patches: THREE.Mesh[] = [];
  for (const [a, y, w, h] of [[0.4, 1.4, 0.9, 0.5], [2.2, 2.2, 0.6, 0.7], [3.6, 1.1, 1.1, 0.4]] as const) {
    // On the cone's surface (radius ≈ 2.6 at the bottom, 1.6 at the top).
    const r = 2.6 - ((y - 0.4) / 2.8) * 1.0 + 0.06;
    const gash = part(lander, new THREE.BoxGeometry(w, h, 0.06), gashMat, Math.sin(a) * r, y, Math.cos(a) * r);
    gash.rotation.set(-0.34, a, 0, 'YXZ'); // face out from the cone, tilted up with its side
    gashes.push(gash);
    const patch = part(lander, new THREE.BoxGeometry(w + 0.25, h + 0.25, 0.05), patchMat, Math.sin(a) * (r + 0.03), y, Math.cos(a) * (r + 0.03));
    patch.rotation.copy(gash.rotation);
    patch.visible = false;
    patches.push(patch);
  }
  // Beacon on top: flashing red while the ship is broken, steady blue once sealed and powered.
  const beaconMat = new THREE.MeshBasicMaterial({ color: alarm });
  part(lander, new THREE.SphereGeometry(0.16, 10, 8), beaconMat, 0, 3.65, 0);

  // ---- Storage room: built outside from the blueprint (hidden until then) ----
  const room = new THREE.Group();
  // North-east of the lander, open side facing west toward it (and in view from where the astronaut starts).
  const RX = STORAGE_ROOM_AT.dx, RZ = STORAGE_ROOM_AT.dy; // map metres east/south = world x/z
  room.position.set(RX, groundAt(RX, RZ), RZ);
  room.rotation.y = Math.PI / 2 - 0.25;
  g.add(room);
  const wallMat = std(metal.clone().lerp(dark, 0.15), { side: THREE.DoubleSide });
  const W = 5, D = 3.6, H = 2.6;
  part(room, new THREE.BoxGeometry(W + 0.3, 0.25, D + 0.3), std(dark), 0, 0.05, 0);
  part(room, new THREE.BoxGeometry(W, H, 0.12), wallMat, 0, H / 2, D / 2); // back wall
  part(room, new THREE.BoxGeometry(0.12, H, D), wallMat, W / 2, H / 2, 0); // far end
  part(room, new THREE.BoxGeometry(0.12, H, D), wallMat, -W / 2, H / 2, 0); // near end
  part(room, new THREE.BoxGeometry(W + 0.4, 0.14, D + 0.4), wallMat, 0, H + 0.05, 0); // roof
  // Roll-up door, half open, and ribs along the walls.
  part(room, new THREE.BoxGeometry(W - 0.2, 0.9, 0.08), std(dark), 0, H - 0.45, -D / 2);
  for (let i = -2; i <= 2; i++) part(room, new THREE.BoxGeometry(0.08, H, 0.08), std(dark), i * 1.2, H / 2, D / 2 - 0.1);
  // Shelves along the back wall.
  const shelfMat = std(dark, { metalness: 0.4 });
  for (const y of [0.15, 1.0, 1.8]) part(room, new THREE.BoxGeometry(W - 0.6, 0.06, 0.8), shelfMat, -0.2, y + 0.12, D / 2 - 0.55);
  for (const x of [-2.2, 1.8]) part(room, new THREE.BoxGeometry(0.06, 2.1, 0.8), shelfMat, x, 1.05, D / 2 - 0.55);
  // Crates on the shelves: one per stored item (up to 15).
  const CRATES = 15;
  const crateColors = [metal, warn, ok, warm, cssColor('--sat-panel').clone().lerp(metal, 0.4)];
  const crates: THREE.Mesh[] = [];
  for (let i = 0; i < CRATES; i++) {
    const shelf = Math.floor(i / 5), slot = i % 5;
    const c = part(room, new THREE.BoxGeometry(0.62, 0.48, 0.55), std(crateColors[i % crateColors.length].clone().lerp(dark, 0.2)),
      -2.0 + slot * 0.78, 0.15 + shelf * 0.83 + 0.42, D / 2 - 0.55);
    c.rotation.y = ((i * 37) % 9 - 4) * 0.03;
    c.visible = false;
    crates.push(c);
  }
  // Scrap materials stacked on the floor near the door: one bar or plate per ~2 kg (up to 14).
  const BARS = 14;
  const bars: THREE.Mesh[] = [];
  for (let i = 0; i < BARS; i++) {
    const plate = i % 3 === 0;
    const b = part(room, plate ? new THREE.BoxGeometry(1.0, 0.05, 0.7) : new THREE.BoxGeometry(1.3, 0.09, 0.09), std(i % 2 ? metal : dark, { metalness: 0.5 }),
      -1.6 + (i % 2) * 0.15, 0.22 + Math.floor(i / 2) * 0.07, -0.6 + (i % 4) * 0.12);
    b.rotation.y = (i % 5) * 0.2;
    b.visible = false;
    bars.push(b);
  }
  // Workbench at the far end, with the comms link once it is built.
  part(room, new THREE.BoxGeometry(0.9, 0.08, 1.8), std(dark), W / 2 - 0.65, 0.95, -0.3);
  for (const [x, z] of [[-0.35, -0.8], [0.35, -0.8], [-0.35, 0.8], [0.35, 0.8]]) part(room, new THREE.BoxGeometry(0.06, 0.9, 0.06), std(dark), W / 2 - 0.65 + x, 0.5, -0.3 + z);
  const linkBox = part(room, new THREE.BoxGeometry(0.4, 0.18, 0.3), std(metal), W / 2 - 0.65, 1.08, -0.5);
  const linkLed = part(room, new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: ok }), W / 2 - 0.65, 1.2, -0.62);
  linkBox.visible = false; linkLed.visible = false;
  // Lights: a dim red emergency lamp until power is back, then a warm work light.
  const roomLight = new THREE.PointLight(alarm, 3, 9, 1.5);
  roomLight.position.set(0, H - 0.3, 0.2);
  room.add(roomLight);
  const lampMat = new THREE.MeshBasicMaterial({ color: alarm });
  part(room, new THREE.BoxGeometry(0.5, 0.06, 0.2), lampMat, 0, H - 0.08, 0.2);

  // ---- Solar array: tipped over in the dirt until power is restored, then standing and facing the sky ----
  const solar = new THREE.Group();
  const SX = -7, SZ = 4;
  solar.position.set(SX, groundAt(SX, SZ), SZ);
  g.add(solar);
  const mast = part(solar, new THREE.CylinderGeometry(0.07, 0.07, 1.6, 8), std(dark), 0, 0.8, 0);
  const wing = new THREE.Group();
  solar.add(wing);
  const cellMat = std(panel, { metalness: 0.6, roughness: 0.3 });
  for (let i = -1; i <= 1; i++) {
    part(wing, new THREE.BoxGeometry(1.25, 0.05, 2.0), cellMat, i * 1.3, 0, 0);
    part(wing, new THREE.BoxGeometry(1.29, 0.06, 0.05), std(metal), i * 1.3, 0.01, 1.0);
  }

  // ---- Life support: two tanks and a status lamp ----
  const tanks = new THREE.Group();
  const TX = 1.5, TZ = 5.2;
  tanks.position.set(TX, groundAt(TX, TZ), TZ);
  g.add(tanks);
  for (const x of [-0.45, 0.45]) {
    part(tanks, new THREE.CylinderGeometry(0.38, 0.38, 1.5, 14), std(metal, { metalness: 0.4, roughness: 0.35 }), x, 0.85, 0);
    part(tanks, new THREE.SphereGeometry(0.38, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(metal, { metalness: 0.4, roughness: 0.35 }), x, 1.6, 0);
  }
  part(tanks, new THREE.BoxGeometry(1.5, 0.1, 0.9), std(dark), 0, 0.05, 0);
  const lifeLamp = new THREE.MeshBasicMaterial({ color: alarm });
  part(tanks, new THREE.SphereGeometry(0.08, 10, 8), lifeLamp, 0, 1.3, -0.4);

  const update = (look: BaseLook, t: number) => {
    const hull = look.repaired.includes('hull'), power = look.repaired.includes('power'), life = look.repaired.includes('life');
    gashes.forEach((m) => { m.visible = !hull; });
    patches.forEach((m) => { m.visible = hull; });
    const blink = Math.sin(t * 5) > 0;
    beaconMat.color.copy(hull && power ? ok : alarm).multiplyScalar(hull && power ? 1 : blink ? 1 : 0.15);
    room.visible = look.room;
    crates.forEach((c, i) => { c.visible = i < look.stored; });
    const nBars = Math.min(BARS, Math.ceil(look.materialsKg / 2));
    bars.forEach((b, i) => { b.visible = i < nBars; });
    const linkHere = look.built.includes('comms_link');
    linkBox.visible = linkHere; linkLed.visible = linkHere && blink;
    roomLight.color.copy(power ? warm : alarm);
    roomLight.intensity = power ? 9 : 2.2 + (blink ? 0.8 : 0);
    lampMat.color.copy(power ? warm : alarm);
    // Solar array: fallen over, or up on its mast.
    mast.visible = power;
    if (power) { wing.position.set(0, 1.65, 0); wing.rotation.set(-0.35, 0, 0); }
    else { wing.position.set(0.3, 0.25, 0.2); wing.rotation.set(0.25, 0.4, 0.5); }
    lifeLamp.color.copy(life ? ok : warn).multiplyScalar(life || blink ? 1 : 0.3);
  };
  return { group: g, update };
}

export interface RoverModel {
  group: THREE.Group;
  /** `linked`: the comms link is plugged in; `called`: the distress call is away. `distM` fades the beam up close. */
  update: (t: number, linked: boolean, called: boolean, distM: number) => void;
}

/** NASA's Perseverance rover, about 3 m long: six wheels on rocker-bogies, mast, arm, antennas and its MMRTG. */
export function buildRover(): RoverModel {
  const white = cssColor('--metal'), dark = cssColor('--metal-dark'), gold = cssColor('--mars-dust').lerp(cssColor('--warning'), 0.5);
  const g = new THREE.Group();
  // Chassis (the "warm electronics box"), top deck and the equipment on it. Front is −z.
  part(g, new THREE.BoxGeometry(2.0, 0.55, 2.7), std(white), 0, 1.05, 0);
  part(g, new THREE.BoxGeometry(2.1, 0.08, 2.8), std(dark), 0, 1.36, 0);
  part(g, new THREE.BoxGeometry(0.8, 0.25, 0.9), std(gold, { metalness: 0.6, roughness: 0.3 }), -0.4, 1.52, 0.4);
  // MMRTG at the back: a finned cylinder angled up.
  const rtg = part(g, new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), std(dark, { metalness: 0.5 }), 0, 1.25, 1.65);
  rtg.rotation.x = 1.1;
  for (let i = 0; i < 8; i++) {
    const fin = part(g, new THREE.BoxGeometry(0.03, 0.75, 0.14), std(dark), 0, 1.25, 1.65);
    fin.rotation.set(1.1, 0, 0);
    fin.rotateY((i / 8) * Math.PI * 2);
    fin.translateZ(0.3);
  }
  // Six wheels on rocker-bogie arms.
  const wheelMat = std(dark.clone().lerp(white, 0.25), { metalness: 0.5 });
  for (const side of [-1, 1]) {
    for (const z of [-1.1, 0, 1.0]) {
      const w = part(g, new THREE.CylinderGeometry(0.27, 0.27, 0.26, 16), wheelMat, side * 1.25, 0.27, z);
      w.rotation.z = Math.PI / 2;
      part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.28, 8), std(dark), side * 1.25, 0.27, z).rotation.z = Math.PI / 2;
    }
    const rocker = part(g, new THREE.BoxGeometry(0.08, 0.08, 1.4), std(white), side * 1.12, 0.75, -0.5);
    rocker.rotation.x = 0.55;
    const bogie = part(g, new THREE.BoxGeometry(0.08, 0.08, 1.2), std(white), side * 1.12, 0.6, 0.5);
    bogie.rotation.x = -0.3;
    part(g, new THREE.CylinderGeometry(0.1, 0.1, 0.2, 10), std(dark), side * 1.05, 0.98, -0.05).rotation.z = Math.PI / 2;
  }
  // Remote-sensing mast with the camera head (two "eyes" and the laser window).
  part(g, new THREE.CylinderGeometry(0.06, 0.07, 1.25, 8), std(white), 0.55, 2.0, -1.05);
  const head = new THREE.Group();
  head.position.set(0.55, 2.7, -1.05);
  g.add(head);
  part(head, new THREE.BoxGeometry(0.62, 0.3, 0.32), std(white));
  for (const x of [-0.17, 0.17]) part(head, new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), std(dark, { metalness: 0.9, roughness: 0.1 }), x, -0.02, -0.17).rotation.x = Math.PI / 2;
  part(head, new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), std(dark, { metalness: 0.9, roughness: 0.1 }), 0, 0.02, -0.17).rotation.x = Math.PI / 2;
  // High-gain antenna (a hexagonal dish) and the UHF antenna.
  const hga = part(g, new THREE.CylinderGeometry(0.33, 0.33, 0.05, 6), std(white), -0.6, 1.75, 0.9);
  hga.rotation.set(0.5, 0, 0.3);
  part(g, new THREE.CylinderGeometry(0.04, 0.04, 0.4, 8), std(dark), -0.6, 1.55, 0.9);
  part(g, new THREE.CylinderGeometry(0.07, 0.05, 0.35, 10), std(white), 0.7, 1.55, 0.6);
  // Robotic arm folded at the front, with the turret.
  const arm1 = part(g, new THREE.BoxGeometry(0.1, 0.1, 1.1), std(white), -0.3, 1.0, -1.65);
  arm1.rotation.y = Math.PI / 2;
  const turret = part(g, new THREE.BoxGeometry(0.35, 0.35, 0.35), std(dark), 0.35, 0.85, -1.65);
  turret.rotation.y = 0.4;
  // The comms link the astronaut plugs in: a box with a blinking light, and a beam above the rover to find it by.
  const link = part(g, new THREE.BoxGeometry(0.3, 0.16, 0.24), std(white), 0.75, 1.5, 0.1);
  const ledMat = new THREE.MeshBasicMaterial({ color: cssColor('--earth-glow') });
  const led = part(g, new THREE.SphereGeometry(0.05, 8, 6), ledMat, 0.75, 1.62, 0.1);
  link.visible = false; led.visible = false;
  const beamMat = new THREE.MeshBasicMaterial({
    color: cssColor('--fg'), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.4, 40, 10, 1, true), beamMat);
  beam.position.y = 23; // starts above the mast
  g.add(beam);
  const beamIdle = cssColor('--fg'), beamCalled = cssColor('--earth-glow');

  const update = (t: number, linked: boolean, called: boolean, distM: number) => {
    link.visible = linked; led.visible = linked && Math.sin(t * (called ? 12 : 4)) > 0;
    head.rotation.y = Math.sin(t * 0.3) * 0.5; // the cameras look about
    beamMat.color.copy(called ? beamCalled : beamIdle);
    beamMat.opacity = Math.min(0.3, Math.max(0, (distM - 12) / 60)) * (0.75 + 0.25 * Math.sin(t * 2.4)) + (called ? 0.2 : 0);
  };
  return { group: g, update };
}

/** A rock overhang: a big slab leaning on two boulders, with room underneath to sit out a storm. */
export function buildCoverRock(size: number, seed: number): THREE.Group {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const rock = cssColor('--mars-rust').lerp(cssColor('--mars-sky'), 0.35);
  const mat = std(rock, { roughness: 1 });
  const lumpy = (detail: number) => {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!seen.has(k)) seen.set(k, 0.78 + rand() * 0.4);
      const f = seen.get(k)!;
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const g = new THREE.Group();
  const a = part(g, lumpy(1), mat, -size * 0.55, size * 0.3, size * 0.15);
  a.scale.set(size * 0.45, size * 0.5, size * 0.55);
  const b = part(g, lumpy(1), mat, size * 0.6, size * 0.25, size * 0.25);
  b.scale.set(size * 0.4, size * 0.42, size * 0.5);
  const back = part(g, lumpy(1), mat, 0, size * 0.25, size * 0.55);
  back.scale.set(size * 0.7, size * 0.38, size * 0.25);
  const slab = part(g, lumpy(1), mat, 0, size * 0.78, size * 0.1);
  slab.scale.set(size * 1.15, size * 0.2, size * 0.8);
  slab.rotation.set(-0.12, 0, 0.05);
  return g;
}

/** Welding sparks: a fountain of hot points while `on`, falling with Mars gravity. */
export function buildSparks(count = 90) {
  const pos = new Float32Array(count * 3), vel = new Float32Array(count * 3), age = new Float32Array(count);
  for (let i = 0; i < count; i++) age[i] = 99;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: cssColor('--warning'), size: 0.07, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  const light = new THREE.PointLight(cssColor('--earth-glow'), 0, 8, 1.6);
  const group = new THREE.Group();
  group.add(points, light);
  let n = 0;
  const update = (dt: number, on: boolean, at: THREE.Vector3, t: number) => {
    light.position.copy(at);
    light.intensity = on ? 6 + Math.random() * 10 * (Math.sin(t * 31) > 0 ? 1 : 0.2) : 0;
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      if (on && age[i] > 0.9 && (n++ % 3 === 0)) {
        age[i] = 0;
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
        vel[i * 3] = (Math.random() - 0.5) * 3; vel[i * 3 + 1] = 0.5 + Math.random() * 2.5; vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      }
      if (age[i] > 0.9) { pos[i * 3 + 1] = -9999; continue; }
      vel[i * 3 + 1] -= 3.71 * dt; // Mars gravity
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { group, update };
}

/**
 * The Sun's disc and the night sky. The Sun from Mars looks about two thirds the size it does from Earth; the glow
 * around it is the dusty sky scattering its light. Stars come out at night when the air is clear, with Earth as a
 * bright blue-white point (game placement, not a real ephemeris).
 */
export function buildCelestial() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const rg = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.12, 'rgba(255,255,255,1)');
  rg.addColorStop(0.18, 'rgba(255,255,255,0.45)'); rg.addColorStop(0.5, 'rgba(255,255,255,0.08)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);

  const N = 1600;
  const pos = new Float32Array(N * 3);
  let s = 77;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < N; i++) {
    const u = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(a) * 6000; pos[i * 3 + 1] = Math.abs(u) * 6000; pos[i * 3 + 2] = r * Math.sin(a) * 6000;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: cssColor('--fg'), size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  const earthMat = new THREE.SpriteMaterial({ map: tex, color: cssColor('--earth-glow'), transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const earth = new THREE.Sprite(earthMat);
  earth.scale.setScalar(160);
  const earthDir = new THREE.Vector3(-0.5, 0.45, -0.75).normalize();

  const group = new THREE.Group();
  group.add(stars, earth);
  /** `day` 0..1; `dust` 0..1. The Sun itself is drawn by the sky shader (sky3d.ts). */
  const update = (camPos: THREE.Vector3, day: number, dust: number) => {
    group.position.copy(camPos);
    // Stars only once the Sun is well down (day < 0.35 is about 1° below the horizon), and not through dust.
    const night = THREE.MathUtils.clamp((0.35 - day) / 0.35, 0, 1) * (1 - dust);
    starMat.opacity = 0.9 * night;
    earth.position.copy(earthDir).multiplyScalar(5000);
    earthMat.opacity = night;
  };
  const dispose = () => { tex.dispose(); starGeo.dispose(); starMat.dispose(); earthMat.dispose(); };
  return { group, update, dispose };
}
