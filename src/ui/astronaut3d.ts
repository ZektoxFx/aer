import * as THREE from 'three';

/** A colour from the :root variables in src/index.css (colours live only there). */
export function cssColor(name: string, fallback = '#ffffff'): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export interface AstronautModel {
  group: THREE.Group;
  /** Pose for this frame: `phase` advances while walking; `moving` 0..1 blends from standing to walking. */
  pose: (phase: number, moving: number) => void;
}

/** A suited astronaut built from simple shapes, about 1.85 m tall, facing −z (north). */
export function buildAstronaut(): AstronautModel {
  const suit = new THREE.MeshStandardMaterial({ color: cssColor('--metal'), roughness: 0.7 });
  const joint = new THREE.MeshStandardMaterial({ color: cssColor('--metal-dark'), roughness: 0.8 });
  const visor = new THREE.MeshStandardMaterial({ color: cssColor('--mars-sky'), metalness: 0.9, roughness: 0.15 });
  const accent = new THREE.MeshStandardMaterial({ color: cssColor('--mars-sand'), roughness: 0.6 });

  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Torso, waist ring, backpack (life support) with its control box.
  add(new THREE.CapsuleGeometry(0.23, 0.42, 6, 12), suit, 0, 1.17, 0);
  add(new THREE.TorusGeometry(0.2, 0.035, 8, 20), joint, 0, 0.92, 0).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.44, 0.58, 0.24), suit, 0, 1.22, 0.24);
  add(new THREE.BoxGeometry(0.24, 0.1, 0.12), accent, 0, 1.06, -0.24);
  add(new THREE.BoxGeometry(0.06, 0.2, 0.04), accent, -0.12, 1.38, 0.37);

  // Helmet with a gold visor and a neck ring.
  add(new THREE.SphereGeometry(0.23, 20, 16), suit, 0, 1.64, 0);
  const v = add(new THREE.SphereGeometry(0.2, 20, 16), visor, 0, 1.64, -0.06);
  v.scale.set(1, 0.82, 0.78);
  add(new THREE.TorusGeometry(0.17, 0.04, 8, 20), joint, 0, 1.45, 0).rotation.x = Math.PI / 2;

  // Limbs hang from pivots so they can swing.
  const limb = (x: number, y: number, radius: number, length: number, end: THREE.BufferGeometry, endMat: THREE.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    g.add(pivot);
    add(new THREE.CapsuleGeometry(radius, length, 6, 10), suit, 0, -(length / 2 + radius), 0, pivot);
    add(end, endMat, 0, -(length + radius * 2.2), 0, pivot);
    return pivot;
  };
  const legL = limb(-0.12, 0.9, 0.095, 0.62, new THREE.BoxGeometry(0.16, 0.12, 0.28), joint);
  const legR = limb(0.12, 0.9, 0.095, 0.62, new THREE.BoxGeometry(0.16, 0.12, 0.28), joint);
  const armL = limb(-0.31, 1.4, 0.075, 0.48, new THREE.SphereGeometry(0.08, 10, 8), joint);
  const armR = limb(0.31, 1.4, 0.075, 0.48, new THREE.SphereGeometry(0.08, 10, 8), joint);
  // Boots point forward.
  for (const leg of [legL, legR]) leg.children[1].position.z = -0.05;

  const pose = (phase: number, moving: number) => {
    const s = Math.sin(phase) * 0.6 * moving;
    legL.rotation.x = s;
    legR.rotation.x = -s;
    armL.rotation.x = -s * 0.8;
    armR.rotation.x = s * 0.8;
    armL.rotation.z = 0.12;
    armR.rotation.z = -0.12;
    const bob = Math.abs(Math.sin(phase)) * 0.04 * moving;
    g.position.y = bob; // the parent places the astronaut on the ground; this adds the step bounce
  };

  return { group: g, pose };
}

/** The crashed AER-1 lander: a tilted capsule with legs, foil and a scorched heat shield. */
export function buildLander(): THREE.Group {
  const metal = new THREE.MeshStandardMaterial({ color: cssColor('--metal'), roughness: 0.55, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: cssColor('--metal-dark'), roughness: 0.9 });
  const foil = new THREE.MeshStandardMaterial({ color: cssColor('--mars-sky'), metalness: 0.8, roughness: 0.35 });
  const g = new THREE.Group();
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    return m;
  };
  mesh(new THREE.CylinderGeometry(1.6, 2.6, 2.8, 24), metal).position.y = 1.8;
  mesh(new THREE.CylinderGeometry(2.62, 2.62, 0.35, 24), dark).position.y = 0.35;
  mesh(new THREE.CylinderGeometry(1.62, 1.62, 0.4, 24), foil).position.y = 3.3;
  const hatch = mesh(new THREE.BoxGeometry(0.9, 1.2, 0.1), dark);
  hatch.position.set(0, 1.7, -2.1);
  hatch.rotation.x = -0.35;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8), dark);
    leg.position.set(Math.cos(a) * 2.6, 0.7, Math.sin(a) * 2.6);
    leg.rotation.z = Math.cos(a) * 0.5;
    leg.rotation.x = -Math.sin(a) * 0.5;
  }
  // Crashed: tipped over and half dug in.
  g.rotation.set(0.22, 0.6, -0.18);
  return g;
}
