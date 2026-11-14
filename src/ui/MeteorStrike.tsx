// The meteor strike (Map/Aiman), in 3D (three.js). Mid-cruise, Mars ahead, the AER-1 transfer ship (service module,
// solar wings, the entry capsule on the nose) is hit in the engine section by a tumbling rock.
// What makes it read as real space, not film space: the rock does not burn or trail fire (there is no air); it is a
// dark, lumpy stone lit only by the Sun. The hit is a hypervelocity impact: a white flash of vaporised metal, a cone
// of fine glittering debris, larger panel pieces tumbling off on straight lines (no gravity or drag to curve them),
// and gas venting from the breach that freezes into a white plume. The kick sets the ship slowly spinning.
// The rock is slowed down so it can be seen (real ones arrive at many km/s). The impact lands at IMPACT_S, on the
// intro sound's bang. The shot keeps running through the fault (Control's mayday call): the ship tumbles and vents,
// the master alarm pulses, the attitude thrusters slowly stop the spin, and the view swings round to Mars as the ship
// diverts toward it, so it leads straight into the 3D entry. Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

import { IMPACT_S } from './meteor';
export { IMPACT_S, METEOR_MS } from './meteor';

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#808080');
}
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };

function softSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** A lumpy stone: an icosphere pushed in and out by a few overlapping waves, flat-shaded. */
function rockGeometry(radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 3);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = 1 + 0.22 * Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7) + 0.12 * Math.sin(v.z * 6.3 + v.x * 4.1) + 0.06 * Math.sin(v.y * 13 + v.z * 9);
    const squash = new THREE.Vector3(1.25, 0.85, 0.95);
    v.multiplyScalar(radius * n).multiply(squash);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export function MeteorStrike({ active, alarm = false }: { active: boolean; alarm?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const flash = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !active) return;
    const C = {
      space: css('--space'), fg: css('--fg'), metal: css('--metal'), metalDark: css('--metal-dark'), panel: css('--sat-panel'),
      warn: css('--warning'), alarm: css('--alarm'), sky: css('--earth-glow'), rust: css('--mars-rust'), sand: css('--mars-sand'),
      shadow: css('--mars-shadow'), dust: css('--mars-dust'),
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = C.space;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5e4);

    // ---- Space: stars, Mars ahead, the Sun's light from behind-left ----
    const starPts: number[] = [];
    for (let i = 0; i < 2500; i++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2e4); starPts.push(v.x, v.y, v.z); }
    scene.add(new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3)),
      new THREE.PointsMaterial({ color: C.fg, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.85 }),
    ));
    const marsTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const g = c.getContext('2d')!;
      g.fillStyle = `#${C.sand.getHexString()}`; g.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `#${(Math.random() < 0.5 ? C.rust : C.shadow).getHexString()}`; g.globalAlpha = 0.12 + Math.random() * 0.22;
        g.beginPath(); g.ellipse(Math.random() * 256, 30 + Math.random() * 70, 4 + Math.random() * 18, 2 + Math.random() * 6, 0, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 0.8; g.fillStyle = `#${C.dust.getHexString()}`; g.fillRect(0, 0, 256, 7); g.fillRect(0, 121, 256, 7);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const mars = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 32), new THREE.MeshStandardMaterial({ map: marsTex, roughness: 1 }));
    mars.position.set(2600, 900, -9000);
    scene.add(mars);
    const sunDir = new THREE.Vector3(-0.6, 0.45, 0.65).normalize();
    const sun = new THREE.DirectionalLight(C.fg, 3.2);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(C.sky, 0.12));

    // ---- The ship (+x = forward, toward Mars) ----
    const ship = new THREE.Group();
    const std = (c: THREE.Color, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, ...o });
    const hull = std(C.metal, { metalness: 0.15 });
    const foil = std(C.warn.clone().lerp(C.dust, 0.35), { metalness: 0.85, roughness: 0.3 }); // gold insulation blanket
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 40), hull);
    body.rotation.z = Math.PI / 2;
    const engineSec = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.0, 3, 40), foil);
    engineSec.rotation.z = Math.PI / 2; engineSec.position.x = -6;
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 0.55, 2.8, 28, 1, true), std(C.metalDark, { metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }));
    bell.rotation.z = Math.PI / 2; bell.position.x = -8.9; // throat at the ship, wide exit pointing back
    const capsule = new THREE.Mesh(
      new THREE.LatheGeometry([[2.25, 0], [1.95, 0.6], [1.25, 1.7], [0.95, 1.8], [0.9, 2.2], [0, 2.25]].map(([r, y]) => new THREE.Vector2(r, y)), 40),
      std(C.metal, { roughness: 0.45 }),
    );
    capsule.rotation.z = -Math.PI / 2; capsule.position.x = 4.5;
    ship.add(body, engineSec, bell, capsule);
    // Solar wings, each a row of dark-blue cells on a thin frame.
    const wings: THREE.Group[] = [];
    for (const s of [1, -1]) {
      const w = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const cell = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 2.4), std(C.panel, { metalness: 0.5, roughness: 0.25, emissive: C.sky, emissiveIntensity: 0.04 }));
        cell.position.set(0, 0, s * (3.6 + k * 2.55));
        w.add(cell);
      }
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 10.5), std(C.metalDark));
      spar.position.z = s * 7.4; w.add(spar);
      w.position.x = -1.5;
      ship.add(w); wings.push(w);
    }
    scene.add(ship);

    // ---- The rock: ~1.6 m, dark and dusty, tumbling in from the upper right-front ----
    const rock = new THREE.Mesh(rockGeometry(0.8), new THREE.MeshStandardMaterial({ color: C.shadow.clone().lerp(C.metalDark, 0.5), roughness: 1, flatShading: true }));
    scene.add(rock);
    const hitLocal = new THREE.Vector3(-6, 1.9, 0.8); // on the engine section's upper side
    const fromDir = new THREE.Vector3(0.75, 0.55, 0.35).normalize(); // from the upper right
    const ROCK_V = 70; // m/s on screen (slowed down so it can be seen)

    // ---- Impact effects ----
    const sprite = softSprite();
    const flashMat = new THREE.SpriteMaterial({ map: sprite, color: C.fg.clone().lerp(C.sky, 0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const flashSprite = new THREE.Sprite(flashMat);
    scene.add(flashSprite);
    const flashLight = new THREE.PointLight(C.fg, 0, 120, 1.5);
    scene.add(flashLight);
    // Fine debris: a glittering cone thrown back out of the crater (straight lines: no air, no gravity).
    const FINE = 700;
    const finePos = new Float32Array(FINE * 3), fineVel = new Float32Array(FINE * 3);
    const fineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(finePos, 3));
    const fineMat = new THREE.PointsMaterial({ map: sprite, color: C.fg, size: 0.22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const fine = new THREE.Points(fineGeo, fineMat);
    fine.frustumCulled = false;
    scene.add(fine);
    // Larger pieces of hull and foil, tumbling away.
    const chunks: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06 + Math.random() * 0.32, 0.02, 0.06 + Math.random() * 0.24), Math.random() < 0.5 ? foil : hull);
      m.visible = false; scene.add(m);
      chunks.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) });
    }
    // Venting gas: a white jet from the breach that spreads and fades as it freezes.
    interface Puff { s: THREE.Sprite; m: THREE.SpriteMaterial; v: THREE.Vector3; age: number; on: boolean }
    const puffs: Puff[] = [];
    for (let i = 0; i < 160; i++) {
      const m = new THREE.SpriteMaterial({ map: sprite, color: C.metal, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      puffs.push({ s, m, v: new THREE.Vector3(), age: 0, on: false });
    }
    let nextPuff = 0, ventAcc = 0;

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    // ---- Loop ----
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true, hit = false;
    const spin = new THREE.Vector3(), hitWorld = new THREE.Vector3(), normal = new THREE.Vector3(), tmp = new THREE.Vector3();
    const lookAim = new THREE.Vector3(), marsAim = new THREE.Vector3();
    const jitter = new THREE.Vector3(), camBase = new THREE.Vector3(-1, 7, 38), look = new THREE.Vector3(1, 2, 0);

    function frame(now: number) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const T = (now - t0) / 1000;

      // After the first seconds the thrusters damp the spin (the ship is being brought under control).
      if (hit && T > 4) spin.multiplyScalar(1 - dt * 0.22);
      // Mars grows as the ship diverts toward it.
      mars.scale.setScalar(1 + Math.min(1.6, Math.max(0, T - 3) * 0.16));
      // The ship drifts forward a little; after the hit it turns slowly about a tilted axis.
      ship.position.x = T * 0.6;
      if (hit) { ship.rotation.x += spin.x * dt; ship.rotation.y += spin.y * dt; ship.rotation.z += spin.z * dt; }
      ship.updateMatrixWorld();
      hitWorld.copy(hitLocal).applyMatrix4(ship.matrixWorld);

      // The rock: straight in, tumbling, until it hits.
      if (!hit) {
        rock.visible = true;
        rock.position.copy(hitWorld).addScaledVector(fromDir, ROCK_V * Math.max(0, IMPACT_S - T));
        rock.rotation.set(T * 2.3, T * 1.7, T * 3.1);
      }
      if (!hit && T >= IMPACT_S) {
        hit = true; rock.visible = false;
        normal.set(0, 1, 0.4).normalize().transformDirection(ship.matrixWorld);
        for (let i = 0; i < FINE; i++) {
          // A cone around the outward normal, a little toward where the rock came from.
          const dir = tmp.copy(normal).multiplyScalar(1).addScaledVector(fromDir, 0.4)
            .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.4)).normalize();
          const sp = 6 + Math.random() * Math.random() * 40;
          finePos.set([hitWorld.x, hitWorld.y, hitWorld.z], i * 3);
          fineVel.set([dir.x * sp, dir.y * sp, dir.z * sp], i * 3);
        }
        chunks.forEach((c) => {
          const dir = tmp.copy(normal).add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6)).normalize();
          c.m.position.copy(hitWorld); c.v.copy(dir).multiplyScalar(3 + Math.random() * 10); c.m.visible = true;
        });
        spin.set(0.35, -0.12, 0.22);
        // The near solar wing's root is cut: it swings away from the ship.
        wings[0].userData.free = true;
      }
      const since = hit ? T - IMPACT_S : -1;

      // Flash: very bright and very short, then gone.
      const f = hit ? Math.exp(-since * 9) : 0;
      flashSprite.position.copy(hitWorld).addScaledVector(normal, 0.4);
      flashSprite.scale.setScalar(4 + (hit ? since * 30 : 0));
      flashMat.opacity = f;
      flashLight.position.copy(flashSprite.position); flashLight.intensity = f * 4000;
      if (flash.current) flash.current.style.opacity = String(clamp(f * 0.75));

      if (hit) {
        fineMat.opacity = clamp(1.2 - since * 0.45);
        for (let i = 0; i < FINE * 3; i++) finePos[i] += fineVel[i] * dt;
        fineGeo.attributes.position.needsUpdate = true;
        for (const c of chunks) { c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt; }
        // Venting: strongest at once, easing off.
        ventAcc += dt * (60 * Math.exp(-since * 0.6) + 12);
        while (ventAcc > 1) {
          ventAcc -= 1;
          const q = puffs[nextPuff]; nextPuff = (nextPuff + 1) % puffs.length;
          q.s.position.copy(hitWorld); q.age = 0; q.on = true; q.s.visible = true;
          q.v.copy(normal).multiplyScalar(9 + Math.random() * 6).add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4));
        }
      }
      for (const q of puffs) {
        if (!q.on) continue;
        q.age += dt;
        if (q.age > 1.6) { q.on = false; q.s.visible = false; continue; }
        q.s.position.addScaledVector(q.v, dt);
        q.s.scale.setScalar(0.6 + q.age * 4.5);
        q.m.opacity = 0.55 * (1 - q.age / 1.6);
      }
      // The cut wing drifts off and turns.
      const w0 = wings[0];
      if (w0.userData.free) { w0.position.z += dt * 1.6; w0.position.y += dt * 0.5; w0.rotation.x += dt * 0.9; w0.rotation.y += dt * 0.25; }

      // Camera: a slow push in beside the ship, then the shock.
      const shake = hit ? 0.9 * Math.exp(-since * 2.5) : 0;
      jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake);
      // The push-in stops after the hit; then the camera eases back and turns toward Mars.
      const Tc = Math.min(T, 3.2), back = Math.max(0, T - 3.2);
      camera.position.copy(camBase).add(tmp.set(Tc * 0.3 - back * 0.4, back * 0.5, -Tc * 2.2 + back * 2.4)).add(jitter);
      const toMars = smooth(3.4, 10, T) * 0.55;
      lookAim.copy(look).add(tmp.set(T * 0.6, 0, 0)).lerp(marsAim.copy(mars.position).sub(camera.position).normalize().multiplyScalar(40).add(camera.position), toMars);
      camera.lookAt(lookAim);

      if (cap.current) cap.current.textContent = hit && T < 3.4 ? '▲ IMPACT · ENGINE SECTION BREACHED' : '';

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((x) => x.dispose());
      });
      sprite.dispose(); marsTex.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div ref={host} className={`meteor-strike${active ? ' on' : ''}${alarm ? ' alarm' : ''}`} aria-hidden="true">
      <div className="meteor-alarm" />
      <p ref={cap} className="meteor-cap" />
      <p className="meteor-note">Game fiction: the rock is slowed down so it can be seen</p>
      <div ref={flash} className="meteor-flash" />
    </div>
  );
}
