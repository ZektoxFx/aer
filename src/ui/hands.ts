// LOCAL DRAFT (Aiman): the astronaut's suited hands, built from simple shapes so they need no model file.
// Used in the intro cabin, and in first person in the game to reach for and carry things (setGrip curls the fingers).
// Local frame: the wrist is at the origin, the hand points along -Z with the palm facing down (-Y); the sleeve runs
// back along +Z. Suit gloves are bulky, so the sizes are a little larger than a bare hand.
import * as THREE from 'three';

export interface Glove {
  group: THREE.Group;
  /** 0 = open hand, 1 = closed fist (holding something). */
  setGrip(g: number): void;
  dispose(): void;
}

export interface GloveColours { suit: THREE.Color; ring: THREE.Color; dark: THREE.Color }

/** `side`: 1 = right hand, -1 = left hand. */
export function makeGlove(side: 1 | -1, c: GloveColours, sleeveM = 0.6): Glove {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: c.suit, roughness: 0.85 });
  const ring = new THREE.MeshStandardMaterial({ color: c.ring, roughness: 0.35, metalness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: c.dark, roughness: 0.9 });
  const geos: THREE.BufferGeometry[] = [];
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => { geos.push(g); const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };

  // Sleeve, wrist bearing ring and cuff.
  const sleeve = mesh(new THREE.CylinderGeometry(0.054, 0.066, sleeveM, 14).rotateX(Math.PI / 2), suit);
  sleeve.position.z = 0.06 + sleeveM / 2; group.add(sleeve);
  const bearing = mesh(new THREE.TorusGeometry(0.058, 0.011, 8, 24), ring); bearing.position.z = 0.055; group.add(bearing);
  const cuff = mesh(new THREE.CylinderGeometry(0.05, 0.056, 0.07, 14).rotateX(Math.PI / 2), dark); cuff.position.z = 0.02; group.add(cuff);

  // Palm: a flattened capsule.
  const palm = mesh(new THREE.CapsuleGeometry(0.019, 0.06, 4, 10).rotateX(Math.PI / 2), suit);
  palm.scale.set(2.5, 1, 1); palm.position.z = -0.05; group.add(palm);

  // Fingers: two segments each, hinged so they curl down toward the palm.
  const hinges: { base: THREE.Group; mid: THREE.Group; k: number }[] = [];
  const lengths = [0.036, 0.04, 0.038, 0.03];
  lengths.forEach((L, i) => {
    const base = new THREE.Group();
    base.position.set(side * (0.03 - i * 0.02), 0, -0.095);
    const seg1 = mesh(new THREE.CapsuleGeometry(0.0105, L, 3, 8).rotateX(Math.PI / 2), suit); seg1.position.z = -L / 2; base.add(seg1);
    const mid = new THREE.Group(); mid.position.z = -L; base.add(mid);
    const seg2 = mesh(new THREE.CapsuleGeometry(0.0098, L * 0.85, 3, 8).rotateX(Math.PI / 2), suit); seg2.position.z = -L * 0.42; mid.add(seg2);
    group.add(base); hinges.push({ base, mid, k: 1 });
  });
  // Thumb: off the inner side of the palm, angled forward and in.
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.045, -0.006, -0.045); thumb.rotation.y = -side * 0.7;
  const t1 = mesh(new THREE.CapsuleGeometry(0.011, 0.034, 3, 8).rotateX(Math.PI / 2), suit); t1.position.z = -0.02; thumb.add(t1);
  const tMid = new THREE.Group(); tMid.position.z = -0.04; thumb.add(tMid);
  const t2 = mesh(new THREE.CapsuleGeometry(0.0102, 0.026, 3, 8).rotateX(Math.PI / 2), suit); t2.position.z = -0.015; tMid.add(t2);
  group.add(thumb);

  const setGrip = (g: number) => {
    const k = Math.max(0, Math.min(1, g));
    for (const h of hinges) { h.base.rotation.x = -(0.15 + 1.25 * k); h.mid.rotation.x = -(0.2 + 1.35 * k); }
    thumb.rotation.x = -0.9 * k; tMid.rotation.x = -0.8 * k;
  };
  setGrip(0.2);

  return {
    group, setGrip,
    dispose: () => { for (const g of geos) g.dispose(); suit.dispose(); ring.dispose(); dark.dispose(); },
  };
}
