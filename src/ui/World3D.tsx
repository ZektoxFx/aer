import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { DataPack } from '../data/types';
import { buildMapWorld, groundStep, type MapWorldState, type Pt } from '../map';
import { buildAstronaut, buildLander, cssColor } from './astronaut3d';
import { moveStep, type MoveInput, type MoveResult } from './movement';
import { buildDust, buildDustDevils, buildSky, pointScale, sunDirection } from './sky3d';
import { buildContactShadow, buildFootprints, buildTerrain } from './terrain3d';

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
  /** When set, the route walker owns the position: read every frame, and the keyboard is ignored. */
  follow?: () => Pt | null;
  /** Where the astronaut is when the view opens (default: beside the lander). */
  startPos?: Pt;
  /** The keyboard can't move the astronaut (a scripted mission or the storm shelter flow is running). */
  moveLocked?: boolean;
  /** Bump to put the astronaut back at the cabin. */
  placeKey: number;
  tau: number;
  sunElevationDeg: number;
  /** Where the sun is round the horizon, degrees clockwise from north (default: south-west). */
  sunAzimuthDeg?: number;
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
/** The view draws at up to this many canvas pixels per CSS pixel, and at least MIN_RATIO when frames are slow. */
const MAX_RATIO = 1.5, MIN_RATIO = 0.75;
/** A frame that takes the GPU longer than this (ms) drops the resolution; it steps back up when the sharper frame would stay under GPU_ROOM_MS. */
const GPU_SLOW_MS = 18, GPU_ROOM_MS = 11;
/** Without a GPU timer: frames arriving slower than this (ms) start one test of whether a lower resolution helps. */
const FRAME_SLOW_MS = 1000 / 45;
/** The shadow map covers this many metres round the astronaut, in SHADOW_MAP_PX texels. */
const SHADOW_HALF_M = 22, SHADOW_MAP_PX = 1024;
/** Result of the no-GPU-timer resolution test, kept across view switches so it runs once per visit. */
let testedRatio: number | null = null;
/** Development only: a test page can read the renderer and override the sky (`window.__aer3d.override = { tau: 8 }`). */
interface Dev3D {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  override: { tau?: number; sunElevationDeg?: number; sunAzimuthDeg?: number };
  pixelRatio: number;
}
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

    // ---- Renderer: Retina is capped, and the resolution follows the frame rate (see the loop) ----
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const maxRatio = Math.min(window.devicePixelRatio, MAX_RATIO);
    let pixelRatio = Math.min(maxRatio, testedRatio ?? maxRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.autoUpdate = false; // redrawn from the loop: every frame while moving fast, every other frame otherwise
    renderer.shadowMap.type = THREE.PCFShadowMap; // soft-edged; three.js folded PCFSoftShadowMap into this
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 9000);

    // ---- Terrain, sky, light ----
    // Phones and data-saver connections skip the sharper tiles (about 3 MB to download, 60 MB on the GPU).
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
    const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820;
    const terrain = buildTerrain(pack, base, EXAG, SEG_X, SEG_Y, {
      maxAniso: renderer.capabilities.getMaxAnisotropy(),
      hiRes: !saveData && !phone && renderer.capabilities.maxTextureSize >= 4096,
    });
    scene.add(terrain.mesh);
    const groundAt = (p: Pt) => terrain.surfaceY(p.x - W2, p.y - H2);
    const sky = buildSky();
    scene.add(sky.mesh);
    scene.fog = new THREE.Fog(cssColor('--mars-sky'), 300, 3200);
    const hemi = new THREE.HemisphereLight(cssColor('--mars-sky'), cssColor('--mars-rust'), 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(cssColor('--mars-dust'), 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    Object.assign(sun.shadow.camera, { left: -SHADOW_HALF_M, right: SHADOW_HALF_M, top: SHADOW_HALF_M, bottom: -SHADOW_HALF_M, near: 1, far: 220 });
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

    // ---- Blowing dust motes around the astronaut when the air is dusty (moved by a shader) ----
    const dustMotes = buildDust();
    scene.add(dustMotes.points);

    // ---- Player and camera state ----
    const start = { x: base.x + 8, y: base.y + 6 };
    let me: Pt = live.current.startPos ?? start; // open where the astronaut is, not back at the lander (#40)
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
    const fpDir = new THREE.Vector3(), fpEye = new THREE.Vector3(), fpAim = new THREE.Vector3();
    const shadowRight = new THREE.Vector3(), shadowUp = new THREE.Vector3(), shadowAt = new THREE.Vector3(), worldUp = new THREE.Vector3(0, 1, 0);
    const dev: Dev3D | null = import.meta.env.DEV
      ? ((window as unknown as { __aer3d?: Dev3D }).__aer3d = { renderer, scene, camera, override: {}, pixelRatio })
      : null;

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
    // Adaptive resolution. The time between frames can't tell a slow GPU from a browser that holds the page to
    // 30 fps, or from one long hitch while data loads; reading all three as "slow" left the view blurry for the
    // rest of the session. So:
    // - where the browser has a GPU timer (Chrome, Edge), a frame is timed on the GPU about once a second, and the
    //   resolution follows that: down when a frame takes too long, back up when there is room;
    // - elsewhere, slow frames start one test: drop the resolution and see if frames come faster. If they don't,
    //   resolution isn't the limit, so it goes back up and stays.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    let query: WebGLQuery | null = null;
    const costs: number[] = [];
    const frameMs = new Float32Array(240);
    let frameN = 0, windowT = 0, sinceProbe = 0, warmUp = 3, settle = false, shadowsOff = false, frameNo = 0;
    let trial: { ratio: number; ms: number } | null = null;
    let tested = testedRatio !== null;
    const setRatio = (r: number) => { pixelRatio = r; renderer.setPixelRatio(r); resize(); costs.length = 0; if (dev) dev.pixelRatio = r; };
    const slower = () => {
      if (pixelRatio > MIN_RATIO) setRatio(Math.max(MIN_RATIO, pixelRatio - 0.25));
      else if (!shadowsOff) { shadowsOff = true; sun.castShadow = false; } // last resort on slow GPUs: no shadow pass
    };
    let raf = requestAnimationFrame(function frame(now) {
      const realDt = (now - last) / 1000;
      const dt = Math.min(0.1, realDt);
      last = now;
      const P = live.current;

      warmUp = Math.max(0, warmUp - realDt); // shaders compile and textures upload in the first seconds
      sinceProbe += realDt;
      let probe = false;
      if (timer) {
        if (query && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) costs.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6);
          gl.deleteQuery(query);
          query = null;
          if (costs.length >= 3) {
            const cost = costs.sort((a, b) => a - b)[1]; // the typical one of three
            costs.length = 0;
            const up = Math.min(maxRatio, pixelRatio + 0.25);
            if (cost > GPU_SLOW_MS) slower();
            else if (up > pixelRatio && cost * (up / pixelRatio) ** 2 < GPU_ROOM_MS) setRatio(up);
          }
        }
        probe = !query && warmUp === 0 && sinceProbe > 0.7;
      } else if (!tested && warmUp === 0) {
        windowT += realDt;
        if (frameN < frameMs.length) frameMs[frameN++] = realDt * 1000;
        if (windowT > 2) {
          const typical = frameMs.subarray(0, frameN).sort()[frameN >> 1];
          windowT = 0; frameN = 0;
          if (settle) settle = false; // the first window after a change doesn't count
          else if (trial) {
            if (typical > trial.ms * 0.85) setRatio(trial.ratio); // no faster: keep it sharp
            else if (typical > FRAME_SLOW_MS) slower();
            testedRatio = pixelRatio; tested = true; trial = null;
          } else if (typical > FRAME_SLOW_MS && pixelRatio > MIN_RATIO) {
            trial = { ratio: pixelRatio, ms: typical };
            setRatio(MIN_RATIO);
            settle = true;
          }
        }
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
      const followPos = P.follow?.() ?? null;
      if (followPos) {
        // The route walker moves the astronaut (its position each frame): glide toward it, face the way they go.
        const dx = followPos.x - me.x, dy = followPos.y - me.y;
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
        m = moveStep(me, heading, input, yaw, dt * (P.moveLocked ? 0 : P.timeScale) * ramp, elev, area);
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
        fpDir.set(Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt));
        fpEye.set(gx, gy + EYE_M, gz).addScaledVector(fpDir, 0.3);
        camera.position.copy(camPos).lerp(fpEye, firstBlend);
        camera.lookAt(fpAim.copy(fpEye).addScaledVector(fpDir, 10).lerp(lookAt, 1 - firstBlend));
      } else {
        camera.position.copy(camPos);
        camera.lookAt(lookAt);
      }
      astro.group.visible = firstBlend < 0.85;
      const fov = FOV_THIRD + (FOV_FIRST - FOV_THIRD) * firstBlend, near = firstBlend > 0.5 ? 0.1 : 0.5;
      if (camera.fov !== fov || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
      sky.mesh.position.copy(camera.position);

      // ---- Sun, night and dust ----
      const tau = dev?.override.tau ?? P.tau;
      const sunEl = dev?.override.sunElevationDeg ?? P.sunElevationDeg;
      const sunAz = dev?.override.sunAzimuthDeg ?? P.sunAzimuthDeg ?? 236;
      const day = THREE.MathUtils.clamp((sunEl + 6) / 20, 0, 1);
      const dust = THREE.MathUtils.clamp(tau / 8, 0, 1);
      // The light comes from where the sun is drawn. It is kept at least 9° up, so shadows near sunrise and
      // sunset stay inside the shadow map.
      sunDirection(sunAz, Math.max(9, sunEl), sunOff);
      // Move the shadow map in whole texels, so shadow edges don't crawl as the astronaut walks.
      shadowRight.crossVectors(worldUp, sunOff).normalize();
      shadowUp.crossVectors(sunOff, shadowRight);
      const texel = (SHADOW_HALF_M * 2) / SHADOW_MAP_PX;
      const sx = body.position.dot(shadowRight), sy = body.position.dot(shadowUp);
      shadowAt.copy(body.position)
        .addScaledVector(shadowRight, Math.round(sx / texel) * texel - sx)
        .addScaledVector(shadowUp, Math.round(sy / texel) * texel - sy);
      sun.position.copy(shadowAt).addScaledVector(sunOff, 100);
      sun.target.position.copy(shadowAt);
      sun.intensity = 2.8 * day * (1 - 0.75 * dust);
      hemi.intensity = 0.35 + 1.1 * day; // dusty Mars skies scatter a lot of light into shadows
      const horizon = sky.update(day, dust, tau, sunAz, sunEl);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(horizon);
      fog.far = THREE.MathUtils.lerp(3200, 140, dust);
      fog.near = THREE.MathUtils.lerp(300, 10, dust);
      astro.lamp.intensity = 30 * Math.max(1 - day, dust * 0.6);

      // A storm erases the trail, oldest prints first.
      if (tau > 3 && prints.size > 0) prints.erase(Math.ceil(dt * 120));

      // Dust motes in dusty air; dust devils around midday. Both are drawn as sprites sized in metres.
      const sprite = pointScale(renderer.domElement.height, camera.fov);
      dustMotes.update(dt, tau, body.position, sprite);
      devils.update(dt, body.position, yaw, tau < 3 ? (P.dustDevils ?? 0) : 0, terrain.surfaceY, sprite);
      terrain.update(dt);
      mapWorld.update(P.map ?? null, me, now, dt);

      // Shadows: the astronaut is the only thing that moves, so the shadow map is redrawn every other frame
      // unless they covered real ground this frame (time warp), and always on a timed frame.
      if ((frameNo++ & 1) === 0 || moved > 0.05 || probe) renderer.shadowMap.needsUpdate = true;
      if (probe && timer) {
        query = gl.createQuery();
        gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
        renderer.render(scene, camera);
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        sinceProbe = 0;
      } else renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (query) gl.deleteQuery(query);
      ro.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      window.removeEventListener('pointermove', pmove);
      window.removeEventListener('pointerup', pup);
      document.removeEventListener('pointerlockchange', lockChange);
      if (locked()) document.exitPointerLock();
      // Free everything on the GPU (geometries, materials, textures), then the context itself, so switching
      // views many times doesn't run out of GPU memory (#40).
      scene.traverse((o) => {
        const obj = o as THREE.Mesh;
        obj.geometry?.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
        for (const mt of mats) {
          for (const v of Object.values(mt)) if (v instanceof THREE.Texture) v.dispose();
          mt.dispose();
        }
      });
      renderer.forceContextLoss();
      renderer.dispose();
      terrain.dispose();
      sky.dispose();
      rocks.geometry.dispose();
      dustMotes.dispose();
      devils.dispose();
      if (dev) delete (window as unknown as { __aer3d?: Dev3D }).__aer3d;
      mapWorld.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [pack, base]);

  return <div ref={host} className="world3d" aria-label="3D view of Jezero Crater" />;
}
