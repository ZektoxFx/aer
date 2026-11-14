// The crash, rendered in 3D (three.js) from the physics in edl.ts (Map/Aiman).
// It opens on a wide shot: the capsule high above the curved limb of Mars, a thin glowing band of atmosphere on the
// horizon. The camera closes in as the air thickens and the heating builds:
//   entry: the air piles up in front of the heat shield into a glowing shock layer, and a long flickering plasma
//          trail and streaks of burning shield stream off behind (brightness follows the simulated heating);
//   parachute: a 21.5 m canopy in orange and white gores, like Mars 2020's, snaps open, then tears away;
//   heat shield drops; retro-rockets sputter; the ground rushes up; impact: dust and pieces fly under Mars gravity.
// The ground curves away with the planet (each vertex drops by d²/2R) and is drawn by a shader: large light and dark
// regions, craters at two sizes and fine mottling, with no repeating tile. Below about 20 km the real HiRISE photo of
// the crash site fades in under the capsule. The telemetry is the simulated run, sped up. Failures are game fiction.
// Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { AFTER_S, CRASH_RUN as RUN, CRASH_SEG as SEG, crashTime, edlAt, FLY_S, MARS_G, MARS_R } from './edl';

/** The map's HiRISE photo: 6.4 × 4.0 km, and where the AER-1 cabin sits in it (metres from the north-west corner). */
const PHOTO = { w: 6400, h: 4000, cabinX: 3060, cabinY: 2170 };
/** Seconds of the opening wide shot before the camera settles beside the capsule. */
const OPEN_S = 1.8;

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
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  rg.addColorStop(0.5, 'rgba(255,255,255,0.15)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const NOISE = /* glsl */ `
  float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; } return s; }
