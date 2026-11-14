import * as THREE from 'three';

// Built-in 3D models for the game view, made from simple shapes (no downloaded assets).
// To swap in a teammate's astronaut later: load their .glb with three's GLTFLoader and return it from
// buildAstronaut() with the same `group`, `pose` and `lamp` fields.

/** A colour from the :root variables in src/index.css (colours live only there). */
export function cssColor(name: string, fallback = '#ffffff'): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

export interface AstronautModel {
  group: THREE.Group;
  /** Pose for this frame: `phase` advances with each step, `moving` 0..1 blends standing → walking, `t` is seconds. */
  pose: (phase: number, moving: number, t: number) => void;
  /** Helmet lamp: the view turns it up at night. */
  lamp: THREE.SpotLight;
}

/** A suited astronaut, about 1.85 m tall, facing −z (north), with knees and elbows that bend. */
export function buildAstronaut(): AstronautModel {
  const suit = new THREE.MeshStandardMaterial({ color: cssColor('--metal'), roughness: 0.75 });
  const soft = new THREE.MeshStandardMaterial({ color: cssColor('--metal').multiplyScalar(0.86), roughness: 0.9 });
  const joint = new THREE.MeshStandardMaterial({ color: cssColor('--metal-dark'), roughness: 0.8 });
  const visorMat = new THREE.MeshStandardMaterial({ color: cssColor('--mars-sky'), metalness: 0.95, roughness: 0.08 });
  const stripe = new THREE.MeshStandardMaterial({ color: cssColor('--mars-sand'), roughness: 0.6 });
  const glow = new THREE.MeshBasicMaterial({ color: cssColor('--mars-dust') });

  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs and breathes; limbs hang from it
  root.add(body);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  // Torso: hard upper torso, soft lower torso, waist bearing, chest control box, mission stripe.
  add(new THREE.CapsuleGeometry(0.24, 0.3, 8, 16), suit, 0, 1.24, 0, body);
  add(new THREE.CylinderGeometry(0.2, 0.22, 0.22, 16), soft, 0, 0.98, 0, body);
  add(new THREE.TorusGeometry(0.205, 0.03, 8, 24), joint, 0, 0.88, 0, body).rotation.x = Math.PI / 2;
  add(new THREE.BoxGeometry(0.26, 0.12, 0.1), joint, 0, 1.12, -0.24, body);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.02), glow, -0.07, 1.13, -0.295, body);
  add(new THREE.TorusGeometry(0.245, 0.018, 6, 24), stripe, 0, 1.33, 0, body).rotation.x = Math.PI / 2;

  // Life-support backpack with vents and an antenna.
  add(new THREE.BoxGeometry(0.46, 0.6, 0.26), suit, 0, 1.24, 0.26, body);
  add(new THREE.BoxGeometry(0.4, 0.08, 0.02), joint, 0, 1.0, 0.4, body);
  add(new THREE.BoxGeometry(0.4, 0.08, 0.02), joint, 0, 1.12, 0.4, body);
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.35, 6), joint, 0.17, 1.68, 0.3, body);

  // Helmet: shell, gold visor, lamp housings either side, neck ring.
  const head = new THREE.Group();
  head.position.set(0, 1.64, 0);
  body.add(head);
  add(new THREE.SphereGeometry(0.235, 24, 18), suit, 0, 0, 0, head);
  const visor = add(new THREE.SphereGeometry(0.205, 24, 18), visorMat, 0, -0.01, -0.07, head);
  visor.scale.set(1, 0.8, 0.78);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.06, 0.06, 0.1), joint, sx * 0.2, 0.08, -0.08, head);
    add(new THREE.CircleGeometry(0.022, 12), glow, sx * 0.2, 0.08, -0.131, head).rotation.y = Math.PI;
  }
  add(new THREE.TorusGeometry(0.17, 0.035, 8, 24), joint, 0, -0.2, 0, head).rotation.x = Math.PI / 2;

  // Helmet lamp, aimed ahead and slightly down; off by day.
  const lamp = new THREE.SpotLight(cssColor('--mars-dust'), 0, 45, 0.45, 0.5, 1.2);
  lamp.position.set(0, 0.1, -0.15);
  lamp.target.position.set(0, -1.2, -6);
  head.add(lamp, lamp.target);

  // Two-part limbs: upper pivot at the hip/shoulder, lower pivot at the knee/elbow.
  const limb = (x: number, y: number, r: number, upperL: number, lowerL: number, end: THREE.BufferGeometry, endZ: number) => {
    const upper = new THREE.Group();
    upper.position.set(x, y, 0);
    body.add(upper);
    add(new THREE.CapsuleGeometry(r, upperL, 6, 12), suit, 0, -(upperL / 2 + r * 0.6), 0, upper);
    const lower = new THREE.Group();
    lower.position.set(0, -(upperL + r * 1.2), 0);
    upper.add(lower);
    add(new THREE.SphereGeometry(r * 1.08, 10, 8), joint, 0, 0, 0, lower); // knee / elbow joint
    add(new THREE.CapsuleGeometry(r * 0.92, lowerL, 6, 12), suit, 0, -(lowerL / 2 + r * 0.6), 0, lower);
    add(end, joint, 0, -(lowerL + r * 1.5), endZ, lower);
    return { upper, lower };
  };
  const legL = limb(-0.12, 0.88, 0.09, 0.3, 0.3, new THREE.BoxGeometry(0.15, 0.11, 0.28), -0.05);
  const legR = limb(0.12, 0.88, 0.09, 0.3, 0.3, new THREE.BoxGeometry(0.15, 0.11, 0.28), -0.05);
  const armL = limb(-0.32, 1.42, 0.075, 0.22, 0.2, new THREE.SphereGeometry(0.075, 10, 8), 0);
  const armR = limb(0.32, 1.42, 0.075, 0.22, 0.2, new THREE.SphereGeometry(0.075, 10, 8), 0);

  const pose = (phase: number, moving: number, t: number) => {
    const s = Math.sin(phase) * 0.55 * moving;
    // Legs swing; the knee bends on the leg coming forward.
    legL.upper.rotation.x = s;
    legR.upper.rotation.x = -s;
    legL.lower.rotation.x = -Math.max(0, Math.sin(phase + 0.8)) * 0.9 * moving;
    legR.lower.rotation.x = -Math.max(0, -Math.sin(phase + 0.8)) * 0.9 * moving;
    // Arms swing opposite, elbows always a little bent (a pressurised suit doesn't straighten fully).
    armL.upper.rotation.x = -s * 0.7;
    armR.upper.rotation.x = s * 0.7;
    armL.upper.rotation.z = 0.14;
    armR.upper.rotation.z = -0.14;
    armL.lower.rotation.x = -0.35 - Math.max(0, s) * 0.3;
    armR.lower.rotation.x = -0.35 - Math.max(0, -s) * 0.3;
    // Step bounce while walking; slow breathing while standing.
    body.position.y = Math.abs(Math.sin(phase)) * 0.045 * moving + Math.sin(t * 1.6) * 0.008 * (1 - moving);
    head.rotation.y = Math.sin(t * 0.4) * 0.12 * (1 - moving);
  };

  return { group: root, pose, lamp };
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
