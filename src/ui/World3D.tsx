import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { DataPack } from '../data/types';
import { heightAt, type Pt } from '../map';
import { buildAstronaut, buildLander, cssColor } from './astronaut3d';
import { moveStep, type MoveInput, type MoveResult } from './movement';

/** Vertical exaggeration of the real elevation, so Jezero's gentle relief reads on screen. */
const EXAG = 1.6;
/** Terrain mesh resolution (the elevation grid is 640 × 400; every other sample is plenty). */
const SEG_X = 320, SEG_Y = 200;

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
  /** Called every frame with the astronaut's movement. */
  onMove: (m: MoveResult) => void;
}

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
    const h0 = heightAt(elev, base);
    const groundY = (p: Pt) => (heightAt(elev, p) - h0) * EXAG;
    // Map metres (x east, y south) ↔ world (x east, z south, y up), centred on the area.
    const toWorld = (p: Pt, y = groundY(p)) => new THREE.Vector3(p.x - area.widthM / 2, y, p.y - area.heightM / 2);

    // ---- Renderer, scene, camera ----
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const sky = cssColor('--mars-sky');
    const night = cssColor('--space');
    scene.background = sky.clone();
    scene.fog = new THREE.Fog(sky.clone(), 300, 3200);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.5, 8000);

    // ---- Light: a Mars sky dome and a low sun ----
    const hemi = new THREE.HemisphereLight(sky, cssColor('--mars-rust'), 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(cssColor('--mars-dust'), 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 200 });
    scene.add(sun, sun.target);

    // ---- Terrain from the real elevation grid, with the HiRISE image on top ----
    const geo = new THREE.PlaneGeometry(area.widthM, area.heightM, SEG_X, SEG_Y);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const p = { x: pos.getX(i) + area.widthM / 2, y: pos.getZ(i) + area.heightM / 2 };
      pos.setY(i, groundY(p));
    }
    geo.computeVertexNormals();
    const tex = new THREE.TextureLoader().load(pack.imageUrl || '/data/jezero_base_2m.jpg');
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, color: cssColor('--mars-sky'), roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    // ---- The crashed lander at the cabin, and the astronaut ----
    const lander = buildLander();
    lander.position.copy(toWorld(base)).add(new THREE.Vector3(0, -0.6, 0));
    scene.add(lander);
    const astro = buildAstronaut();
    const body = new THREE.Group();
    body.add(astro.group);
    scene.add(body);

    // ---- Rocks for scale: scattered boulders and cobbles within ~700 m of the cabin (seeded, so stable) ----
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const ROCKS = 900;
    const rocks = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: cssColor('--mars-rust').lerp(cssColor('--mars-sky'), 0.45), roughness: 1, flatShading: true }),
      ROCKS,
    );
    rocks.castShadow = true; rocks.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < ROCKS; i++) {
      const r = 14 + Math.pow(rand(), 1.3) * 700, a = rand() * Math.PI * 2;
      const p = { x: base.x + Math.cos(a) * r, y: base.y + Math.sin(a) * r };
      const size = 0.06 + Math.pow(rand(), 4) * 0.9; // mostly cobbles, the odd boulder
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      sc.set(size * (0.8 + rand() * 0.6), size * (0.5 + rand() * 0.4), size * (0.8 + rand() * 0.6));
      m4.compose(toWorld(p, groundY(p) + size * 0.25), q, sc);
      rocks.setMatrixAt(i, m4);
    }
    scene.add(rocks);

    // ---- Blowing dust, shown when the air is dusty: a cloud of motes that follows the camera ----
    const DUST = 1400;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (rand() - 0.5) * 80; dustPos[i * 3 + 1] = rand() * 20; dustPos[i * 3 + 2] = (rand() - 0.5) * 80;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ color: cssColor('--mars-dust'), size: 0.08, transparent: true, opacity: 0, depthWrite: false });
    const dustCloud = new THREE.Points(dustGeo, dustMat);
    scene.add(dustCloud);

    // ---- Player state ----
    const start = { x: base.x + 8, y: base.y + 6 };
    let me: Pt = start;
    let heading = 0;
    let phase = 0;
    let moveBlend = 0;
    let yaw = 0, pitch = 0.32, dist = 16;

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
    let dragging = false, lastX = 0, lastY = 0;
    const pdown = (e: PointerEvent) => { dragging = true; lastX = e.clientX; lastY = e.clientY; renderer.domElement.setPointerCapture(e.pointerId); };
    const pmove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.005;
      pitch = Math.min(1.2, Math.max(0.08, pitch + (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    };
    const pup = () => { dragging = false; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); dist = Math.min(80, Math.max(5, dist * (1 + Math.sign(e.deltaY) * 0.1))); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    renderer.domElement.addEventListener('pointerdown', pdown);
    renderer.domElement.addEventListener('pointermove', pmove);
    renderer.domElement.addEventListener('pointerup', pup);
    renderer.domElement.addEventListener('wheel', wheel, { passive: false });

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
    let raf = requestAnimationFrame(function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const P = live.current;

      if (placeRef.current !== P.placeKey) { placeRef.current = P.placeKey; me = start; }
      if (keys.has('q')) yaw -= dt * 1.6;
      if (keys.has('e')) yaw += dt * 1.6;

      let m: MoveResult;
      if (P.followPos) {
        // The route walker moves the astronaut; face the way they go.
        const dx = P.followPos.x - me.x, dy = P.followPos.y - me.y;
        const moving = Math.hypot(dx, dy) > 0.05;
        if (moving) heading = Math.atan2(dx, -dy);
        me = P.followPos;
        m = { pos: me, moving, speedMS: moving ? 1 : 0, slopeDeg: 0, heading };
      } else {
        m = moveStep(me, heading, keyInput(keys), yaw, dt * P.timeScale, elev, area);
        me = m.pos; heading = m.heading;
      }
      P.onMove(m);

      // Pose and place the astronaut.
      moveBlend += ((m.moving ? 1 : 0) - moveBlend) * Math.min(1, dt * 8);
      if (m.moving) phase += dt * (m.speedMS > 1.5 ? 13 : 8);
      astro.pose(phase, moveBlend, now / 1000);
      body.position.copy(toWorld(me));
      body.rotation.y = -heading;

      // Camera behind and above, kept above the ground.
      const target = body.position.clone().add(new THREE.Vector3(0, 1.4, 0));
      const back = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      const cam = target.clone().addScaledVector(back, dist);
      const camGround = groundY({ x: cam.x + area.widthM / 2, y: cam.z + area.heightM / 2 }) + 1.5;
      if (cam.y < camGround) cam.y = camGround;
      camera.position.copy(cam);
      camera.lookAt(target);

      // Sun, night and dust: the sky dims at night and closes in with dust.
      const elevRad = (Math.max(-10, P.sunElevationDeg) * Math.PI) / 180;
      const day = THREE.MathUtils.clamp((P.sunElevationDeg + 6) / 20, 0, 1);
      const dust = THREE.MathUtils.clamp(P.tau / 8, 0, 1);
      sun.position.copy(body.position).add(new THREE.Vector3(-60 * Math.cos(elevRad), 80 * Math.max(0.15, Math.sin(elevRad)), 40));
      sun.target.position.copy(body.position);
      sun.intensity = 2.4 * day * (1 - 0.75 * dust);
      hemi.intensity = 0.25 + 0.65 * day;
      const skyNow = night.clone().lerp(sky, 0.15 + 0.85 * day);
      (scene.background as THREE.Color).copy(skyNow);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(skyNow);
      fog.far = THREE.MathUtils.lerp(3200, 140, dust);
      fog.near = THREE.MathUtils.lerp(300, 10, dust);
      // Helmet lamp at night and in thick dust.
      astro.lamp.intensity = 30 * Math.max(1 - day, dust * 0.6);
      // Dust motes drift with the wind and wrap around the astronaut.
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
        dustCloud.position.set(body.position.x, body.position.y, body.position.z);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      renderer.dispose();
      geo.dispose();
      tex.dispose();
      rocks.geometry.dispose();
      dustGeo.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [pack, base]);

  return <div ref={host} className="world3d" aria-label="3D view of Jezero Crater" />;
}