`;

/** Glow shell: brightest where seen edge-on (fresnel), flickering, additive. */
function glowMaterial(color: THREE.Color, power: number) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, k: { value: 0 }, time: { value: 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform vec3 color; uniform float k; uniform float time; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        #include <logdepthbuf_fragment>
        float f = pow(1.0 - abs(dot(vN, vV)), ${power.toFixed(1)});
        float n = 0.75 + 0.25*sin(vP.y*3.0 - time*40.0 + sin(vP.x*5.0+time*13.0));
        gl_FragColor = vec4(color * f * n * k, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

/** Plasma trail: a soft flame that fades along its length and toward its edges, with streaks running down it. */
function trailMaterial(hot: THREE.Color, warm: THREE.Color, red: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { hot: { value: hot }, warm: { value: warm }, red: { value: red }, k: { value: 0 }, time: { value: 0 } },
    vertexShader: `#include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `#include <logdepthbuf_pars_fragment>
      uniform vec3 hot; uniform vec3 warm; uniform vec3 red; uniform float k; uniform float time;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      void main(){
        #include <logdepthbuf_fragment>
        float along = 1.0 - vUv.y;               // 0 at the capsule, 1 at the tail
        float face = abs(dot(normalize(vN), normalize(vV)));
        float n = vnoise(vec2(vUv.x * 22.0, along * 5.0 - time * 9.0)) * 0.6 + vnoise(vec2(vUv.x * 57.0, along * 13.0 - time * 19.0)) * 0.4;
        float a = pow(1.0 - along, 1.7) * pow(face, 1.6) * (0.35 + 0.9 * n);
        vec3 c = mix(hot, warm, smoothstep(0.0, 0.3, along));
        c = mix(c, red, smoothstep(0.3, 1.0, along));
        gl_FragColor = vec4(c * a * k, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function CrashSequence({ active }: { active: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLPreElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const dark = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || !active) return;
    const C = {
      space: css('--space'), sky: css('--mars-sky'), sand: css('--mars-sand'), rust: css('--mars-rust'), shadow: css('--mars-shadow'),
      dust: css('--mars-dust'), metal: css('--metal'), metalDark: css('--metal-dark'), alarm: css('--alarm'), warn: css('--warning'),
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 4e6);

    // ---- Sky: black space high up, butterscotch dust near the ground, the Sun, and the glowing limb ----
    const sunDir = new THREE.Vector3(-0.55, 0.32, 0.55).normalize();
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        zen: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sun: { value: sunDir }, sunC: { value: C.dust },
        limb: { value: C.dust.clone().lerp(C.sky, 0.4) }, limbK: { value: 0 }, dip: { value: 0 },
      },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 zen; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunC; uniform vec3 limb; uniform float limbK; uniform float dip; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float e = d.y + dip;          // 0 on the true horizon
          vec3 c = mix(hor, zen, smoothstep(-0.01, 0.4, e));
          c += limb * limbK * (exp(-abs(e) * 70.0) * 1.2 + exp(-max(e, 0.0) * 9.0) * 0.25); // the lit air on the limb
          float s = max(dot(d, sun), 0.0); c += sunC * (pow(s, 900.0) * 2.4 + pow(s, 14.0) * 0.16);
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1e6, 48, 24), skyMat);
    sky.renderOrder = -2;
    scene.add(sky);
    const starPts: number[] = [];
    for (let i = 0; i < 2200; i++) { const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.95 - 0.05, Math.random() - 0.5).normalize().multiplyScalar(9e5); starPts.push(v.x, v.y, v.z); }
    const stars = new THREE.Points(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPts, 3)),
      new THREE.PointsMaterial({ color: C.dust, size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0.8, fog: false, depthWrite: false, depthTest: false }),
    );
    stars.renderOrder = -1;
    scene.add(stars);

    // ---- Ground: a curved, shader-drawn Mars with the crash site's HiRISE photo under the capsule ----
    const photo = new THREE.TextureLoader().load('/data/jezero_base_2m.jpg');
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const finalX = RUN.samples[RUN.samples.length - 1].x;
    const groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uR: { value: MARS_R }, uOff: { value: new THREE.Vector2() }, uSun: { value: sunDir },
        uSand: { value: C.sand }, uRust: { value: C.rust }, uShadow: { value: C.shadow }, uDust: { value: C.dust },
        uFog: { value: new THREE.Color() }, uFogNear: { value: 0 }, uFogFar: { value: 1 },
        uPhoto: { value: photo }, uPhotoK: { value: 0 },
        uPhotoO: { value: new THREE.Vector2(finalX - PHOTO.cabinX, -PHOTO.cabinY) }, uPhotoS: { value: new THREE.Vector2(PHOTO.w, PHOTO.h) },
        uAmb: { value: 0.35 },
      },
      vertexShader: `#include <common>
        #include <logdepthbuf_pars_vertex>
        uniform float uR; uniform vec2 uOff; varying vec2 vG; varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vec2 d = w.xz - cameraPosition.xz;
          w.y -= dot(d, d) / (2.0 * uR);                 // the planet curving away
          vW = w.xyz; vG = w.xz + uOff;                  // ground coordinates: the capsule flies along +x
          gl_Position = projectionMatrix * viewMatrix * w;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `#include <logdepthbuf_pars_fragment>
        uniform vec3 uSun; uniform vec3 uSand; uniform vec3 uRust; uniform vec3 uShadow; uniform vec3 uDust;
        uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform float uAmb;
        uniform sampler2D uPhoto; uniform float uPhotoK; uniform vec2 uPhotoO; uniform vec2 uPhotoS;
        varying vec2 vG; varying vec3 vW;
        ${NOISE}
        // Craters on a jittered grid: a dark bowl and a bright raised rim, about half the cells have one.
        float crater(vec2 p, float keep){ vec2 i = floor(p), f = fract(p); float r = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 c = i + g;
            if (hash(c + 3.7) > keep) continue;
            vec2 o = vec2(hash(c), hash(c + 19.19)); float z = hash(c + 7.3); float s = 0.08 + 0.38 * z * z;
            float l = length(g + o - f) / s;
            r += (smoothstep(0.72, 1.0, l) * smoothstep(1.4, 1.0, l) * 0.5 - (1.0 - smoothstep(0.0, 0.92, l)) * 0.4) * (0.5 + z);
          } return r; }
        float height(vec2 g, float detail){
          float h = fbm(g / 9000.0) * 1.3 + crater(g / 7000.0, 0.28) * 0.8;
          h += crater(g / 1100.0 + 31.0, 0.22) * 0.45 * detail + (fbm(g / 240.0) - 0.5) * 0.3 * detail;
          return h; }
        void main(){
          #include <logdepthbuf_fragment>
          float fw = length(fwidth(vG));
          float detail = 1.0 - smoothstep(60.0, 260.0, fw);         // drop the small features where they would shimmer
          float h = height(vG, detail);
          float e = max(40.0, fw * 1.5);
          float hx = height(vG + vec2(e, 0.0), detail) - h, hz = height(vG + vec2(0.0, e), detail) - h;
          vec3 n = normalize(vec3(-hx * 700.0 / e, 1.0, -hz * 700.0 / e));
          float a = fbm(vG / 26000.0), b = fbm(vG / 3200.0 + 7.0), m = fbm(vG / 900.0 + 3.0);
          vec3 col = mix(uRust * 0.78, uSand, smoothstep(0.3, 0.75, a));
          col = mix(col, uShadow * 1.15, smoothstep(0.52, 0.8, b) * 0.55);   // dark basaltic patches
          col = mix(col, uDust, smoothstep(0.6, 0.85, m) * 0.22 * detail);  // bright dust
          col *= 1.0 + crater(vG / 7000.0, 0.28) * 0.1;
          // The crash site: the real HiRISE photo, tinted, fading in at low altitude, feathered at its edges.
          vec2 uv = (vG - uPhotoO) / uPhotoS; uv.y = 1.0 - uv.y;
          vec2 edge = smoothstep(vec2(0.0), vec2(0.12), uv) * smoothstep(vec2(0.0), vec2(0.12), 1.0 - uv);
          float pk = uPhotoK * edge.x * edge.y;
          if (pk > 0.001) {
            float lum = dot(texture2D(uPhoto, uv).rgb, vec3(0.333));
            vec3 pc = mix(uShadow * 0.9, uSand * 1.2, lum);
            col = mix(col, pc, pk); n = normalize(mix(n, vec3(0.0, 1.0, 0.0), pk)); // the photo carries its own shading
          }
          float diff = max(dot(n, uSun), 0.0);
          col *= uAmb + diff * 1.15;
          float d = length(vW - cameraPosition);
          float f = smoothstep(uFogNear, uFogFar, d);
          gl_FragColor = vec4(mix(col, uFog, f), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const GROUND = 1.8e6;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND, 240, 240), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.frustumCulled = false;
    scene.add(ground);
    scene.fog = new THREE.Fog(C.sky, 1000, 50000);

    // ---- Light ----
    const sun = new THREE.DirectionalLight(C.dust, 2.6);
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(C.sky, C.rust, 0.5);
    scene.add(hemi);

    // ---- The capsule: 4.5 m across, 70° heat shield, conical backshell (local +y = from shield to backshell) ----
    const capsule = new THREE.Group();
    const shieldMat = new THREE.MeshStandardMaterial({ color: C.shadow.clone().lerp(C.rust, 0.35), roughness: 0.95, emissive: C.warn, emissiveIntensity: 0 });
    const shieldProfile = [[0, 0], [0.6, 0.05], [1.6, 0.32], [2.25, 0.56], [2.25, 0.64]].map(([r, y]) => new THREE.Vector2(r, y));
    const shield = new THREE.Mesh(new THREE.LatheGeometry(shieldProfile, 48), shieldMat);
    const backMat = new THREE.MeshStandardMaterial({ color: C.metal, roughness: 0.5, metalness: 0.2, emissive: C.warn, emissiveIntensity: 0 });
    const backshell = new THREE.Mesh(
      new THREE.LatheGeometry([[2.2, 0.64], [1.9, 1.25], [1.2, 2.35], [0.95, 2.45], [0.9, 2.85], [0, 2.9]].map(([r, y]) => new THREE.Vector2(r, y)), 48),
      backMat,
    );
    capsule.add(shield, backshell);
    const shieldGlow = new THREE.PointLight(C.warn, 0, 80, 1.6);
    shieldGlow.position.set(0, -2, 0);
    capsule.add(shieldGlow);
    // Shock layer: a soft rim shell plus a bright core in front of the heat shield.
    const shockMat = glowMaterial(C.dust.clone().lerp(C.warn, 0.3), 2.2);
    const shock = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), shockMat);
    shock.scale.set(3.3, 1.9, 3.3); shock.position.y = 0.35;
    const sprite = softSprite();
    const coreMat = new THREE.SpriteMaterial({ map: sprite, color: C.dust.clone().lerp(C.warn, 0.25), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Sprite(coreMat);
    core.position.set(0, -0.6, 0);
    const haloMat = new THREE.SpriteMaterial({ map: sprite, color: C.warn.clone().lerp(C.alarm, 0.35), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const halo = new THREE.Sprite(haloMat);
    halo.position.set(0, 1.5, 0);
    // The plasma trail streaming behind, 140 m long, wide at the capsule.
    const TRAIL = 140;
    const trailMat = trailMaterial(C.dust.clone().lerp(C.warn, 0.15), C.warn, C.alarm.clone().lerp(C.rust, 0.4));
    const trail = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.2, TRAIL, 48, 24, true), trailMat);
    trail.position.y = 2 + TRAIL / 2;
    capsule.add(shock, core, halo, trail);
    // Streaks of burning shield: short lines, bright at the head, fading to nothing at the tail.
    const SPARKS = 320;
    const sp = { a: new Float32Array(SPARKS), r: new Float32Array(SPARKS), y: new Float32Array(SPARKS), v: new Float32Array(SPARKS) };
    const streakPos = new Float32Array(SPARKS * 6), streakCol = new Float32Array(SPARKS * 6);
    const resetSpark = (i: number, y0 = 0) => { sp.a[i] = Math.random() * Math.PI * 2; sp.r[i] = 1.6 + Math.random() * 1.0; sp.y[i] = y0; sp.v[i] = 40 + Math.random() * 90; };
    for (let i = 0; i < SPARKS; i++) {
      resetSpark(i, Math.random() * 120);
      const hot = Math.random() < 0.3 ? C.dust : C.warn;
      hot.toArray(streakCol, i * 6);
      C.alarm.clone().multiplyScalar(0.05).toArray(streakCol, i * 6 + 3);
    }
    const streakGeo = new THREE.BufferGeometry()
      .setAttribute('position', new THREE.BufferAttribute(streakPos, 3))
      .setAttribute('color', new THREE.BufferAttribute(streakCol, 3));
    const streakMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const streaks = new THREE.LineSegments(streakGeo, streakMat);
    streaks.frustumCulled = false;
    capsule.add(streaks);
    // Retro-rocket plumes under the backshell (after the shield is gone).
    const plumeMat = glowMaterial(C.dust.clone().lerp(C.warn, 0.3), 1.2);
    const plumes = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(new THREE.ConeGeometry(0.35, 6, 16, 1, true), plumeMat);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      p.position.set(Math.cos(a) * 1.5, -2.4, Math.sin(a) * 1.5); p.rotation.x = Math.PI;
      plumes.add(p);
    }
    capsule.add(plumes);
    scene.add(capsule);

    // ---- Parachute: 21.5 m canopy, orange and white gores (lines shortened a little to keep it in frame) ----
    const chute = new THREE.Group();
    const CR = 10.75, CAP = Math.PI * 0.42, LINE_TOP = 30;
    const canopyGeo = new THREE.SphereGeometry(CR, 48, 12, 0, Math.PI * 2, 0, CAP);
    {
      const pos = canopyGeo.attributes.position as THREE.BufferAttribute, colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i)), gore = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 20) % 2;
        const vent = pos.getY(i) / CR > 0.93;
        (gore || vent ? C.dust : C.alarm).toArray(colors, i * 3);
      }
      canopyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    canopy.position.y = LINE_TOP - CR * Math.cos(CAP); // rim sits at LINE_TOP
    const rimR = CR * Math.sin(CAP), linePts: THREE.Vector3[] = [];
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; linePts.push(new THREE.Vector3(0, 3, 0), new THREE.Vector3(Math.cos(a) * rimR, LINE_TOP, Math.sin(a) * rimR)); }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: C.dust, transparent: true, opacity: 0.55 }));
    chute.add(canopy, lines);
    chute.visible = false;
    scene.add(chute);

    // ---- Impact: dust cloud and pieces thrown under Mars gravity ----
    const DUST = 700;
    const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST * 3);
    const dustGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({ map: sprite, color: C.sand.clone().lerp(C.dust, 0.35), size: 7, transparent: true, opacity: 0, depthWrite: false });
    const dustCloud = new THREE.Points(dustGeo, dustMat);
    dustCloud.frustumCulled = false;
    scene.add(dustCloud);
    const debris: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2 + Math.random() * 1.2, 0.05, 0.2 + Math.random() * 0.8), new THREE.MeshStandardMaterial({ color: Math.random() < 0.6 ? C.metal : C.metalDark, roughness: 0.5, metalness: 0.4 }));
      m.visible = false; scene.add(m);
      debris.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
    }
    const droppedShield = new THREE.Mesh(shield.geometry, shieldMat);
    droppedShield.visible = false;
    scene.add(droppedShield);
    let shieldDrop: { y: number; vy: number; x: number } | null = null;

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();

    // ---- Loop ----
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true, impactAt = -1, tumble = 0, chuteGone = 0;
    const hor = new THREE.Color(), zen = new THREE.Color(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), vdir = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0), camPos = new THREE.Vector3(), camWant = new THREE.Vector3(), jitter = new THREE.Vector3();
    const look = new THREE.Vector3(), lookWant = new THREE.Vector3(), eu = new THREE.Euler();
    const skyDim = C.sky.clone().multiplyScalar(0.55), horDim = C.sky.clone().multiplyScalar(0.3);
    let camInit = false;

    function frame(now: number) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const T = (now - t0) / 1000;
      const { t, seg, f } = crashTime(T);
      const s = edlAt(RUN, t);
      const impacted = T >= FLY_S;
      if (impacted && impactAt < 0) {
        impactAt = T;
        for (let i = 0; i < DUST; i++) {
          const a = Math.random() * Math.PI * 2, v = 6 + Math.random() * 30;
          dustPos.set([Math.cos(a) * 2, 0.5, Math.sin(a) * 2], i * 3);
          dustVel.set([Math.cos(a) * v, 2 + Math.random() * 10, Math.sin(a) * v], i * 3);
        }
        debris.forEach((d) => { const a = Math.random() * Math.PI * 2, v = 8 + Math.random() * 22; d.m.position.set(0, 1.5, 0); d.v.set(Math.cos(a) * v, 6 + Math.random() * 16, Math.sin(a) * v); d.m.visible = true; });
      }
      const since = impacted ? T - impactAt : 0;
      const alt = impacted ? 0 : s.h;
      const u = clamp(Math.log10(Math.max(alt, 1)) / Math.log10(125_000));

      // Air and light change with height: black with a glowing limb above, hazy butterscotch below.
      zen.copy(C.space).lerp(skyDim, 1 - smooth(6_000, 70_000, alt));   // the dusty sky closes in below ~70 km
      hor.copy(horDim).lerp(C.sky, 1 - smooth(3_000, 95_000, alt));
      skyMat.uniforms.zen.value.copy(zen); skyMat.uniforms.hor.value.copy(hor);
      skyMat.uniforms.dip.value = Math.sqrt((2 * Math.max(alt, 0)) / MARS_R); // how far the horizon sits below level
      skyMat.uniforms.limbK.value = smooth(8_000, 60_000, alt);
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(hor); fog.far = 14_000 + alt * 5; fog.near = 300 + alt * 0.4;
      groundMat.uniforms.uFog.value.copy(hor);
      groundMat.uniforms.uFogNear.value = fog.near; groundMat.uniforms.uFogFar.value = fog.far;
      groundMat.uniforms.uPhotoK.value = 1 - smooth(4_000, 22_000, alt);
      groundMat.uniforms.uAmb.value = 0.3 + 0.25 * (1 - u);
      (stars.material as THREE.PointsMaterial).opacity = clamp((u - 0.6) * 2.5) * 0.9;
      hemi.intensity = 0.25 + 0.6 * (1 - u);

      // The capsule stays at x = 0; the ground slides under it (offset = distance flown downrange).
      groundMat.uniforms.uOff.value.set(s.x, 0);
      capsule.position.set(0, impacted ? 1.2 : Math.max(alt, 2.2), 0);

      // Attitude: heat shield into the airflow during entry; hanging under the chute; tumbling once it tears.
      vdir.set(s.vx, s.vh, 0).normalize();
      if (seg === 0) q.setFromUnitVectors(down, vdir);
      else if (s.chute === 'open') q.setFromEuler(eu.set(Math.sin(T * 5) * 0.08, 0, Math.sin(T * 3.3) * 0.1));
      else if (!impacted) { tumble += dt * (s.thrust ? 0.5 : 1.6); q.setFromEuler(eu.set(Math.sin(tumble * 1.7) * 0.35, tumble * 0.4, Math.sin(tumble * 2.3) * 0.3)); }
      else q.setFromEuler(eu.set(0, 0.4, Math.min(1.2, since * 3)));
      if (seg === 0) capsule.quaternion.copy(q); else capsule.quaternion.slerp(q, impacted ? 0.3 : 0.15);

      // Ball of fire: brightness follows the simulated heating (with a faint glow from the start, so it reads).
      const heat = impacted ? 0 : s.heat;
      const fire = seg === 0 ? Math.max(heat, 0.12 * smooth(0, 1.2, T)) : heat;
      const flick = 0.85 + 0.15 * Math.sin(T * 47) * Math.sin(T * 31);
      shockMat.uniforms.k.value = fire * 2.2 * flick; shockMat.uniforms.time.value = T;
      trailMat.uniforms.k.value = fire * 1.6; trailMat.uniforms.time.value = T;
      trail.scale.set(0.8 + fire * 0.5, 0.35 + fire * 0.75, 0.8 + fire * 0.5); trail.position.y = 2 + (TRAIL / 2) * trail.scale.y;
      coreMat.opacity = clamp(fire * 1.4) * flick; core.scale.setScalar(5 + fire * 13);
      haloMat.opacity = clamp(fire * 0.9); halo.scale.setScalar(14 + fire * 30);
      shieldGlow.intensity = fire * 1100;
      shieldMat.emissiveIntensity = fire * 1.4; backMat.emissiveIntensity = fire * 0.35;
      streakMat.opacity = clamp(fire * 1.5);
      if (fire > 0.01) {
        for (let i = 0; i < SPARKS; i++) {
          sp.y[i] += sp.v[i] * dt * (0.5 + fire);
          if (sp.y[i] > 130) resetSpark(i);
          const r = sp.r[i] + sp.y[i] * 0.05, x = Math.cos(sp.a[i]) * r, z = Math.sin(sp.a[i]) * r, len = sp.v[i] * 0.06 * (0.4 + fire);
          streakPos.set([x, sp.y[i], z, x * 0.98, sp.y[i] + len, z * 0.98], i * 6);
        }
        streakGeo.attributes.position.needsUpdate = true;
      }
      if (glow.current) glow.current.style.opacity = String(clamp(heat * 0.9));

      // Parachute: opens fast, holds, then tears away (it rises off as the capsule falls on without it).
      if (seg >= 1 && !impacted) {
        chute.visible = true;
        const open = seg === 1 ? clamp(f * 4) : 1;
        canopy.scale.setScalar(0.15 + 0.85 * open);
        if (seg >= 2) chuteGone += dt;
        chute.position.set(capsule.position.x - chuteGone * 25, capsule.position.y + chuteGone * 60, chuteGone * 10);
        chute.rotation.set(chuteGone * 0.8, 0, Math.sin(T * 2) * 0.05 + chuteGone * 0.6);
        lines.visible = seg === 1;
        if (chuteGone > 2.5) chute.visible = false;
      } else chute.visible = false;
      // Heat shield drops away soon after the chute opens, falling under gravity.
      if (seg === 1 && f > 0.4 && !shieldDrop) { shieldDrop = { y: capsule.position.y - 1.5, vy: 0, x: 0 }; shield.visible = false; droppedShield.visible = true; }
      if (shieldDrop) {
        shieldDrop.vy -= MARS_G * 10 * dt; shieldDrop.y += shieldDrop.vy * dt; shieldDrop.x += dt * 2;
        droppedShield.position.set(shieldDrop.x, Math.max(0.3, shieldDrop.y), 1);
        droppedShield.rotation.x += dt * 0.7;
        if (shieldDrop.y < capsule.position.y - 400) droppedShield.visible = false;
      }
      // Retro-rockets: on only when the simulation fires them (the damaged engine stutters).
      plumes.visible = s.thrust && !impacted;
      plumeMat.uniforms.k.value = 1.4; plumeMat.uniforms.time.value = T;
      plumes.scale.set(1, 0.7 + Math.random() * 0.6, 1);

      // Impact: dust and pieces fly under Mars gravity, the dust slowed by the thin air.
      if (impacted) {
        dustMat.opacity = Math.max(0, 0.85 - since * 0.25);
        for (let i = 0; i < DUST; i++) {
          for (let k = 0; k < 3; k++) { dustVel[i * 3 + k] *= 1 - dt * 0.9; dustPos[i * 3 + k] += dustVel[i * 3 + k] * dt; }
          dustVel[i * 3 + 1] -= MARS_G * 0.3 * dt;
          if (dustPos[i * 3 + 1] < 0.3) dustPos[i * 3 + 1] = 0.3;
        }
        dustGeo.attributes.position.needsUpdate = true;
        dustMat.size = 7 + since * 6;
        for (const d of debris) {
          if (!d.m.visible) continue;
          d.v.y -= MARS_G * dt;
          d.m.position.addScaledVector(d.v, dt);
          d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt;
          if (d.m.position.y < 0.05) { d.m.position.y = 0.05; d.v.multiplyScalar(0.3); d.v.y = Math.abs(d.v.y) * 0.4; }
        }
      }

      // Camera. Entry: it opens far back and high (the capsule small above the curved limb) and swoops in behind
      // and beside it, looking ahead along the flight path at the horizon. Under the chute: below, looking up at
      // the canopy against the sky. After the tear: above, looking down as the ground rushes up.
      const shake = Math.min(1.0, s.gLoad * 0.1 + heat * 0.2) + (impacted ? 2.5 * Math.exp(-since * 3) : 0);
      if (seg === 0) {
        const open = 1 - smooth(0, OPEN_S, T);
        const back = 24 + open * 520, side = 15 + open * 160, rise = 6 + open * 220;
        camWant.copy(vdir).multiplyScalar(-back).add(new THREE.Vector3(0, rise, side)).applyAxisAngle(up, Math.sin(T * 0.35) * 0.12);
        lookWant.copy(vdir).multiplyScalar(40 + open * 400);
      } else if (s.chute === 'open') { camWant.set(-34, -4, 52); lookWant.set(0, 17, 0); }
      else if (!impacted) { camWant.set(-12, 24, 18); lookWant.set(0, -26, 0); }
      else { camWant.set(-24, 7, 34); lookWant.set(0, 0, 0); }
      if (!camInit) { camPos.copy(camWant); look.copy(lookWant); camInit = true; }
      const ease = 1 - Math.exp(-dt * (seg === 0 ? 6 : 2.6));
      camPos.lerp(camWant, ease); look.lerp(lookWant, ease);
      jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(shake);
      camera.position.copy(capsule.position).add(camPos).add(jitter);
      if (camera.position.y < 2) camera.position.y = 2;
      camera.lookAt(look.x + capsule.position.x, look.y + capsule.position.y, look.z + capsule.position.z);
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      sun.target.position.copy(capsule.position);
      sun.position.copy(capsule.position).addScaledVector(sunDir, 100);

      // Overlays: telemetry, what is happening, the impact flash, and the fade to black (eyes shut).
      if (hud.current) {
        hud.current.textContent = [
          `ALT     ${alt >= 10_000 ? (alt / 1000).toFixed(1) : (alt / 1000).toFixed(2)} km`,
          `SPEED   ${s.v >= 1000 && !impacted ? `${(s.v / 1000).toFixed(2)} km/s` : `${Math.round(impacted ? 0 : s.v)} m/s`}`,
          `DECEL   ${(impacted ? 0 : s.gLoad).toFixed(1)} g`,
          `HEATING ${Math.round(heat * 100)}%`,
          `GRAVITY ${MARS_G} m/s²   T+${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`,
        ].join('\n');
      }
      if (cap.current) {
        const label = impacted ? '▲ IMPACT' : SEG[Math.min(seg, SEG.length - 1)].label + (seg === 0 && heat > 0.6 ? ': PEAK HEATING' : '');
        cap.current.textContent = label;
        cap.current.dataset.alert = label.startsWith('▲') ? '1' : '0';
      }
      if (flash.current) flash.current.style.opacity = impacted ? String(Math.max(0, 0.85 - since * 2)) : '0';
      if (dark.current) dark.current.style.opacity = impacted ? String(clamp((since - 0.8) / (AFTER_S - 0.9))) : '0';

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
      photo.dispose(); sprite.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div ref={host} className="crash-seq" aria-hidden="true">
      <div ref={glow} className="crash-heat" />
      <pre ref={hud} className="crash-hud" />
      <p ref={cap} className="crash-cap" />
      <p className="crash-note">SIMULATED DESCENT · physics sped up ~50× · failures are game fiction</p>
      <div ref={flash} className="crash-flash" />
      <div ref={dark} className="crash-dark" />
    </div>
  );
}
