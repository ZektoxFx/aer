// The launch from Earth (Map/Aiman), in 3D (three.js), timed by launch.ts.
// A coastal launch site at dawn: scrubland, a beach, and the ocean to the east with the Sun just above it. A generic
// two-stage rocket (no real vehicle, no logos) stands on a concrete pad beside its service tower, venting.
//   pad: wide shot, the count running down, oxygen vapour drifting off the rocket;
//   ignite: the engines light, steam and smoke billow out of the flame trench and light up orange;
//   rise: liftoff, a long-lens camera on the ground tracks the rocket up past the tower, through the clouds;
//   ascent: a chase camera beside the rocket, the Earth curving away below, the sky going from blue to black, the
//           plume widening in the thin air; main engine cut-off, stage separation, second stage ignition.
// The ground curves with the Earth (each vertex drops by d²/2R). Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ascentAt, downrangeAt, EVENTS, launchClock, launchEvent, LAUNCH_MS, pitchAt } from './launch';

const EARTH_R = 6_371_000;
const R = 1.85; // body radius, m (before ROCKET_SCALE)
const ROCKET_SCALE = 1.35;

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
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  rg.addColorStop(0.65, 'rgba(255,255,255,0.2)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
/** A puffy smoke sprite: several soft blobs, so the clouds look lumpy rather than round. */
function puffSprite(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 60, y = 64 + (Math.random() - 0.5) * 60, r = 18 + Math.random() * 26;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;
const CURVED_VERT = /* glsl */ `#include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uR; varying vec2 vG; varying vec3 vW;
  void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vec2 d = w.xz - cameraPosition.xz;
    w.y -= dot(d, d) / (2.0 * uR); vW = w.xyz; vG = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
    #include <logdepthbuf_vertex>
  }`;

/** Exhaust plume: a flame that fades along its length and toward its edges, with shock-diamond bands. */
function plumeMaterial(hot: THREE.Color, warm: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { hot: { value: hot }, warm: { value: warm }, k: { value: 0 }, time: { value: 0 }, diamonds: { value: 1 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform vec3 hot; uniform vec3 warm; uniform float k; uniform float time; uniform float diamonds;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        #include <logdepthbuf_fragment>
        float along = 1.0 - vUv.y;               // 0 at the engine, 1 at the tail
        float face = abs(dot(normalize(vN), normalize(vV)));
        float n = vnoise(vec2(vUv.x * 18.0, along * 6.0 - time * 14.0)) * 0.5 + 0.5;
        float band = 1.0 + diamonds * 0.35 * smoothstep(0.6, 1.0, sin(along * 34.0)) * (1.0 - along);
        float a = pow(1.0 - along, 1.4) * pow(face, 1.2) * (0.55 + 0.6 * n) * band;
        vec3 c = mix(hot, warm, smoothstep(0.05, 0.6, along));
        gl_FragColor = vec4(c * a * k, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function LaunchScene({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLPreElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const count = useRef<HTMLParagraphElement>(null);
  const fade = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !active) return;
    const C = {
      space: css('--space'), sky: css('--earth-glow'), sea: css('--sat-panel'), fg: css('--fg'), dust: css('--mars-dust'),
      warn: css('--warning'), alarm: css('--alarm'), metal: css('--metal'), metalDark: css('--metal-dark'),
      shadow: css('--mars-shadow'), rust: css('--mars-rust'), dim: css('--dim'),
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 3e6);

    // ---- Sky: dawn blue with a warm glow round the low Sun; black space above ~60 km; the blue limb ----
    const sunDir = new THREE.Vector3(1, 0.07, -0.35).normalize(); // just above the sea, to the east
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sun: { value: sunDir }, warm: { value: C.warn.clone().lerp(C.fg, 0.4) },
        sunC: { value: C.fg }, warmK: { value: 1 }, limb: { value: C.sky }, limbK: { value: 0 }, dip: { value: 0 },
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zen; uniform vec3 hor; uniform vec3 sun; uniform vec3 warm; uniform vec3 sunC; uniform float warmK;
        uniform vec3 limb; uniform float limbK; uniform float dip; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float e = d.y + dip; float s = max(dot(d, sun), 0.0);
          vec3 c = mix(hor, zen, smoothstep(-0.02, 0.5, e));
          c = mix(c, warm, warmK * pow(s, 3.0) * (1.0 - smoothstep(0.0, 0.35, e)) * 0.75);   // dawn glow along the horizon
          c += limb * limbK * exp(-abs(e) * 60.0);
          c += sunC * (pow(s, 1800.0) * 3.0 + pow(s, 24.0) * 0.25);
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1e6, 48, 24), skyMat);
    sky.renderOrder = -2;
    scene.add(sky);
    const starPts: number[] = [];
    for (let i = 0; i < 1800; i++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.02, Math.random() - 0.5).normalize().multiplyScalar(9e5); starPts.push(v.x, v.y, v.z); }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3)),
      new THREE.PointsMaterial({ color: C.fg, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, depthTest: false }),
    );
    stars.renderOrder = -1;
    scene.add(stars);

    // ---- Ground and sea: scrubland, a beach, the ocean to the east with ripples and the Sun's glitter ----
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uR: { value: EARTH_R }, uSun: { value: sunDir }, uTime: { value: 0 },
        uLand: { value: C.metalDark.clone().lerp(C.shadow, 0.45) }, uLand2: { value: C.dim.clone().lerp(C.metalDark, 0.5) },
        uSand: { value: C.dust.clone().lerp(C.dim, 0.25) }, uSea: { value: C.sea }, uSeaFar: { value: C.sea.clone().lerp(C.sky, 0.25) },
        uGlint: { value: C.fg }, uFog: { value: new THREE.Color() }, uFogNear: { value: 0 }, uFogFar: { value: 1 },
      },
      vertexShader: CURVED_VERT,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 uSun; uniform float uTime; uniform vec3 uLand; uniform vec3 uLand2; uniform vec3 uSand; uniform vec3 uSea; uniform vec3 uSeaFar; uniform vec3 uGlint;
        uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
        varying vec2 vG; varying vec3 vW;
        ${NOISE}
        void main(){
          #include <logdepthbuf_fragment>
          // The coastline runs north-south about 400 m east of the pad, wobbling at every scale.
          float shoreX = 400.0 + (fbm(vec2(vG.y / 2500.0, 3.0)) - 0.5) * 700.0 + (fbm(vec2(vG.y / 60000.0, 9.0)) - 0.5) * 40000.0;
          float s = vG.x - shoreX;
          float fw = length(fwidth(vG));
          vec3 V = normalize(cameraPosition - vW);
          vec3 col;
          if (s < 0.0) {
            float a = fbm(vG / 900.0), b = fbm(vG / 7000.0 + 5.0);
            col = mix(uLand, uLand2, smoothstep(0.3, 0.8, a) * 0.7);
            col = mix(col, uLand * 0.8, smoothstep(0.6, 0.85, b) * 0.35);          // darker wetland patches
            col = mix(col, uSand, smoothstep(-90.0 - fw, -20.0, s));                 // the beach
            float diff = max(dot(vec3(0.0, 1.0, 0.0), uSun), 0.0);
            col *= 0.85 + diff * 1.6;
            col += uFog * 0.06;
          } else {
            vec2 r = vec2(fbm(vG / 18.0 + uTime * 0.35), fbm(vG / 18.0 - uTime * 0.3 + 4.0)) - 0.5;
            float detail = 1.0 - smoothstep(4.0, 40.0, fw);
            vec3 n = normalize(vec3(r.x * 0.35 * detail, 1.0, r.y * 0.35 * detail));
            col = mix(uSea, uSeaFar, smoothstep(0.0, 6000.0, s));
            float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
            col = mix(col, uFog, fres * 0.6);
            float g = pow(max(dot(reflect(-V, n), uSun), 0.0), 140.0);
            col += uGlint * g * 2.2;
            col = mix(col, uSand * 1.1, (1.0 - smoothstep(0.0, 14.0 + fw, s)) * 0.7); // surf
          }
          float d = length(vW - cameraPosition);
          gl_FragColor = vec4(mix(col, uFog, smoothstep(uFogNear, uFogFar, d)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2.4e6, 2.4e6, 240, 240), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.frustumCulled = false;
    scene.add(ground);

    // ---- Clouds: a scattered deck at 2.5 km, lit from the low Sun ----
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: EARTH_R }, uSun: { value: sunDir }, uC: { value: C.metal }, uShade: { value: C.dim.clone().lerp(C.sky, 0.3) }, uWarm: { value: C.warn }, uFade: { value: 1 } },
      vertexShader: CURVED_VERT,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 uSun; uniform vec3 uC; uniform vec3 uShade; uniform vec3 uWarm; uniform float uFade;
        varying vec2 vG; varying vec3 vW;
        ${NOISE}
        void main(){
          #include <logdepthbuf_fragment>
          float n = fbm(vG / 2600.0 + vec2(3.0, 1.0)) * 0.7 + fbm(vG / 520.0) * 0.3;
          float a = smoothstep(0.56, 0.72, n);
          if (a < 0.01) discard;
          float lit = smoothstep(0.56, 0.8, fbm(vG / 520.0 + uSun.xz * 0.6));
          vec3 c = mix(uShade, uC, 0.4 + 0.6 * lit);
          c = mix(c, uWarm, 0.18);
          float d = length(vW - cameraPosition);
          gl_FragColor = vec4(c, a * 0.92 * uFade * (1.0 - smoothstep(60000.0, 400000.0, d)));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    const clouds = new THREE.Mesh(new THREE.PlaneGeometry(1.6e6, 1.6e6, 160, 160), cloudMat);
    clouds.rotation.x = -Math.PI / 2;
    clouds.position.y = 2500;
    clouds.frustumCulled = false;
    scene.add(clouds);

    // ---- Light ----
    const sun = new THREE.DirectionalLight(C.fg.clone().lerp(C.warn, 0.35), 2.4);
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(C.sky, C.metalDark, 0.7);
    scene.add(hemi);
    // Earthshine: sunlight bounced off the oceans and clouds, lighting the rocket's shaded side from below.
    const earthshine = new THREE.DirectionalLight(C.sky, 0);
    earthshine.position.set(0, -1, 0.4);
    scene.add(earthshine, earthshine.target);

    // ---- The pad: concrete, the flame trench, a lattice service tower, lightning masts, a water tower ----
    const std = (c: THREE.Color, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    const pad = new THREE.Group();
    const concrete = std(C.metal.clone().lerp(C.metalDark, 0.45), { roughness: 0.95 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(120, 2, 120), concrete);
    slab.position.y = -1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(26, 7, 26), concrete);
    deck.position.y = 3.5;
    const trench = new THREE.Mesh(new THREE.BoxGeometry(10, 7.2, 60), std(C.space));
    trench.position.set(0, 3.4, 0);
    pad.add(slab, deck, trench);
    const steel = std(C.metalDark, { metalness: 0.4, roughness: 0.55 });
    const TOWER_H = 96, TW = 10;
    const towerX = -17;
    const beams: THREE.Matrix4[] = [];
    const m4 = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0, rx = 0) =>
      beams.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz)));
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) m4(towerX + cx * TW / 2, 7 + TOWER_H / 2, cz * TW / 2, 0.7, TOWER_H, 0.7);
    for (let y = 7; y < 7 + TOWER_H; y += 6) {
      for (const cz of [-1, 1]) m4(towerX, y, cz * TW / 2, TW, 0.35, 0.35);
      for (const cx of [-1, 1]) m4(towerX + cx * TW / 2, y, 0, 0.35, 0.35, TW);
      for (const cz of [-1, 1]) m4(towerX, y + 3, cz * TW / 2, 0.25, Math.hypot(TW, 6), 0.25, Math.atan2(TW, 6) * (y % 12 ? 1 : -1));
      for (const cx of [-1, 1]) m4(towerX + cx * TW / 2, y + 3, 0, 0.25, Math.hypot(TW, 6), 0.25, 0, Math.atan2(TW, 6) * (y % 12 ? 1 : -1));
    }
    const lattice = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steel, beams.length);
    beams.forEach((m, i) => lattice.setMatrixAt(i, m));
    pad.add(lattice);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(11, 2.2, 2.4), steel);
    arm.position.set(towerX + TW / 2 + 5, 7 + 72, 0);
    pad.add(arm);
    const beacons: THREE.Mesh[] = [];
    const beaconMat = new THREE.MeshBasicMaterial({ color: C.alarm });
    for (const [x, y, z] of [[towerX, 7 + TOWER_H + 1, 0], [-60, 104, -60], [60, 104, -60], [-60, 104, 60], [60, 104, 60]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), beaconMat);
      b.position.set(x, y, z); pad.add(b); beacons.push(b);
    }
    for (const [x, z] of [[-60, -60], [60, -60], [-60, 60], [60, 60]]) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.1, 100, 8), steel);
      mast.position.set(x, 50, z); pad.add(mast);
    }
    const tank = new THREE.Group();
    const tankBody = new THREE.Mesh(new THREE.SphereGeometry(9, 20, 14), std(C.metal, { roughness: 0.5 }));
    tankBody.position.y = 52;
    tank.add(tankBody);
    for (let i = 0; i < 4; i++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 48, 6), steel); const a = (i / 4) * Math.PI * 2; leg.position.set(Math.cos(a) * 6, 24, Math.sin(a) * 6); tank.add(leg); }
    tank.position.set(-160, 0, -110);
    pad.add(tank);
    scene.add(pad);

    // ---- The rocket: first stage (engines, legs, grid fins), interstage, second stage, payload fairing ----
    const white = std(C.metal, { roughness: 0.45, metalness: 0.1 });
    const black = std(C.space.clone().lerp(C.metalDark, 0.3), { roughness: 0.6 });
    const rocket = new THREE.Group();
    const stage1 = new THREE.Group();
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 42, 32), white); s1.position.y = 21;
    const inter = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 4, 32), black); inter.position.y = 44;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.005, R * 1.005, 1.2, 32), black); band.position.y = 1.2;
    stage1.add(s1, inter, band);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9, 0.35), black); leg.position.set(Math.cos(a) * (R + 0.15), 5, Math.sin(a) * (R + 0.15)); leg.rotation.y = -a;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 1.3), black); fin.position.set(Math.cos(a) * (R + 0.7), 41, Math.sin(a) * (R + 0.7)); fin.rotation.y = -a;
      stage1.add(leg, fin);
    }
    const bellGeo = new THREE.CylinderGeometry(0.22, 0.42, 1.2, 14, 1, true);
    const bellMat = std(C.metalDark, { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2, r = i === 8 ? 0 : 1.2;
      const b = new THREE.Mesh(bellGeo, bellMat); b.position.set(Math.cos(a) * r, -0.5, Math.sin(a) * r); stage1.add(b);
    }
    const upper = new THREE.Group();
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 12, 32), white); s2.position.y = 52;
    const fairing = new THREE.Mesh(
      new THREE.LatheGeometry([[R, 0], [2.6, 1.5], [2.6, 7], [2.3, 9.5], [1.5, 11.6], [0.5, 12.8], [0, 13]].map(([r, y]) => new THREE.Vector2(r, y)), 40),
      white,
    );
    fairing.position.y = 58 - 1;
    const mvac = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.25, 3.2, 20, 1, true), std(C.metalDark, { metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide }));
    mvac.position.y = 44.5; mvac.visible = false;
    upper.add(s2, fairing, mvac);
    rocket.add(stage1, upper);
    rocket.scale.setScalar(ROCKET_SCALE); // a heavy-lift rocket, ~95 m: it stands well above the tower's arm
    scene.add(rocket);

    // Exhaust: plume, a bright core at the engines, and a light that floods the pad and the smoke.
    const plumeMat = plumeMaterial(C.fg.clone().lerp(C.metal, 0.4), C.warn.clone().lerp(C.alarm, 0.25));
    const plume = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 4.5, 40, 32, 16, true), plumeMat);
    const plumeGroup = new THREE.Group();
    plumeGroup.add(plume);
    stage1.add(plumeGroup);
    const sprite = softSprite(), puff = puffSprite();
    const coreMat = new THREE.SpriteMaterial({ map: sprite, color: C.fg, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Sprite(coreMat);
    core.position.y = -2.5;
    stage1.add(core);
    const fireLight = new THREE.PointLight(C.warn, 0, 900, 1.4);
    fireLight.position.y = -6;
    stage1.add(fireLight);
    const vacMat = plumeMaterial(C.fg.clone().lerp(C.metal, 0.3), C.sky.clone().lerp(C.warn, 0.5));
    vacMat.uniforms.diamonds.value = 0;
    const vacPlume = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 14, 70, 32, 12, true), vacMat);
    vacPlume.position.y = 44.5 - 1.6 - 35; vacPlume.visible = false;
    upper.add(vacPlume);

    // Smoke and steam from the flame trench (and oxygen vapour drifting off the rocket on the pad).
    interface Puff { s: THREE.Sprite; m: THREE.SpriteMaterial; v: THREE.Vector3; age: number; life: number; size: number; grow: number; on: boolean }
    const puffs: Puff[] = [];
    const smokeC = C.metal.clone().lerp(C.dim, 0.25);
    for (let i = 0; i < 170; i++) {
      const m = new THREE.SpriteMaterial({ map: puff, color: smokeC, transparent: true, opacity: 0, depthWrite: false, rotation: Math.random() * 6.28 });
      const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
      puffs.push({ s, m, v: new THREE.Vector3(), age: 0, life: 1, size: 1, grow: 1, on: false });
    }
    let nextPuff = 0;
    const emit = (p: THREE.Vector3, v: THREE.Vector3, size: number, grow: number, life: number) => {
      const q = puffs[nextPuff]; nextPuff = (nextPuff + 1) % puffs.length;
      q.s.position.copy(p); q.v.copy(v); q.age = 0; q.life = life; q.size = size; q.grow = grow; q.on = true; q.s.visible = true;
    };

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    // ---- Loop ----
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true, emitAcc = 0, ventAcc = 0;
    const zen = new THREE.Color(), hor = new THREE.Color(), fogC = new THREE.Color();
    const groundCam = new THREE.Vector3(-520, 34, 430); // a camera site on a rise south-west of the pad
    const fwd = new THREE.Vector3(), side = new THREE.Vector3(0, 0, 1), camWant = new THREE.Vector3(), lookWant = new THREE.Vector3();
    const camPos = new THREE.Vector3(), look = new THREE.Vector3(), jitter = new THREE.Vector3(), tmp = new THREE.Vector3();
    const s1Drop = { on: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: 0 };
    let shot = -1;
    const ORIGIN = new THREE.Vector3();

    function frame(now: number) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const T = (now - t0) / 1000;
      const { stage, t } = launchClock(T);
      const { alt, v } = ascentAt(t);
      const x = downrangeAt(t);
      const pitch = (pitchAt(t) * Math.PI) / 180;
      const lit = t >= EVENTS.ignite && t < EVENTS.meco;
      const thrust = t < EVENTS.ignite ? 0 : clamp((t - EVENTS.ignite) / 2.4);
      const sep = t >= EVENTS.sep, ses = t >= EVENTS.ses;

      // Air and light change with height: dawn blue below, black above ~60 km, a thin blue limb.
      zen.copy(C.sky).multiplyScalar(0.42).lerp(C.space, smooth(4_000, 60_000, alt));
      hor.copy(C.sky).lerp(C.fg, 0.28).lerp(C.sky.clone().multiplyScalar(0.35), smooth(10_000, 90_000, alt));
      skyMat.uniforms.zen.value.copy(zen); skyMat.uniforms.hor.value.copy(hor);
      skyMat.uniforms.dip.value = Math.sqrt((2 * alt) / EARTH_R);
      skyMat.uniforms.limbK.value = smooth(15_000, 70_000, alt) * 0.9;
      skyMat.uniforms.warmK.value = 1 - smooth(5_000, 50_000, alt) * 0.6;
      (stars.material as THREE.PointsMaterial).opacity = smooth(35_000, 90_000, alt) * 0.85;
      fogC.copy(hor);
      groundMat.uniforms.uFog.value.copy(fogC);
      groundMat.uniforms.uFogNear.value = 2_000 + alt * 0.6; groundMat.uniforms.uFogFar.value = 60_000 + alt * 7;
      groundMat.uniforms.uTime.value = T;
      cloudMat.uniforms.uFade.value = 1;
      hemi.intensity = 0.7 - 0.45 * smooth(10_000, 80_000, alt);
      earthshine.intensity = 1.3 * smooth(3_000, 40_000, alt);
      earthshine.target.position.copy(rocket.position); earthshine.position.copy(rocket.position).add(tmp.set(0, -100, 40));

      // The rocket: up, then over toward the sea (east, +x) in the gravity turn.
      rocket.position.set(x, alt + 7, 0);
      rocket.rotation.set(0, 0, -pitch);
      fwd.set(Math.sin(pitch), Math.cos(pitch), 0);

      // Exhaust: short and tight in thick air; wider and longer as the air thins.
      const thin = smooth(5_000, 60_000, alt);
      plumeGroup.visible = lit && !sep;
      plumeMat.uniforms.k.value = thrust * (1.25 + 0.15 * Math.sin(T * 60)); plumeMat.uniforms.time.value = T;
      plume.scale.set(1 + thin * 3.5, 1 + thin * 1.6, 1 + thin * 3.5);
      plume.position.y = -1.2 - 20 * plume.scale.y;
      plumeMat.uniforms.diamonds.value = 1 - thin;
      coreMat.opacity = lit && !sep ? clamp(thrust * 1.3) : 0;
      core.scale.setScalar(10 + thrust * 18 + thin * 20);
      fireLight.intensity = lit && !sep ? thrust * 9000 * (1 - thin * 0.9) : 0;
      mvac.visible = sep; vacPlume.visible = ses;
      vacMat.uniforms.k.value = ses ? clamp((t - EVENTS.ses) / 2) * 1.2 : 0; vacMat.uniforms.time.value = T;

      // Stage separation: the first stage drops away, tumbling slowly; the second stage flies on.
      if (sep && !s1Drop.on) {
        s1Drop.on = true;
        scene.attach(stage1);
        s1Drop.pos.copy(stage1.position); s1Drop.vel.copy(fwd).multiplyScalar(-6);
      }
      if (s1Drop.on) {
        // Shown in the rocket's moving frame: it falls behind and below, drifting off.
        s1Drop.vel.addScaledVector(fwd, -dt * 4); s1Drop.spin += dt * 0.25;
        stage1.position.copy(rocket.position).add(tmp.copy(s1Drop.vel).multiplyScalar(Math.min(6, t - EVENTS.sep)));
        stage1.position.y -= 46 * ROCKET_SCALE;
        stage1.rotation.set(s1Drop.spin * 0.6, 0, -pitch + s1Drop.spin);
      }

      // Smoke and steam: vapour off the rocket on the pad; at ignition, clouds roll out of both ends of the
      // flame trench and up around the pad; after liftoff, the exhaust trail lingers in the low air.
      ventAcc += dt;
      if (t < EVENTS.liftoff && ventAcc > 0.06) {
        ventAcc = 0;
        emit(tmp.set(R * ROCKET_SCALE * (Math.random() < 0.5 ? 1 : -1), 7 + (46 + Math.random() * 10) * ROCKET_SCALE, (Math.random() - 0.5) * 2), new THREE.Vector3(1.2 + Math.random(), -0.6, 0.6), 2.5, 2.2, 2.6);
      }
      if (thrust > 0 && alt < 1500) {
        emitAcc += dt * (40 + 60 * thrust);
        while (emitAcc > 1) {
          emitAcc -= 1;
          const end = Math.random() < 0.5 ? 1 : -1;
          if (alt < 60) emit(tmp.set((Math.random() - 0.5) * 8, 3, end * (28 + Math.random() * 4)), new THREE.Vector3((Math.random() - 0.5) * 12, 4 + Math.random() * 6, end * (24 + Math.random() * 26)), 12, 14 + Math.random() * 10, 5 + Math.random() * 3);
          else emit(tmp.set(rocket.position.x + (Math.random() - 0.5) * 3, rocket.position.y - 30 - Math.random() * 20, (Math.random() - 0.5) * 3), new THREE.Vector3((Math.random() - 0.5) * 2, -2, (Math.random() - 0.5) * 2), 8, 4, 7);
        }
      }
      const glowNear = thrust * (1 - smooth(200, 900, alt));
      for (const q of puffs) {
        if (!q.on) continue;
        q.age += dt;
        if (q.age > q.life) { q.on = false; q.s.visible = false; continue; }
        q.v.multiplyScalar(1 - dt * 0.5); q.v.y += dt * 1.2;
        q.s.position.addScaledVector(q.v, dt);
        q.s.scale.setScalar(q.size + q.grow * q.age);
        const a = Math.min(1, q.age * 3) * (1 - q.age / q.life);
        q.m.opacity = a * 0.85;
        const near = Math.max(0, 1 - q.s.position.distanceTo(rocket.position) / 120);
        q.m.color.copy(smokeC).lerp(C.warn, near * glowNear * 0.8);
      }
      beacons.forEach((b, i) => { b.visible = Math.sin(T * 4 + i) > 0; });

      // Camera: 0 = ground, long lens, wide on the pad; 1 = tracking the rocket up; 2 = chase beside it.
      // The chase camera eases in the rocket's own frame (offsets from it), so it never falls behind at 2 km/s.
      const want = stage === 'ascent' && alt > 1800 ? 2 : stage === 'rise' ? 1 : 0;
      if (want !== shot) { shot = want; camPos.set(NaN, 0, 0); }
      let fov = 35;
      const base = shot === 2 ? rocket.position : ORIGIN;
      if (shot === 0) {
        camWant.copy(groundCam); lookWant.set(60, 40, 0);
      } else if (shot === 1) {
        camWant.copy(groundCam);
        lookWant.copy(rocket.position).addScaledVector(fwd, 30);
        fov = 35 - 24 * smooth(30, 1200, alt);
      } else {
        // Behind, beside and a little above, looking ahead along the flight path: the rocket in front, the Earth
        // curving away below it, black sky and the blue limb above.
        camWant.set(0, 0, 0).addScaledVector(fwd, -10).add(tmp.set(0, 26, 0)).addScaledVector(side.set(0, 0, 1), 70);
        lookWant.set(0, 0, 0).addScaledVector(fwd, 30).add(tmp.set(0, -38, 0));
        fov = 44;
      }
      if (Number.isNaN(camPos.x)) { camPos.copy(camWant); look.copy(lookWant); }
      const ease = 1 - Math.exp(-dt * (shot === 1 ? 14 : 4));
      camPos.lerp(camWant, ease); look.lerp(lookWant, ease);
      const shake = (shot === 0 ? thrust * 0.6 : shot === 1 ? thrust * 0.35 * (1 - smooth(200, 2500, alt)) : 0.06 * (lit ? 1 : 0)) + (t > 60 && t < 84 ? 0.25 : 0);
      jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake);
      camera.position.copy(base).add(camPos).add(jitter);
      camera.lookAt(tmp.copy(base).add(look));
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sky.position.copy(camera.position); stars.position.copy(camera.position);
      sun.target.position.copy(rocket.position); sun.position.copy(rocket.position).addScaledVector(sunDir, 200);

      // Overlays: the count, the telemetry, what is happening, and the fade at the end.
      if (count.current) count.current.textContent = t < EVENTS.liftoff ? `T−${Math.ceil(-t)}` : t < 3 ? 'LIFTOFF' : '';
      if (hud.current) {
        hud.current.textContent = t < EVENTS.liftoff ? '' : [
          `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
          `ALT     ${alt >= 10_000 ? (alt / 1000).toFixed(1) : (alt / 1000).toFixed(2)} km`,
          `SPEED   ${v >= 1000 ? `${(v / 1000).toFixed(2)} km/s` : `${Math.round(v)} m/s`}`,
          `PITCH   ${pitchAt(t).toFixed(0)}°`,
        ].join('\n');
      }
      if (cap.current) cap.current.textContent = launchEvent(t);
      if (fade.current) fade.current.style.opacity = String(smooth(LAUNCH_MS / 1000 - 0.7, LAUNCH_MS / 1000, T));

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
      sprite.dispose(); puff.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div ref={host} className={`launch-scene${active ? ' on' : ''}`} aria-hidden="true">
      <p ref={count} className="launch-count" />
      <pre ref={hud} className="launch-hud" />
      <p ref={cap} className="launch-cap" />
      <p className="launch-note">ILLUSTRATIVE LAUNCH · generic two-stage rocket, typical ascent profile · sped up ~20×</p>
      <div ref={fade} className="launch-fade" />
    </div>
  );
}
