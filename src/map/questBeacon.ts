import * as THREE from 'three';
import type { Pt } from './geo';
import './questBeacon.css';

/**
 * The quest beacon (Map): where the current quest wants the player to go, shown two ways in the 3D view.
 * - In the world: a tall pale light pillar, a pulsing ground ring and a bobbing chevron, seen from far off.
 * - On screen: a marker with the target's name and distance. It sits over the target, and when the target is off
 *   screen or behind the camera it sticks to the screen edge with an arrow pointing the way.
 */
export interface QuestBeacon {
  group: THREE.Group;
  /** Call every frame. `target` null hides everything. */
  update: (target: { at: Pt; label: string } | null, me: Pt, camera: THREE.Camera, t: number, w: number, h: number) => void;
  dispose: () => void;
}

interface Opts { W2: number; H2: number; surfaceY: (x: number, z: number) => number; host: HTMLElement }

/** Inside this distance (m) the player has arrived: the beacon fades out. */
const ARRIVED_M = 5;
const PILLAR_H = 90;
/** Screen-edge margins for the marker, px (more at the bottom, clear of the suit bars and buttons). */
const EDGE = 56, EDGE_BOTTOM = 120;

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#d8a657');
}

export function buildQuestBeacon(o: Opts): QuestBeacon {
  const { W2, H2, surfaceY, host } = o;
  const color = css('--warning');
  const group = new THREE.Group();
  group.visible = false;

  // Light pillar: an open cylinder that fades upward and flickers softly.
  const pillarMat = new THREE.ShaderMaterial({
    uniforms: { uC: { value: color }, uT: { value: 0 }, uK: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uC; uniform float uT, uK; varying vec2 vUv;
      void main(){
        float fade = pow(1.0 - vUv.y, 1.6);
        float edge = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 3.0 + uT * 2.0);
        float pulse = 0.75 + 0.25 * sin(uT * 2.4 - vUv.y * 9.0);
        gl_FragColor = vec4(uC * 1.4, fade * edge * pulse * 0.42 * uK);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, PILLAR_H, 20, 1, true), pillarMat);
  pillar.position.y = PILLAR_H / 2;
  group.add(pillar);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, PILLAR_H, 8, 1, true), pillarMat);
  core.position.y = PILLAR_H / 2;
  group.add(core);

  // Ground ring, pulsing outward.
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.05, 56), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  // A chevron bobbing over the spot, pointing down.
  const chevMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
  const chevron = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), chevMat);
  chevron.rotation.x = Math.PI;
  group.add(chevron);

  // The on-screen marker.
  const el = document.createElement('div');
  el.className = 'quest-marker';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<span class="quest-marker-arrow">▼</span><b></b><i></i>';
  const arrow = el.firstElementChild as HTMLSpanElement;
  const name = el.querySelector('b')!;
  const dist = el.querySelector('i')!;
  host.appendChild(el);
  let lastLabel = '', lastDist = '';

  const v = new THREE.Vector3();
  let k = 0; // fade in/out

  function update(target: { at: Pt; label: string } | null, me: Pt, camera: THREE.Camera, t: number, w: number, h: number) {
    const d = target ? Math.hypot(target.at.x - me.x, target.at.y - me.y) : 0;
    const want = target && d > ARRIVED_M ? 1 : 0;
    k += (want - k) * 0.08;
    if (!target || k < 0.01) {
      group.visible = false;
      el.style.opacity = '0';
      return;
    }
    const x = target.at.x - W2, z = target.at.y - H2;
    const y = surfaceY(x, z);
    group.visible = true;
    group.position.set(x, y, z);
    pillarMat.uniforms.uT.value = t;
    // Near: the pillar fades so it doesn't blind; far: full strength.
    pillarMat.uniforms.uK.value = k * Math.min(1, 0.25 + d / 60);
    const s = 1 + ((t * 0.7) % 1) * 0.9;
    ring.scale.set(s, s, s);
    ringMat.opacity = 0.65 * k * (1 - ((t * 0.7) % 1));
    chevron.position.y = 3.2 + Math.sin(t * 2.6) * 0.35;
    chevron.rotation.y = t * 1.2;
    chevMat.opacity = 0.9 * k;
    // Bigger far away, so the beacon stays readable at a few hundred metres.
    const far = Math.max(1, d / 80);
    pillar.scale.set(far, 1, far);
    chevron.scale.setScalar(Math.min(far, 4));

    // Screen marker.
    v.set(x, y + 4, z).project(camera);
    const behind = v.z > 1;
    let sx = ((v.x + 1) / 2) * w, sy = ((1 - v.y) / 2) * h;
    if (behind) { sx = w - sx; sy = h - EDGE_BOTTOM; }
    const off = behind || sx < EDGE || sx > w - EDGE || sy < EDGE || sy > h - EDGE_BOTTOM;
    const cx = Math.min(w - EDGE, Math.max(EDGE, sx)), cy = Math.min(h - EDGE_BOTTOM, Math.max(EDGE, sy));
    el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) translate(-50%, -100%)`;
    el.style.opacity = String(Math.min(1, k * 1.2));
    el.classList.toggle('off', off);
    const ang = off ? Math.atan2(sy - h / 2, sx - w / 2) * (180 / Math.PI) - 90 : 0;
    arrow.style.transform = `rotate(${ang.toFixed(0)}deg)`;
    const ds = d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`;
    if (target.label !== lastLabel) { name.textContent = target.label; lastLabel = target.label; }
    if (ds !== lastDist) { dist.textContent = ds; lastDist = ds; }
  }

  function dispose() {
    el.remove();
    group.traverse((obj) => {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
    });
    pillarMat.dispose(); ringMat.dispose(); chevMat.dispose();
  }

  return { group, update, dispose };
}
