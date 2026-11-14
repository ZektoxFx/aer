import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { DataPack } from '../data/types';
import { buildMapWorld, groundStep, type MapWorldState, type Pt } from '../map';
import { buildAstronaut, buildLander, cssColor } from './astronaut3d';
import { moveStep, type MoveInput, type MoveResult } from './movement';
import { buildContactShadow, buildDustDevils, buildFootprints, buildSky, buildTerrain } from './terrain3d';

/** Vertical exaggeration of the real elevation, so Jezero's gentle relief reads on screen. */
const EXAG = 1.6;
/** Terrain mesh resolution (the elevation grid is 640 × 400; every other sample is plenty). */
const SEG_X = 320, SEG_Y = 200;
/** Distance between boot prints, metres. */
const STRIDE_M = 0.75;

export interface World3DProps {
  pack: DataPack;
  base: Pt;
  /** Game seconds per real second right now (0 while paused or holding). */
  timeScale: number;
  /** When set, the astronaut is walked here by the route walker; the keyboard is ignored. */
  followPos?: Pt;
  /** Bump to put the astronaut back at the cabin. */
  placeKey: number;
  tau: number;
  sunElevationDeg: number;
  /** How many dust devils are about (0–2, from the environment timeline and MEDA data). */
  dustDevils?: number;
  /** Called every frame with the astronaut's movement. */
  onMove: (m: MoveResult) => void;
  /** Called when mouse look turns on (cursor captured) or off. */
  onLookChange?: (locked: boolean) => void;
  /** LOCAL DRAFT (Map/Aiman): 'first' = through the helmet visor, 'third' = behind the astronaut (default). */
  view?: 'first' | 'third';
  /** LOCAL DRAFT (Map/Aiman): the map's items, zones, safe zone and route, built into this world. */
  map?: MapWorldState | null;
}

/** Mouse-look sensitivity, radians per pixel. */
const LOOK_SENS = 0.0022;
const PITCH_MIN = 0.06, PITCH_MAX = 1.25;
/** LOCAL DRAFT: first-person eye height (m above the ground) and field of view in each mode. */
const EYE_M = 1.62, FOV_THIRD = 55, FOV_FIRST = 68;
/** Fraction of the way to close per frame for a smoothing rate (per second), whatever the frame rate. */
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

const keyInput = (keys: Set<string>): MoveInput => ({
  forward: (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0),
  right: (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0),
  run: keys.has('shift'),
});

