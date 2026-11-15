// LOCAL DRAFT (Map/Aiman, not pushed): the map, built into UI's 3D world (World3D), so the world matches the map.
// - Items stand where the map has them (supplies, rocket pieces, shelter, rover, NASA sites) and appear the way the map
//   shows them: hidden ones only once seen. Supplies and pages get a light beam so they can be found from afar.
// - Danger zones are on the ground where the map draws them: ripples of soft sand, extra boulders in boulder fields.
// - The planned route is painted on the ground (coloured by status like the 2D map), with a beam at each waypoint.
// - The safe-return line is a glowing wall at the same place as the map's green line (amber, dashed = one-way).
// - Set dressing: thousands of pebbles, boulder clusters, layered delta rock, and the crash site round the lander
//   (skid scorch, debris, heat shield, the parachute, smoke). Low-poly, flat-shaded, in UI's style.
// - Supplies look like the gear they are (O2 bottle, LiOH canister, water pouch, battery pack, repair case), each with
//   a ground ring that brightens when it is within reach. Taking one lifts it into the astronaut's hands; dropping one
//   lets it fall under Mars gravity (3.71 m/s2), bounce and kick up dust.
// - Three Forks: Perseverance's 10 sample tubes lie on the ground at the depot, glinting (pois.json).
// - Dust storm: a billowing wall of dust rolls in from the horizon as the storm builds and closes round the
//   astronaut. It reads the storm from UI's scene fog, so the 3D view needs no new input.
// Positions are map metres; the world is centred, so world x = map x − W/2 and world z = map y − H/2.
import * as THREE from 'three';
import { contourSegments } from './contours';
import type { Pt } from './geo';
import type { ItemKind, MapItem } from './layout';
import { zoneAt } from './layout';
import type { MapWorldState } from './world';
import { itemsInView } from './world';
import { STORM_TAU_FROM } from '../ui/cover';

/** Mars surface gravity, m/s2 (same as the EDL physics). */
const MARS_G = 3.71;
const SUPPLY: ReadonlySet<ItemKind> = new Set<ItemKind>(['o2', 'lioh', 'water', 'battery', 'repair', 'scrap', 'manual']);

/** Same route colours as the 2D map (MapView), so the ground line reads the same as the minimap. */
const STATUS = { nominal: '#4dff88', warning: '#ffb000', critical: '#ff4d4d' } as const;

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#808080');
}

export interface MapWorld3D {
  group: THREE.Group;
  /** Call every frame. `s` is the map's current state (null until the map has loaded). */
  update: (s: MapWorldState | null, me: Pt, nowMs: number, dt: number) => void;
  dispose: () => void;
}

interface Opts { W2: number; H2: number; surfaceY: (x: number, z: number) => number; base: Pt }