/** Third-person 3D view of Jezero: real HiRISE terrain, the crashed lander, and the astronaut walking. */
export function World3D(props: World3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; });
  const { pack, base, placeKey } = props;
  const placeRef = useRef(placeKey);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const elev = pack.elevation;
    const area = pack.area;
    const W2 = area.widthM / 2, H2 = area.heightM / 2;

    // ---- Renderer: Retina is capped, and the resolution drops further if frames get slow ----
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    let pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);

    // ---- Terrain, sky, light ----
    const terrain = buildTerrain(pack, base, EXAG, SEG_X, SEG_Y, renderer.capabilities.getMaxAnisotropy());
    scene.add(terrain.mesh);
    const groundAt = (p: Pt) => terrain.surfaceY(p.x - W2, p.y - H2);
    const sky = buildSky();
    scene.add(sky.mesh);
    scene.fog = new THREE.Fog(cssColor('--mars-sky'), 300, 3200);
    const hemi = new THREE.HemisphereLight(cssColor('--mars-sky'), cssColor('--mars-rust'), 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(cssColor('--mars-dust'), 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 220 });
    scene.add(sun, sun.target);

    // ---- The crashed lander, rocks, the astronaut and their prints ----
    const lander = buildLander();
    lander.position.set(base.x - W2, groundAt(base) - 0.6, base.y - H2);
    scene.add(lander);

    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ROCKS = 900;
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: cssColor('--mars-rust').lerp(cssColor('--mars-sky'), 0.45), roughness: 1, flatShading: true }),
      ROCKS,
    );
    rocks.castShadow = true; rocks.receiveShadow = true;
    {
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), eu = new THREE.Euler();
      for (let i = 0; i < ROCKS; i++) {
        const r = 14 + Math.pow(rand(), 1.3) * 700, a = rand() * Math.PI * 2;
        const p = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
        const size = 0.06 + Math.pow(rand(), 4) * 0.9; // mostly cobbles, the odd boulder
        q.setFromEuler(eu.set(rand() * 3, rand() * 3, rand() * 3));
        sc.set(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.4), size * (0.8 + rand() * 0.6));
        // Half buried, the way rocks sit in regolith.
        m4.compose(v.set(p.x - W2, groundAt(p) + size * 0.15, p.y - H2), q, sc);
        rocks.setMatrixAt(i, m4);
      }
    }
    scene.add(rocks);

    // LOCAL DRAFT (Map/Aiman): the map in 3D (items, danger zones, route, safe-return wall) plus denser ground.
    const mapWorld = buildMapWorld({ W2, H2, surfaceY: terrain.surfaceY, base });
    scene.add(mapWorld.group);

    const astro = buildAstronaut();
    const body = new THREE.Group();
    body.add(astro.group);
    scene.add(body);
    const contact = buildContactShadow();
    scene.add(contact);
    const prints = buildFootprints();
    scene.add(prints.mesh);
    const devils = buildDustDevils();
    scene.add(devils.group);

    // ---- Blowing dust motes around the astronaut when the air is dusty ----
    const DUST = 1400;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (rand() - 0.5) * 80; dustPos[i * 3 + 1] = rand() * 20; dustPos[i * 3 + 2] = (rand() - 0.5) * 80;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: cssColor('--mars-dust'), size: 0.08, transparent: true, opacity: 0, depthWrite: false });
    const dustCloud = new THREE.Points(dustGeo, dustMat);
    dustCloud.frustumCulled = false;
    scene.add(dustCloud);

    // ---- Player and camera state ----
    const start = { x: base.x + 8, y: base.y + 6 };
    let me: Pt = start;
    let heading = 0, shownHeading = 0, phase = 0, moveBlend = 0;
    let yawT = 0, pitchT = 0.32, distT = 16;
    let yaw = yawT, pitch = pitchT, dist = distT;
    let camPos: THREE.Vector3 | null = null;
    let firstBlend = 0; // LOCAL DRAFT: 0 = third person, 1 = first person (eased, so switching glides)
    const lookAt = new THREE.Vector3();
    let ramp = 0;
    let lastInput: MoveInput = { forward: 0, right: 0, run: false };
    let sinceStep = 0, footSide = 1;
    // Reused every frame instead of allocating.
    const target = new THREE.Vector3(), back = new THREE.Vector3(), want = new THREE.Vector3(), sunOff = new THREE.Vector3();

    // ---- Input ----
    const keys = new Set<string>();
    const typing = (t: EventTarget | null) => t instanceof Element && !!t.closest('input, select, textarea');
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q', 'e'].includes(k)) {
        keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const blur = () => keys.clear();
    // Mouse look: click the view to capture the cursor, then moving the mouse turns the camera (Esc frees it).
    // Dragging also works, for browsers or frames that don't allow capturing the cursor.
    const canvas = renderer.domElement;
    const locked = () => document.pointerLockElement === canvas;
    const turn = (dx: number, dy: number) => {
      yawT += dx * LOOK_SENS;
      pitchT = Math.min(PITCH_MAX, Math.max(PITCH_MIN, pitchT + dy * LOOK_SENS * 0.8));
    };
    let dragging = false, lastX = 0, lastY = 0;
    const pdown = (e: PointerEvent) => {
      if (locked()) return;
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      try {
        const req = canvas.requestPointerLock?.() as unknown;
        if (req instanceof Promise) req.catch(() => {});
      } catch { /* not allowed here: dragging still works */ }
    };
    const pmove = (e: PointerEvent) => {
      if (locked()) return turn(e.movementX, e.movementY);
      if (!dragging) return;
      turn((e.clientX - lastX) * 2.2, (e.clientY - lastY) * 2.2);
      lastX = e.clientX; lastY = e.clientY;
    };
    const pup = () => { dragging = false; };
    const lockChange = () => { dragging = false; live.current.onLookChange?.(locked()); };
    const wheel = (e: WheelEvent) => { e.preventDefault(); if (live.current.view === 'first') return; distT = Math.min(80, Math.max(4, distT * (1 + Math.sign(e.deltaY) * 0.12))); };
    document.addEventListener('pointerlockchange', lockChange);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    canvas.addEventListener('pointerdown', pdown);
    window.addEventListener('pointermove', pmove);
    window.addEventListener('pointerup', pup);
    canvas.addEventListener('wheel', wheel, { passive: false });

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ---- Loop ----
    let last = performance.now();
    let perfT = 0, perfFrames = 0;
    let raf = requestAnimationFrame(function frame(now) {
      const realDt = (now - last) / 1000;
      const dt = Math.min(0.1, realDt);
      last = now;
      const P = live.current;

      // Adaptive resolution: if frames average slower than ~45 fps, render fewer pixels.
      perfT += realDt; perfFrames++;
      if (perfT > 2) {
        if (perfT / perfFrames > 1 / 45 && pixelRatio > 0.75) {
          pixelRatio = Math.max(0.75, pixelRatio - 0.25);
          renderer.setPixelRatio(pixelRatio);
          resize();
        }
        perfT = 0; perfFrames = 0;
      }

      if (placeRef.current !== P.placeKey) {
        placeRef.current = P.placeKey; me = start; camPos = null; ramp = 0; prints.erase(Infinity);
      }
      if (keys.has('q')) yawT -= dt * 1.8;
      if (keys.has('e')) yawT += dt * 1.8;
      yaw += (yawT - yaw) * ease(14, dt);
      pitch += (pitchT - pitch) * ease(14, dt);
      dist += (distT - dist) * ease(8, dt);

      // ---- Move ----
      const before = me;
      let m: MoveResult;
      if (P.followPos) {
        // The route walker moves the astronaut (updated a few times a second): glide toward it, face the way they go.
        const dx = P.followPos.x - me.x, dy = P.followPos.y - me.y;
        const gap = Math.hypot(dx, dy);
        const moving = gap > 0.05;
        if (moving) heading = Math.atan2(dx, -dy);
        const k = gap > 200 ? 1 : ease(10, dt);
        me = { x: me.x + dx * k, y: me.y + dy * k };
        ramp = 0;
        m = { pos: me, moving, speedMS: moving ? 1 : 0, slopeDeg: 0, heading };
      } else {
        const raw = keyInput(keys);
        const pressing = raw.forward !== 0 || raw.right !== 0;
        if (pressing) lastInput = raw;
        ramp += ((pressing ? 1 : 0) - ramp) * ease(pressing ? 7 : 10, dt);
        if (!pressing && ramp < 0.03) ramp = 0;
        const input = ramp > 0 ? lastInput : { forward: 0, right: 0, run: false };
        m = moveStep(me, heading, input, yaw, dt * P.timeScale * ramp, elev, area);
        // LOCAL DRAFT (Map/Aiman): the map's ground rules, the same ones a planned route is costed with. Slopes over
        // 25° stop you; soft sand and boulder fields slow you and cost extra effort (more O₂) in the suit model.
        if (m.moving && P.map) {
          const g = groundStep(P.map.zones, me, m.slopeDeg);
          if (g.blocked) m = { ...m, pos: me, moving: false, speedMS: 0 };
          else m = { ...m, pos: { x: me.x + (m.pos.x - me.x) * g.speedFactor, y: me.y + (m.pos.y - me.y) * g.speedFactor }, speedMS: m.speedMS * g.speedFactor, slopeDeg: g.effortSlopeDeg };
        }
        me = m.pos; heading = m.heading;
      }
      P.onMove(m);

      // ---- Place the astronaut exactly on the drawn ground ----
      const gx = me.x - W2, gz = me.y - H2, gy = terrain.surfaceY(gx, gz);
      moveBlend += ((m.moving ? 1 : 0) - moveBlend) * ease(8, dt);
      if (m.moving) phase += dt * (m.speedMS > 1.5 ? 13 : 8) * Math.max(0.4, ramp || 1);
      astro.pose(phase, moveBlend, now / 1000);
      body.position.set(gx, gy, gz);
      const turnBy = Math.atan2(Math.sin(heading - shownHeading), Math.cos(heading - shownHeading));
      shownHeading += turnBy * ease(10, dt);
      body.rotation.y = -shownHeading;
      contact.position.set(gx, gy + 0.03, gz);

      // Boot prints along the way (several per frame when time warp covers ground fast).
      const moved = Math.hypot(me.x - before.x, me.y - before.y);
      if (m.moving && moved < 200) {
        sinceStep += moved;
        while (sinceStep >= STRIDE_M) {
          sinceStep -= STRIDE_M;
          const t = 1 - sinceStep / Math.max(moved, 1e-6);
          const px = before.x + (me.x - before.x) * t, py = before.y + (me.y - before.y) * t;
          footSide = -footSide;
          const ox = Math.cos(heading) * 0.13 * footSide, oy = Math.sin(heading) * 0.13 * footSide;
          prints.add(px + ox - W2, terrain.surfaceY(px + ox - W2, py + oy - H2) + 0.025, py + oy - H2, heading);
        }
      }

      // ---- Camera: glide to a point behind and above, kept above the ground ----
      target.set(gx, gy + 1.4, gz);
      back.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      want.copy(target).addScaledVector(back, dist);
      if (!camPos) { camPos = want.clone(); lookAt.copy(target); }
      camPos.lerp(want, ease(10, dt));
      const camGround = terrain.surfaceY(camPos.x, camPos.z) + 1.2;
      if (camPos.y < camGround) camPos.y = camGround;
      lookAt.lerp(target, ease(16, dt));
      // LOCAL DRAFT: first person. Eye in the helmet, looking where the mouse points (pitch's resting value looks
      // level; moving the mouse up/down tilts the head). The body is hidden so it doesn't block the view.
      firstBlend += ((P.view === 'first' ? 1 : 0) - firstBlend) * ease(6, dt);
      if (firstBlend < 0.001) firstBlend = 0;
      if (firstBlend > 0.999) firstBlend = 1;
      if (firstBlend > 0) {
        const tilt = 0.32 - pitch;
        const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt));
        const eye = new THREE.Vector3(gx, gy + EYE_M, gz).addScaledVector(dir, 0.3);
        camera.position.copy(camPos).lerp(eye, firstBlend);
        camera.lookAt(lookAt.clone().lerp(eye.clone().addScaledVector(dir, 10), firstBlend));
      } else {
        camera.position.copy(camPos);
        camera.lookAt(lookAt);
      }
      astro.group.visible = firstBlend < 0.85;
      const fov = FOV_THIRD + (FOV_FIRST - FOV_THIRD) * firstBlend, near = firstBlend > 0.5 ? 0.1 : 0.5;
      if (camera.fov !== fov || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
      sky.mesh.position.copy(camera.position);

      // ---- Sun, night and dust ----
      const elevRad = (Math.max(-10, P.sunElevationDeg) * Math.PI) / 180;
      const day = THREE.MathUtils.clamp((P.sunElevationDeg + 6) / 20, 0, 1);
      const dust = THREE.MathUtils.clamp(P.tau / 8, 0, 1);
      sun.position.copy(body.position).add(sunOff.set(-60 * Math.cos(elevRad), 80 * Math.max(0.15, Math.sin(elevRad)), 40));
      sun.target.position.copy(body.position);
      sun.intensity = 2.8 * day * (1 - 0.75 * dust);
      hemi.intensity = 0.35 + 1.1 * day; // dusty Mars skies scatter a lot of light into shadows
      const horizon = sky.update(day, dust);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(horizon);
      fog.far = THREE.MathUtils.lerp(3200, 140, dust);
      fog.near = THREE.MathUtils.lerp(300, 10, dust);
      astro.lamp.intensity = 30 * Math.max(1 - day, dust * 0.6);

      // A storm erases the trail, oldest prints first.
      if (P.tau > 3 && prints.size > 0) prints.erase(Math.ceil(dt * 120));

      // Dust motes in dusty air; dust devils around midday.
      dustMat.opacity = THREE.MathUtils.clamp((P.tau - 1) / 3, 0, 0.85);
      if (dustMat.opacity > 0) {
        const arr = dustGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < DUST; i++) {
          arr[i * 3] += dt * (8 + (i % 7));
          arr[i * 3 + 1] -= dt * 0.6;
          if (arr[i * 3] > 40) arr[i * 3] -= 80;
          if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] += 20;
        }
        dustGeo.attributes.position.needsUpdate = true;
        dustCloud.position.copy(body.position);
      }
      devils.update(dt, body.position, yaw, P.tau < 3 ? (P.dustDevils ?? 0) : 0, terrain.surfaceY);
      mapWorld.update(P.map ?? null, me, now, dt);

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
      document.removeEventListener('pointerlockchange', lockChange);
      if (locked()) document.exitPointerLock();
      renderer.dispose();
      terrain.dispose();
      rocks.geometry.dispose();
      dustGeo.dispose();
      devils.dispose();
      mapWorld.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [pack, base]);

  return <div ref={host} className="world3d" aria-label="3D view of Jezero Crater" />;
}