/** A rock: an icosahedron with its corners pushed in and out, so no two look alike. */
function rockGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  let s = seed;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, 0.72 + r() * 0.5);
    const f = seen.get(k)!;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.8, pos.getZ(i) * f);
  }
  g.computeVertexNormals();
  return g;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.4, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(0, 0, 40, 8);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(40, 0, 24, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export function buildMapWorld(o: Opts): MapWorld3D {
  const { W2, H2, surfaceY, base } = o;
  const group = new THREE.Group();
  const wx = (p: Pt) => p.x - W2, wz = (p: Pt) => p.y - H2;
  const ground = (p: Pt) => surfaceY(wx(p), wz(p));
  let seed = 4242;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3(), eu = new THREE.Euler();
  const col = new THREE.Color();
  const rust = css('--mars-rust'), sand = css('--mars-sand'), sky = css('--mars-sky'), shadow = css('--mars-shadow'), dust = css('--mars-dust');
  const metal = css('--metal'), metalDark = css('--metal-dark'), alarm = css('--alarm'), warn = css('--warning'), glowBlue = css('--earth-glow');
  const rockTint = () => col.copy(rust).lerp(sky, 0.25 + rand() * 0.45).lerp(shadow, rand() * 0.25);
  /** Ground tilt at a point, for things that lie flat on it. */
  const tiltAt = (p: Pt) => {
    const e = 1.5, x = wx(p), z = wz(p);
    const n = new THREE.Vector3(surfaceY(x - e, z) - surfaceY(x + e, z), 2 * e, surfaceY(x, z - e) - surfaceY(x, z + e)).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  };

  // ---------- Set dressing (always there) ----------
  const rockMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });

  // Pebbles and cobbles: dense near the cabin, thinning out.
  // Performance: pebbles are a few cm across and most are far off, so an 8-triangle octahedron reads the same as a
  // 20-triangle icosahedron (9000 of them were 180k triangles a frame).
  const PEBBLES = 7000;
  const pebbles = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), rockMat, PEBBLES);
  pebbles.receiveShadow = true;
  for (let i = 0; i < PEBBLES; i++) {
    const r = 4 + Math.pow(rand(), 1.7) * 520, a = rand() * Math.PI * 2;
    const p = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
    const s = 0.03 + Math.pow(rand(), 3) * 0.16;
    q.setFromEuler(eu.set(rand() * 3, rand() * 3, rand() * 3));
    m4.compose(v3.set(wx(p), ground(p) + s * 0.2, wz(p)), q, sc.set(s * (0.8 + rand() * 0.6), s * (0.5 + rand() * 0.4), s * (0.8 + rand() * 0.6)));
    pebbles.setMatrixAt(i, m4);
    pebbles.setColorAt(i, rockTint());
  }
  group.add(pebbles);

  // Boulders: three shapes, mostly in clusters (rock falls off crater rims), half buried.
  const shapes = [rockGeometry(11), rockGeometry(29), rockGeometry(57)];
  const BOULDERS_EACH = 110;
  const boulderMeshes = shapes.map((g) => { const m = new THREE.InstancedMesh(g, rockMat, BOULDERS_EACH); m.castShadow = true; m.receiveShadow = true; return m; });
  const clusters = Array.from({ length: 22 }, () => { const r = 25 + rand() * 900, a = rand() * Math.PI * 2; return { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r }; });
  boulderMeshes.forEach((mesh) => {
    for (let i = 0; i < BOULDERS_EACH; i++) {
      const c = clusters[Math.floor(rand() * clusters.length)];
      const spread = 6 + rand() * 26, a = rand() * Math.PI * 2;
      const p = rand() < 0.75 ? { x: c.x + Math.cos(a) * spread, y: c.y + Math.sin(a) * spread } : { x: base.x + (rand() - 0.5) * 1600, y: base.y + (rand() - 0.5) * 1600 };
      if (Math.hypot(p.x - base.x, p.y - base.y) < 9) p.x += 12;
      const s = 0.4 + Math.pow(rand(), 2.5) * 2.6;
      q.setFromEuler(eu.set(rand() * 0.6, rand() * 6.3, rand() * 0.6));
      m4.compose(v3.set(wx(p), ground(p) + s * 0.25, wz(p)), q, sc.set(s * (0.9 + rand() * 0.5), s * (0.6 + rand() * 0.4), s * (0.9 + rand() * 0.5)));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, rockTint());
    }
    group.add(mesh);
  });

  // Layered rock: the Jezero delta is stacked sediment, so low ledges show stripes of lighter and darker beds.
  const LEDGES = 22, SLABS = 5;
  const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), LEDGES * SLABS);
  slabs.castShadow = true; slabs.receiveShadow = true;
  for (let l = 0; l < LEDGES; l++) {
    const r = 120 + rand() * 1100, a = rand() * Math.PI * 2;
    const p = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
    const yaw = rand() * Math.PI, len = 6 + rand() * 14, deep = 2 + rand() * 4, y0 = ground(p) - 0.6;
    for (let k = 0; k < SLABS; k++) {
      const th = 0.35 + rand() * 0.45, shrink = 1 - k * 0.14;
      q.setFromEuler(eu.set((rand() - 0.5) * 0.08, yaw + (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.08));
      m4.compose(v3.set(wx(p) + (rand() - 0.5) * 0.8, y0 + k * th * 0.95, wz(p) + (rand() - 0.5) * 0.8), q, sc.set(len * shrink, th, deep * shrink));
      slabs.setMatrixAt(l * SLABS + k, m4);
      slabs.setColorAt(l * SLABS + k, col.copy(k % 2 ? sand : sky).lerp(dust, 0.15 + rand() * 0.15));
    }
  }
  group.add(slabs);

  // ---------- The crash site round the lander ----------
  const skidYaw = 0.6; // direction the lander slid in from
  const skid = (d: number, side = 0): Pt => ({ x: base.x + Math.cos(skidYaw) * d - Math.sin(skidYaw) * side, y: base.y + Math.sin(skidYaw) * d + Math.cos(skidYaw) * side });
  // Scorched, churned ground along the skid.
  const SCORCH = 90;
  const scorch = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: shadow.clone().lerp(rust, 0.35), transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    SCORCH,
  );
  for (let i = 0; i < SCORCH; i++) {
    const p = skid(4 + (i / SCORCH) * 48, (rand() - 0.5) * 3);
    const s = 0.5 + rand() * 1.3 * (1 - (i / SCORCH) * 0.6);
    m4.compose(v3.set(wx(p), ground(p) + 0.04, wz(p)), tiltAt(p).multiply(q.setFromEuler(eu.set(0, rand() * 6, 0))), sc.set(s * 1.6, 1, s));
    scorch.setMatrixAt(i, m4);
  }
  group.add(scorch);
  // Debris: torn panels and struts thrown forward in a fan.
  const DEBRIS = 80;
  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.35, flatShading: true }), DEBRIS);
  debris.castShadow = true;
  for (let i = 0; i < DEBRIS; i++) {
    const d = 3 + Math.pow(rand(), 1.5) * 60, side = (rand() - 0.5) * (6 + d * 0.6);
    const p = skid(-d, side);
    const plate = rand() < 0.7;
    const s = plate ? sc.set(0.3 + rand() * 1.4, 0.03, 0.2 + rand() * 0.9) : sc.set(0.06, 0.06, 0.6 + rand() * 1.6);
    q.setFromEuler(eu.set((rand() - 0.5) * 1.2, rand() * 6.3, (rand() - 0.5) * 1.2));
    m4.compose(v3.set(wx(p), ground(p) + 0.08, wz(p)), q, s);
    debris.setMatrixAt(i, m4);
    debris.setColorAt(i, col.copy(rand() < 0.6 ? metal : metalDark).lerp(shadow, rand() * 0.35));
  }
  group.add(debris);
  // Heat shield: a shallow dish lying tilted, scorched dark.
  const shieldP = skid(-26, 7);
  const shield = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0, 0.55), new THREE.Vector2(1.2, 0.35), new THREE.Vector2(2.1, 0), new THREE.Vector2(2.2, 0.08)], 18),
    new THREE.MeshStandardMaterial({ color: metalDark.clone().lerp(shadow, 0.5), roughness: 0.9, side: THREE.DoubleSide, flatShading: true }),
  );
  shield.position.set(wx(shieldP), ground(shieldP) + 0.3, wz(shieldP));
  shield.rotation.set(0.5, 1.1, 0.2);
  shield.castShadow = true;
  group.add(shield);
  // The parachute: draped over the ground in orange and white gores, lines trailing back to the backshell.
  const chuteP = skid(-44, -10);
  const chuteGeo = new THREE.SphereGeometry(4.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  {
    const pos = chuteGeo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x), fold = 1 + Math.sin(a * 8) * 0.08;
      pos.setXYZ(i, x * fold * (1.2 + Math.sin(a) * 0.15), y * 0.16 + Math.sin(a * 5 + x) * 0.12, z * fold);
      const gore = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2;
      (gore ? alarm : dust).toArray(colors, i * 3);
    }
    chuteGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    chuteGeo.computeVertexNormals();
  }
  const chute = new THREE.Mesh(chuteGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
  chute.position.set(wx(chuteP), ground(chuteP) + 0.05, wz(chuteP));
  chute.quaternion.copy(tiltAt(chuteP));
  chute.receiveShadow = true;
  group.add(chute);
  const backshellP = skid(-34, -4);
  const backshell = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.4, 14, 1, true), new THREE.MeshStandardMaterial({ color: metal, roughness: 0.6, side: THREE.DoubleSide, flatShading: true }));
  backshell.position.set(wx(backshellP), ground(backshellP) + 0.5, wz(backshellP));
  backshell.rotation.set(1.9, 0.4, 0);
  backshell.castShadow = true;
  group.add(backshell);
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(new THREE.Vector3(backshell.position.x, backshell.position.y + 0.3, backshell.position.z));
      const e = { x: chuteP.x + Math.cos(a) * 3.5, y: chuteP.y + Math.sin(a) * 3.5 };
      pts.push(new THREE.Vector3(wx(e), ground(e) + 0.08, wz(e)));
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: dust, transparent: true, opacity: 0.6 })));
  }
  // Smoke still rising from the wreck.
  const glow = glowTexture();
  const SMOKE = 60;
  const smokePos = new Float32Array(SMOKE * 3), smokeAge = new Float32Array(SMOKE);
  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: glow, color: metalDark, size: 3.2, transparent: true, opacity: 0.35, depthWrite: false }));
  smoke.frustumCulled = false;
  const bx = wx(base), bz = wz(base), by = ground(base);
  for (let i = 0; i < SMOKE; i++) smokeAge[i] = rand() * 8;
  group.add(smoke);

  // ---------- Map content (built when the map's data arrives or changes) ----------
  const zoneGroup = new THREE.Group(), itemGroup = new THREE.Group(), routeGroup = new THREE.Group(), wallGroup = new THREE.Group();
  group.add(zoneGroup, itemGroup, routeGroup, wallGroup);
  const stripes = stripeTexture();
  const clear = (g: THREE.Group) => {
    g.traverse((ch) => {
      const m = ch as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
    });
    g.clear();
  };

  // Danger zones: sample the ground round the cabin and dress each zone cell the way it is on the map.
  let zonesRef: MapWorldState['zones'] | null = null;
  function buildZones(s: MapWorldState) {
    clear(zoneGroup);
    const MAX_RIP = 5000, MAX_ROCK = 2200, STEP = 7, RADIUS = 1100;
    // Performance: low-poly shapes for the thousands of zone ripples and rocks (they were ~600k triangles a frame,
    // the rocks twice over for shadows); flat-shaded and squashed, they look the same.
    const ripples = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 3), new THREE.MeshStandardMaterial({ color: sand.clone().lerp(dust, 0.35), roughness: 1, flatShading: true }), MAX_RIP);
    ripples.receiveShadow = true;
    const zrocks = new THREE.InstancedMesh(rockGeometry(29, 0), rockMat, MAX_ROCK);
    zrocks.castShadow = true; zrocks.receiveShadow = true;
    let nr = 0, nk = 0;
    for (let y = base.y - RADIUS; y <= base.y + RADIUS && (nr < MAX_RIP || nk < MAX_ROCK); y += STEP) {
      for (let x = base.x - RADIUS; x <= base.x + RADIUS; x += STEP) {
        const p = { x: x + (rand() - 0.5) * STEP, y: y + (rand() - 0.5) * STEP };
        const z = zoneAt(s.zones, p);
        if (!z) continue;
        if (z.kind === 'sand' && nr < MAX_RIP && rand() < 0.8) {
          // Wind ripples: long, low and all lying the same way.
          q.setFromEuler(eu.set(0, 0.45 + (rand() - 0.5) * 0.2, 0));
          const L = 2 + rand() * 3;
          m4.compose(v3.set(wx(p), ground(p) + 0.02, wz(p)), q, sc.set(L, 0.12 + rand() * 0.12, 0.5 + rand() * 0.3));
          ripples.setMatrixAt(nr++, m4);
        } else if (z.kind === 'rocks' && nk < MAX_ROCK && rand() < 0.55) {
          const sz = 0.3 + Math.pow(rand(), 2) * 1.3;
          q.setFromEuler(eu.set(rand() * 0.6, rand() * 6.3, rand() * 0.6));
          m4.compose(v3.set(wx(p), ground(p) + sz * 0.25, wz(p)), q, sc.set(sz, sz * 0.7, sz));
          zrocks.setMatrixAt(nk, m4);
          zrocks.setColorAt(nk++, rockTint());
        }
      }
    }
    ripples.count = nr; zrocks.count = nk;
    zoneGroup.add(ripples, zrocks);
  }

  // Items: a small model each, built once per item list.
  let itemsRef: MapItem[] | null = null;
  const itemObjs = new Map<string, { obj: THREE.Group; beam?: THREE.Mesh; ring?: THREE.Mesh; glints?: THREE.Sprite[]; it: MapItem }>();
  // Pick-up and drop animations play in their own group (the item list is rebuilt when the pack changes).
  const fxGroup = new THREE.Group(); group.add(fxGroup);
  interface Fx { obj: THREE.Object3D; kind: 'take' | 'drop'; t: number; from: THREE.Vector3; h: number; v: number; landed: boolean }
  const fx: Fx[] = [];
  const puffs: { s: THREE.Sprite; t: number }[] = [];
  let lastMe: Pt = base;
  const STRIPE: Partial<Record<ItemKind, THREE.Color>> = { o2: glowBlue, lioh: css('--sat-panel'), water: glowBlue, battery: warn, repair: alarm };
  function itemModel(it: MapItem): { obj: THREE.Group; beam?: THREE.Mesh; ring?: THREE.Mesh; glints?: THREE.Sprite[] } {
    const g = new THREE.Group();
    const std = (c: THREE.Color, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, ...extra });
    let beamColor: THREE.Color | null = null;
    switch (it.kind) {
      case 'o2': {
        // A breathing-oxygen bottle: domed cylinder, neck, valve and hand wheel, blue band. Lying where it fell.
        const b = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.62, 16), std(metal, { metalness: 0.5, roughness: 0.35 }));
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), body.material);
        dome.position.y = 0.31;
        const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.12, 16), std(glowBlue, { emissive: glowBlue, emissiveIntensity: 0.45 }));
        band.position.y = 0.1;
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.1, 10), std(metalDark, { metalness: 0.7 }));
        neck.position.y = 0.5;
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), std(alarm));
        wheel.rotation.x = Math.PI / 2; wheel.position.y = 0.56;
        b.add(body, dome, band, neck, wheel);
        b.rotation.set(0, 0.4, Math.PI / 2 - 0.08); b.position.y = 0.16;
        g.add(b);
        beamColor = glowBlue;
        break;
      }
      case 'lioh': {
        // A LiOH scrubber canister: squat, ribbed, with a label band and end caps.
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 18), std(metalDark, { metalness: 0.4 }));
        body.position.y = 0.19;
        for (const y of [0.06, 0.32]) { const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.03, 18), std(metal)); rib.position.y = y; g.add(rib); }
        const label = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.12, 18), std(STRIPE.lioh ?? warn, { emissive: STRIPE.lioh ?? warn, emissiveIntensity: 0.3 }));
        label.position.y = 0.19;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), std(dust));
        cap.position.y = 0.4;
        g.add(body, label, cap);
        g.rotation.z = 0.12;
        beamColor = STRIPE.lioh ?? warn;
        break;
      }
      case 'water': {
        // A soft water bag with a drinking valve, half full and slumped.
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), std(glowBlue.clone().lerp(metal, 0.5), { transparent: true, opacity: 0.85, roughness: 0.25, metalness: 0.1 }));
        bag.scale.set(1.2, 0.32, 0.8); bag.position.y = 0.09;
        const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8), std(metalDark));
        valve.rotation.z = Math.PI / 2; valve.position.set(0.4, 0.1, 0);
        g.add(bag, valve);
        beamColor = glowBlue;
        break;
      }
      case 'battery': {
        // A battery pack: dark case, warning stripe, two terminals and a charge light.
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.28, 0.36), std(metalDark, { metalness: 0.3 }));
        box.position.y = 0.14;
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.53, 0.06, 0.37), std(warn, { emissive: warn, emissiveIntensity: 0.3 }));
        stripe.position.y = 0.2;
        for (const [x, c] of [[-0.14, alarm], [0.14, metalDark]] as const) { const tm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), std(c)); tm.position.set(x, 0.31, 0); g.add(tm); }
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: STATUS.nominal }));
        led.position.set(0.18, 0.12, 0.185);
        g.add(box, stripe, led);
        g.rotation.y = 0.5;
        beamColor = warn;
        break;
      }
      case 'repair': {
        // A repair case: hard shell, latches and a handle.
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.42), std(alarm, { roughness: 0.5 }));
        box.position.y = 0.1;
        const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI), std(metalDark));
        handle.position.set(0, 0.2, 0);
        for (const x of [-0.2, 0.2]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.02), std(metal)); l.position.set(x, 0.14, 0.215); g.add(l); }
        g.add(box, handle);
        g.rotation.y = -0.6;
        beamColor = alarm;
        break;
      }
      case 'scrap': {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 10), std(metal, { metalness: 0.4 }));
        tank.rotation.set(0, 0, Math.PI / 2 - 0.2); tank.position.y = 0.3;
        const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.9), std(metalDark));
        panel.position.set(0.5, 0.35, 0.6); panel.rotation.set(0.6, 0.3, 0.2);
        g.add(tank, panel);
        beamColor = warn;
        break;
      }
      case 'shelter': {
        const dome = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(metal));
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.3), std(metalDark));
        door.position.set(0, 0.6, 1.85);
        g.add(dome, door);
        beamColor = dust;
        break;
      }
      case 'rover': {
        const bodyM = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 1.9), std(metal));
        bodyM.position.y = 0.9;
        g.add(bodyM);
        for (let i = 0; i < 6; i++) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.25, 10), std(metalDark));
          w.rotation.x = Math.PI / 2; w.position.set(-1 + (i % 3), 0.26, i < 3 ? 1.05 : -1.05);
          g.add(w);
        }
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), std(metalDark));
        mast.position.set(0.9, 1.85, 0.5);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.3), std(metal));
        head.position.set(0.9, 2.55, 0.5);
        g.add(mast, head);
        g.rotation.y = 0.7;
        beamColor = css('--fg');
        break;
      }
      case 'manual': {
        const page = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), std(dust, { side: THREE.DoubleSide }));
        page.rotation.x = -Math.PI / 2 + 0.2; page.position.y = 0.05;
        g.add(page);
        beamColor = dust;
        break;
      }
      case 'clue': case 'science': case 'sample': {
        // Real NASA sites (from Data's pois.json): a game survey marker, not real hardware.
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), std(metal));
        pole.position.y = 1.1;
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.32), std(glowBlue, { side: THREE.DoubleSide, emissive: glowBlue, emissiveIntensity: 0.25 }));
        flag.position.set(0.28, 1.95, 0);
        g.add(pole, flag);
        if (it.kind === 'sample') { const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), std(metal, { metalness: 0.8, roughness: 0.2 })); tube.rotation.z = Math.PI / 2; tube.position.set(0.3, 0.04, 0.2); g.add(tube); }
        beamColor = glowBlue;
        break;
      }
      default: break;
    }
    g.traverse((ch) => { if ((ch as THREE.Mesh).isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
    // Supplies: a ring on the ground that brightens when the item is within reach.
    let ring: THREE.Mesh | undefined;
    if (SUPPLY.has(it.kind) && beamColor) {
      ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.position.y = 0.03;
      g.add(ring);
    }
    // Three Forks: Perseverance's ten sample tubes lie on the ground round the depot marker, glinting in the sun.
    let glints: THREE.Sprite[] | undefined;
    if (it.poiId === 'three_forks_depot') {
      glints = [];
      const tubeMat = std(metal, { metalness: 0.9, roughness: 0.15 });
      for (let i = 0; i < 10; i++) {
        const p = { x: it.at.x + (i - 4.5) * 2.2, y: it.at.y + (i % 2 ? 1.6 : -1.6) + Math.sin(i * 1.3) * 0.5 };
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 10), tubeMat);
        tube.rotation.set(0, i * 0.7, Math.PI / 2);
        tube.position.set(p.x - it.at.x, ground(p) - ground(it.at) + 0.03, p.y - it.at.y);
        const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: dust, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
        gl.position.copy(tube.position).add(new THREE.Vector3(0, 0.05, 0)); gl.scale.setScalar(0.5);
        g.add(tube, gl); glints.push(gl);
      }
    }
    let beam: THREE.Mesh | undefined;
    if (beamColor) {
      beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.35, 26, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: beamColor, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.y = 13;
      g.add(beam);
    }
    return { obj: g, beam, ring, glints };
  }
  const near = (p: Pt, d: number) =>Math.hypot(p.x - lastMe.x, p.y - lastMe.y) <= d;
  function buildItems(items: MapItem[], first: boolean) {
    // Items that just left the list next to the astronaut were picked up: keep their model for the lift.
    const ids = new Set(items.map((i) => i.id));
    for (const [id, o] of itemObjs) {
      if (ids.has(id) || !o.obj.visible || !SUPPLY.has(o.it.kind) || !near(o.it.at, 12)) continue;
      itemGroup.remove(o.obj); fxGroup.add(o.obj);
      if (o.beam) o.beam.visible = false;
      if (o.ring) o.ring.visible = false;
      fx.push({ obj: o.obj, kind: 'take', t: 0, from: o.obj.position.clone(), h: 0, v: 0, landed: false });
      itemObjs.delete(id);
    }
    const had = new Set(itemObjs.keys());
    clear(itemGroup); itemObjs.clear();
    for (const it of items) {
      if (it.kind === 'base') continue; // UI's lander is the base
      const m = itemModel(it);
      m.obj.position.set(wx(it.at), ground(it.at), wz(it.at));
      m.obj.visible = false;
      itemGroup.add(m.obj);
      itemObjs.set(it.id, { ...m, it });
      // A new item at the astronaut's feet was just put down: it falls from hand height under Mars gravity.
      if (!first && !had.has(it.id) && SUPPLY.has(it.kind) && near(it.at, 6)) {
        fx.push({ obj: m.obj, kind: 'drop', t: 0, from: m.obj.position.clone(), h: 1.15, v: 0, landed: false });
        m.obj.position.y += 1.15;
      }
    }
  }
  function puff(at: THREE.Vector3) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: sand.clone().lerp(dust, 0.4), transparent: true, opacity: 0.55, depthWrite: false }));
    sp.position.copy(at).add(new THREE.Vector3(0, 0.15, 0)); sp.scale.setScalar(0.3);
    fxGroup.add(sp); puffs.push({ s: sp, t: 0 });
  }
  function disposeObj(o: THREE.Object3D) {
    o.traverse((ch) => {
      const m = ch as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => x.dispose());
    });
  }
  function updateFx(dt: number, me: Pt) {
    const hand = new THREE.Vector3(wx(me), ground(me) + 1.1, wz(me));
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.t += dt;
      if (f.kind === 'take') {
        // Lifted in a short arc into the astronaut's hands, shrinking into the pack.
        const u = Math.min(1, f.t / 0.55), e = u * u * (3 - 2 * u);
        f.obj.position.lerpVectors(f.from, hand, e); f.obj.position.y += Math.sin(u * Math.PI) * 0.6;
        f.obj.scale.setScalar(1 - 0.9 * e); f.obj.rotation.y += dt * 6;
        if (u >= 1) { fxGroup.remove(f.obj); disposeObj(f.obj); fx.splice(i, 1); }
      } else {
        // Dropped: falls under Mars gravity (slow to Earth eyes), bounces a little, dust puffs on each hit.
        f.v -= MARS_G * dt; f.h += f.v * dt;
        if (f.h <= 0) {
          f.h = 0;
          if (Math.abs(f.v) > 0.6) { puff(f.from); f.v = -f.v * 0.32; } else { f.v = 0; f.landed = true; }
        }
        f.obj.position.y = f.from.y + f.h;
        if (f.landed) fx.splice(i, 1);
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.t += dt;
      p.s.scale.setScalar(0.3 + p.t * 2.2); (p.s.material as THREE.SpriteMaterial).opacity = Math.max(0, 0.55 * (1 - p.t / 1.6));
      p.s.position.y += dt * 0.15;
      if (p.t > 1.6) { fxGroup.remove(p.s); p.s.material.dispose(); puffs.splice(i, 1); }
    }
  }

  // Route: a ribbon on the ground, dashes moving toward where the astronaut is heading.
  let routeRef: MapWorldState['route'] | undefined;
  const ribbonMats: THREE.MeshBasicMaterial[] = [];
  function ribbon(path: Pt[], color: string, width: number, opacity: number) {
    if (path.length < 2) return;
    // Resample every 1.5 m so the ribbon follows the ground.
    const pts: Pt[] = [path[0]];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
      for (let k = 1; k <= n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const nx = (-dy / L) * width / 2, ny = (dx / L) * width / 2;
      if (i) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      for (const sgn of [-1, 1]) {
        const p = { x: pts[i].x + nx * sgn, y: pts[i].y + ny * sgn };
        pos.push(wx(p), ground(p) + 0.07, wz(p));
        uv.push(along / 2.5, sgn < 0 ? 0 : 1);
      }
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const map = stripes.clone(); map.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, side: THREE.DoubleSide });
    ribbonMats.push(mat);
    routeGroup.add(new THREE.Mesh(g, mat));
  }
  function buildRoute(s: MapWorldState) {
    clear(routeGroup); ribbonMats.length = 0;
    const r = s.route;
    if (!r) return;
    if (r.legs.length) ribbon(r.home.path, r.home.ok ? STATUS.nominal : STATUS.critical, 0.35, 0.4);
    r.legs.forEach((leg) => {
      ribbon(leg.path, STATUS[leg.status], 0.7, 0.85);
      const end = leg.path[leg.path.length - 1];
      if (!end) return;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 30, 10, 1, true),
        new THREE.MeshBasicMaterial({ color: STATUS[leg.status], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      beam.position.set(wx(end), ground(end) + 15, wz(end));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 6, 24), new THREE.MeshBasicMaterial({ color: STATUS[leg.status] }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(wx(end), ground(end) + 0.15, wz(end));
      routeGroup.add(beam, ring);
    });
  }

  // Safe-return wall: the map's green line stood up as a glowing fence; amber, lower and fainter = one-way limit.
  let rangeRef: MapWorldState['range'] | undefined;
  const wallMats: THREE.ShaderMaterial[] = [];
  function wall(segs: [number, number, number, number][], color: string, height: number, alpha: number, cellM: number) {
    const pos: number[] = [], hh: number[] = [];
    for (const [c0, r0, c1, r1] of segs) {
      const a = { x: (c0 + 0.5) * cellM, y: (r0 + 0.5) * cellM }, b = { x: (c1 + 0.5) * cellM, y: (r1 + 0.5) * cellM };
      const ya = ground(a) - 0.3, yb = ground(b) - 0.3;
      pos.push(wx(a), ya, wz(a), wx(b), yb, wz(b), wx(b), yb + height, wz(b), wx(a), ya, wz(a), wx(b), yb + height, wz(b), wx(a), ya + height, wz(a));
      hh.push(0, 0, 1, 0, 1, 1);
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('h', new THREE.Float32BufferAttribute(hh, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) }, alpha: { value: alpha }, pulse: { value: 1 } },
      vertexShader: 'attribute float h; varying float vh; void main(){ vh = h; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float alpha; uniform float pulse; varying float vh; void main(){ float a = alpha * pulse * pow(1.0 - vh, 1.6); gl_FragColor = vec4(color, a); }',
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    wallMats.push(mat);
    wallGroup.add(new THREE.Mesh(g, mat));
  }
  function buildWall(s: MapWorldState) {
    clear(wallGroup); wallMats.length = 0;
    if (!s.range) return;
    const el = s.elevation;
    // contourSegments works in cell units; the map converts with (+0.5) × cellM, done in wall().
    wall(contourSegments(s.range.safe, el.cols, el.rows, s.reserve) as [number, number, number, number][], STATUS.nominal, 2.2, 0.75, el.cellM);
    wall(contourSegments(s.range.reach, el.cols, el.rows, 0) as [number, number, number, number][], STATUS.warning, 1.1, 0.4, el.cellM);
  }

  // Dust storm wall: a ring of billowing dust that closes in as the storm builds (radius 1.5 km to 30 m).
  const stormMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uK: { value: 0 }, cA: { value: dust.clone().lerp(sand, 0.5) }, cB: { value: rust.clone().lerp(shadow, 0.4) }, uDir: { value: 3.6 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uT; uniform float uK; uniform vec3 cA; uniform vec3 cB; uniform float uDir; varying vec2 vUv;
      float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
      void main(){
        float ang = vUv.x * 6.2831853;
        float face = smoothstep(-0.25 - uK * 1.4, 0.35, cos(ang - uDir));       // an arc from one side that wraps round
        float b = fbm(vec2(vUv.x * 46.0 + uT * 0.05, vUv.y * 3.0 - uT * 0.12));
        float top = 1.0 - smoothstep(0.35, 0.95, vUv.y + (b - 0.5) * 0.55);       // ragged, rolling top
        float a = uK * face * top * (0.35 + 0.95 * b);
        vec3 c = mix(cB * 0.75, cA * 1.1, smoothstep(0.1, 0.9, vUv.y * 0.6 + b * 0.7));  // lit, billowing tops over dark roots
        gl_FragColor = vec4(c, clamp(a, 0.0, 0.92)); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const stormWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), stormMat);
  stormWall.visible = false; stormWall.frustumCulled = false;
  group.add(stormWall);
  let stormK = 0;
  /** The storm, read from UI's scene fog (World3D sets fog.far from 3200 m at tau 0 to 140 m at tau 8). */
  function tauFromScene(): number {
    let p: THREE.Object3D | null = group.parent;
    while (p && !(p as THREE.Scene).isScene) p = p.parent;
    const fg = (p as THREE.Scene | null)?.fog;
    return fg && 'far' in fg ? THREE.MathUtils.clamp((3200 - fg.far) / 3060, 0, 1) * 8 : 0;
  }
  function updateStorm(me: Pt, t: number, dt: number) {
    const tau = tauFromScene();
    const want = THREE.MathUtils.clamp((tau - 0.9) / (STORM_TAU_FROM + 1 - 0.9), 0, 1);
    stormK += (want - stormK) * Math.min(1, dt * 0.8);
    stormWall.visible = stormK > 0.01;
    if (!stormWall.visible) return;
    const r = THREE.MathUtils.lerp(1500, 30, Math.pow(stormK, 0.7)), hgt = THREE.MathUtils.lerp(420, 140, stormK);
    stormWall.scale.set(r, hgt, r);
    stormWall.position.set(wx(me), ground(me) + hgt / 2 - 25, wz(me));
    stormMat.uniforms.uK.value = Math.min(1, stormK * 2.2);
    stormMat.uniforms.uT.value = t;
  }

  function update(s: MapWorldState | null, me: Pt, nowMs: number, dt: number) {
    const t = nowMs / 1000;
    updateFx(dt, me);
    updateStorm(me, t, dt);
    lastMe = me;
    // Smoke from the wreck.
    for (let i = 0; i < SMOKE; i++) {
      smokeAge[i] += dt;
      if (smokeAge[i] > 8) smokeAge[i] -= 8;
      const k = smokeAge[i];
      smokePos[i * 3] = bx + Math.sin(i * 1.7) * 0.6 + k * 0.9;
      smokePos[i * 3 + 1] = by + 1.5 + k * 1.6;
      smokePos[i * 3 + 2] = bz + Math.cos(i * 2.3) * 0.6 + k * 0.4;
    }
    smokeGeo.attributes.position.needsUpdate = true;

    if (!s) return;
    if (s.zones !== zonesRef) { zonesRef = s.zones; buildZones(s); }
    if (s.items !== itemsRef) { const first = itemsRef === null; itemsRef = s.items; buildItems(s.items, first); }
    if (s.route !== routeRef) { routeRef = s.route; buildRoute(s); }
    if (s.range !== rangeRef) { rangeRef = s.range; buildWall(s); }

    // Items show the way the map shows them; beams fade out as you get close.
    const vis = new Set(itemsInView(s, me).map((i) => i.id));
    for (const { obj, beam, ring, glints, it } of itemObjs.values()) {
      obj.visible = vis.has(it.id);
      if (ring && obj.visible) {
        const d = Math.hypot(it.at.x - me.x, it.at.y - me.y), reach = d < 4;
        (ring.material as THREE.MeshBasicMaterial).opacity = (reach ? 0.85 : 0.3) * (0.7 + 0.3 * Math.sin(t * (reach ? 6 : 2.4)));
        ring.scale.setScalar(reach ? 1 + 0.12 * Math.sin(t * 6) : 1);
      }
      if (glints && obj.visible) glints.forEach((g, i) => { (g.material as THREE.SpriteMaterial).opacity = 0.25 + 0.5 * Math.max(0, Math.sin(t * 1.7 + i * 2.1)); });
      if (beam && obj.visible) {
        const d = Math.hypot(it.at.x - me.x, it.at.y - me.y);
        (beam.material as THREE.MeshBasicMaterial).opacity = Math.min(0.3, Math.max(0, (d - 10) / 60)) * (0.75 + 0.25 * Math.sin(t * 2.4 + obj.id));
      }
    }
    for (const m of ribbonMats) if (m.map) m.map.offset.x = -t * 0.8;
    for (const m of wallMats) m.uniforms.pulse.value = 0.75 + 0.25 * Math.sin(t * 2.2);
  }

  function dispose() {
    clear(group); fx.length = 0; puffs.length = 0;
    glow.dispose(); stripes.dispose();
  }

  return { group, update, dispose };
}
