// The meteor strike (Map/Aiman), in 3D (three.js). On the final approach, Mars ahead, the AER-1 transfer ship
// (service module, gold-foil engine section, radiators, solar wings, high-gain dish, RCS thruster quads and the entry
// capsule on the nose) is hit in the engine section by a tumbling rock.
// What makes it read as real space, not film space:
//   * the rock does not burn or trail fire (there is no air): it is a dark, lumpy stone lit only by the Sun;
//   * the hit is a hypervelocity impact: a white flash of vaporised metal, a ring of plasma, a cone of glittering
//     fragments and white-hot sparks that cool to red, panel pieces tumbling off on straight lines (no gravity, no drag);
//   * gas escaping from the breach does not billow like smoke: it leaves as a fast jet that freezes into ice crystals
//     and thins out at once; the jet pushes on the ship, so the tumble speeds up, and as the ship turns the jet draws
//     a spiral;
//   * the torn metal glows and cools, damaged wiring arcs, and the attitude thrusters fire in short bursts to stop
//     the spin, then turn the ship's nose toward Mars (the divert in Control's mayday call);
//   * light: hard sunlight, a faint orange glow reflected off Mars, and black shadows.
// The rock is slowed down so it can be seen (real ones arrive at many km/s). The impact lands at IMPACT_S, on the intro
// sound's bang. When the intro moves on to the entry (`leaving`), the camera dives at Mars, the air starts to glow, and
// the shot dissolves into the 3D entry underneath. Mars is drawn by a shader (an illustration, not a real map).
// Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

import { IMPACT_S } from './meteor';
export { IMPACT_S, METEOR_MS } from './meteor';
/** Seconds the dive into Mars takes once the intro moves on to the entry. */
const LEAVE_S = 1.9;

function css(name: string): THREE.Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(/^#[0-9a-f]{6}$/i.test(v) ? v : '#808080');
}
/** A palette colour (stored linear by three.js) back as an sRGB canvas colour. */
const hex = (c: THREE.Color, a = 1) => { const o = { r: 0, g: 0, b: 0 }; c.getRGB(o, THREE.SRGBColorSpace); return `rgba(${Math.round(clamp(o.r) * 255)},${Math.round(clamp(o.g) * 255)},${Math.round(clamp(o.b) * 255)},${a})`; };
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, v: number) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
const rnd = (s: number) => (Math.random() - 0.5) * s;

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d')! }; }
function tex(c: HTMLCanvasElement, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function softSprite(): THREE.CanvasTexture {
  const { c, g } = canvas(128, 128);
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.25, 'rgba(255,255,255,0.6)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
function ringSprite(): THREE.CanvasTexture {
  const { c, g } = canvas(256, 256);
  const rg = g.createRadialGradient(128, 128, 60, 128, 128, 128);
  rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.7, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.8, 'rgba(255,255,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Service-module hull: plates, seams, rivets, stencils and a hazard band. Doubles as its own bump map. */
function hullTexture(C: Record<string, THREE.Color>) {
  const { c, g } = canvas(1024, 512);
  g.fillStyle = hex(C.metal); g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 9000; i++) { g.fillStyle = hex(i % 2 ? C.metalDark : C.fg, 0.05); g.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2); }
  for (let y = 0; y < 512; y += 64) for (let x = 0; x < 1024; x += 128) { g.fillStyle = hex(C.metalDark, Math.random() * 0.08); g.fillRect(x, y, 128, 64); }
  g.strokeStyle = hex(C.metalDark, 0.75); g.lineWidth = 2.5;
  for (let x = 0; x <= 1024; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  g.fillStyle = hex(C.metalDark, 0.7);
  for (let x = 0; x < 1024; x += 128) for (let y = 6; y < 512; y += 16) { g.fillRect(x + 4, y, 2, 2); g.fillRect(x + 122, y, 2, 2); }
  // Hazard band near the capsule end, stencils on the side.
  for (let y = 0; y < 512; y += 24) { g.fillStyle = hex(y % 48 ? C.space : C.warn, 0.9); g.fillRect(960, y, 40, 24); }
  g.fillStyle = hex(C.space, 0.85); g.font = '700 54px ui-monospace, Consolas, monospace'; g.fillText('AER-1', 300, 150);
  g.font = '600 20px ui-monospace, Consolas, monospace'; g.fillText('SERVICE MODULE · DO NOT STEP', 300, 182);
  g.fillText('RCS ▸', 820, 300); g.fillText('O₂ TANK B ▸ 2.1 MPa', 120, 420);
  return tex(c);
}
/** Gold multi-layer insulation: crinkled facets that catch the light. */
function foilTexture(C: Record<string, THREE.Color>) {
  const { c, g } = canvas(512, 512);
  const gold = C.warn.clone().lerp(C.dust, 0.3);
  g.fillStyle = hex(gold); g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 6 + Math.random() * 26, k = Math.random();
    g.fillStyle = k < 0.5 ? hex(C.rust, 0.18 * Math.random()) : hex(C.fg, 0.22 * Math.random());
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 4; s++) g.lineTo(x + rnd(r * 2), y + rnd(r * 2));
    g.closePath(); g.fill();
  }
  g.strokeStyle = hex(C.rust, 0.35); g.lineWidth = 1;
  for (let i = 0; i < 160; i++) { g.beginPath(); const x = Math.random() * 512, y = Math.random() * 512; g.moveTo(x, y); g.lineTo(x + rnd(80), y + rnd(80)); g.stroke(); }
  return tex(c, true, true);
}
/** Solar cells: dark blue squares with silver bus lines and a thin frame. */
function cellTexture(C: Record<string, THREE.Color>) {
  const { c, g } = canvas(512, 512);
  g.fillStyle = hex(C.metal); g.fillRect(0, 0, 512, 512);
  const n = 8, s = 512 / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    g.fillStyle = hex(C.panel.clone().multiplyScalar(0.8 + Math.random() * 0.35)); g.fillRect(x * s + 3, y * s + 3, s - 6, s - 6);
    g.fillStyle = hex(C.metal, 0.45); for (let k = 1; k < 4; k++) g.fillRect(x * s + 3, y * s + (k * s) / 4, s - 6, 1);
  }
  return tex(c);
}
/** The engine bell: heat-tinted metal, bronze at the throat to blue-grey at the lip. */
function bellTexture(C: Record<string, THREE.Color>) {
  const { c, g } = canvas(64, 256);
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, hex(C.metalDark.clone().multiplyScalar(0.8))); gr.addColorStop(0.45, hex(C.sky.clone().lerp(C.metalDark, 0.7)));
  gr.addColorStop(0.8, hex(C.warn.clone().lerp(C.rust, 0.5).multiplyScalar(0.8))); gr.addColorStop(1, hex(C.rust.clone().multiplyScalar(0.6)));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 6) { g.fillStyle = hex(C.space, 0.18); g.fillRect(0, y, 64, 1); }
  return tex(c);
}
/** The breach: a jagged black hole, a scorched ring, and the torn rim that glows (separate textures). */
function breachTextures(C: Record<string, THREE.Color>) {
  const jag = (g: CanvasRenderingContext2D, r0: number, amp: number) => {
    g.beginPath();
    for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2, r = r0 + rnd(amp); g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); }
    g.closePath();
  };
  const a = canvas(256, 256);
  const sc = a.g.createRadialGradient(128, 128, 30, 128, 128, 126);
  sc.addColorStop(0, hex(C.space, 0.95)); sc.addColorStop(0.5, hex(C.space, 0.7)); sc.addColorStop(1, hex(C.space, 0));
  a.g.fillStyle = sc; a.g.fillRect(0, 0, 256, 256);
  a.g.fillStyle = hex(C.space); jag(a.g, 40, 22); a.g.fill();
  const b = canvas(256, 256);
  b.g.strokeStyle = 'rgba(255,255,255,1)'; b.g.lineWidth = 7; b.g.shadowColor = 'rgba(255,255,255,1)'; b.g.shadowBlur = 16;
  jag(b.g, 44, 22); b.g.stroke();
  for (let i = 0; i < 26; i++) { const ang = Math.random() * Math.PI * 2, r = 46 + Math.random() * 18; b.g.lineWidth = 2; b.g.beginPath(); b.g.moveTo(128 + Math.cos(ang) * 44, 128 + Math.sin(ang) * 44); b.g.lineTo(128 + Math.cos(ang) * r, 128 + Math.sin(ang) * r); b.g.stroke(); }
  return { scorch: tex(a.c), rim: new THREE.CanvasTexture(b.c) };
}

/** A lumpy stone: an icosphere pushed in and out by a few overlapping waves, with pits. Flat-shaded. */
function rockGeometry(radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 4);
  const p = g.attributes.position as THREE.BufferAttribute, v = new THREE.Vector3();
  const pits = Array.from({ length: 9 }, () => new THREE.Vector3(rnd(2), rnd(2), rnd(2)).normalize());
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let n = 1 + 0.22 * Math.sin(v.x * 3.1 + 1.3) * Math.cos(v.y * 2.7) + 0.12 * Math.sin(v.z * 6.3 + v.x * 4.1) + 0.05 * Math.sin(v.y * 17 + v.z * 11);
    for (const q of pits) { const d = v.distanceTo(q); if (d < 0.35) n -= 0.09 * (1 - d / 0.35) ** 2; }
    v.multiplyScalar(radius * n).multiply(new THREE.Vector3(1.25, 0.85, 0.95));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const NOISE3 = /* glsl */ `
  float h3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float fbm3(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * n3(p); p = p * 2.02 + vec3(13.1, 7.7, 3.3); a *= 0.5; } return s; }
`;

/** Mars from space: light and dark albedo regions, a canyon system, craters, polar caps, relief, a soft terminator. */
function marsMaterial(C: Record<string, THREE.Color>, sunDir: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir }, cSand: { value: C.sand }, cRust: { value: C.rust }, cShadow: { value: C.shadow }, cDust: { value: C.dust }, cSky: { value: C.mSky } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW;
      void main(){ vP = normalize(position); vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uSun; uniform vec3 cSand; uniform vec3 cRust; uniform vec3 cShadow; uniform vec3 cDust; uniform vec3 cSky;
      varying vec3 vP; varying vec3 vN; varying vec3 vW;
      ${NOISE3}
      float craters(vec3 p){ vec3 i = floor(p), f = fract(p); float r = 0.0;
        for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec3 g = vec3(float(x), float(y), float(z)), c = i + g; if (h3(c + 4.1) > 0.3) continue;
          vec3 o = vec3(h3(c), h3(c + 9.2), h3(c + 3.3)); float s = 0.15 + 0.3 * h3(c + 7.7); float l = length(g + o - f) / s;
          r += smoothstep(0.75, 1.0, l) * smoothstep(1.35, 1.0, l) * 0.6 - (1.0 - smoothstep(0.0, 0.9, l)) * 0.5;
        } return r; }
      float relief(vec3 p){ return fbm3(p * 9.0) * 0.6 + craters(p * 14.0) * 0.12; }
      void main(){
        vec3 p = normalize(vP); float lat = p.y, lon = atan(p.z, p.x);
        float a = fbm3(p * 2.1), b = fbm3(p * 5.5 + 3.1), d = fbm3(p * 30.0 + 7.7);
        vec3 col = mix(cRust * 0.8, cSand * 1.08, smoothstep(0.32, 0.68, a));
        float maria = smoothstep(0.48, 0.66, fbm3(p * 2.8 + 11.0)) * (1.0 - smoothstep(0.25, 0.65, abs(lat + 0.12)));
        col = mix(col, cShadow * 1.15, maria * 0.75);
        col = mix(col, cDust, smoothstep(0.6, 0.82, b) * 0.28);
        col = mix(col, cSky * 1.1, smoothstep(0.55, 0.75, fbm3(p * 4.0 + 21.0)) * 0.18);
        float can = (1.0 - smoothstep(0.0, 0.016 + 0.01 * d, abs(lat + 0.13 - 0.05 * sin(lon * 3.0) - 0.02 * (b - 0.5)))) * smoothstep(-1.9, -1.4, lon) * (1.0 - smoothstep(-0.5, -0.1, lon));
        col = mix(col, cShadow * 0.6, can * 0.85);
        col *= 0.82 + 0.36 * d;
        float cap = smoothstep(0.84, 0.9, abs(lat) + (b - 0.5) * 0.12);
        col = mix(col, cDust * 0.9, cap * 0.85);
        float e = 0.003, h0 = relief(p);
        vec3 gr = vec3(relief(p + vec3(e, 0, 0)) - h0, relief(p + vec3(0, e, 0)) - h0, relief(p + vec3(0, 0, e)) - h0) / e;
        vec3 n = normalize(vN - (gr - dot(gr, vN) * vN) * 0.035);
        float lam = dot(n, uSun), soft = smoothstep(-0.08, 0.3, dot(vN, uSun));
        vec3 c = col * (0.02 + 1.05 * max(lam, 0.0) * soft);
        vec3 V = normalize(cameraPosition - vW);
        float fr = pow(1.0 - max(dot(vN, V), 0.0), 2.5);
        c += mix(cDust, cSky, 0.45) * fr * smoothstep(-0.25, 0.45, dot(vN, uSun)) * 0.3;  // dusty air seen edge-on
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Thin atmosphere around Mars: a glowing rim on the sunlit side, brightest exactly at the limb. */
function atmoMaterial(color: THREE.Color, sunDir: THREE.Vector3) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: color }, uSun: { value: sunDir } },
    vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 color; uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); float f = 1.0 - max(dot(vN, V), 0.0);
        float rim = pow(f, 6.0) * 0.9 + pow(f, 2.0) * 0.05; float lit = smoothstep(-0.35, 0.5, dot(vN, uSun));
        gl_FragColor = vec4(color * rim * lit, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** Night sky: a faint band of the galaxy with dark dust lanes, behind the stars. */
function skyMaterial(C: Record<string, THREE.Color>) {
  return new THREE.ShaderMaterial({
    uniforms: { cA: { value: C.dust }, cB: { value: C.sky } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 cA; uniform vec3 cB; varying vec3 vD;
      ${NOISE3}
      void main(){ vec3 d = normalize(vD); vec3 bandN = normalize(vec3(0.35, 0.85, -0.4));
        float y = dot(d, bandN); float band = exp(-y * y / 0.03);
        float cloud = fbm3(d * 3.5) * fbm3(d * 8.0 + 4.0) * 2.0; float lanes = smoothstep(0.42, 0.62, fbm3(d * 6.0 + 9.0));
        vec3 c = mix(cA, cB, fbm3(d * 2.0)) * band * cloud * (1.0 - lanes * 0.8) * 0.07;
        gl_FragColor = vec4(c, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  });
}

/** A pool of soft points (sparks, ice, glitter, mist): colour runs from `a` to `b` over each particle's life. */
class Particles {
  readonly n: number; readonly pos: Float32Array; readonly vel: Float32Array; readonly age: Float32Array; readonly life: Float32Array;
  readonly t: Float32Array; readonly seed: Float32Array; readonly geo: THREE.BufferGeometry; readonly mat: THREE.ShaderMaterial; readonly pts: THREE.Points;
  next = 0; drag = 0;
  constructor(n: number, a: THREE.Color, b: THREE.Color, size: number, grow: number, alpha: number, additive = true) {
    this.n = n; this.pos = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.age = new Float32Array(n); this.life = new Float32Array(n).fill(1);
    this.t = new Float32Array(n).fill(1); this.seed = new Float32Array(n).map(() => 0.5 + Math.random());
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new THREE.BufferAttribute(this.t, 1));
    this.geo.setAttribute('aS', new THREE.BufferAttribute(this.seed, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { cA: { value: a }, cB: { value: b }, uSize: { value: size }, uGrow: { value: grow }, uAlpha: { value: alpha }, uScale: { value: 600 } },
      vertexShader: `attribute float aT; attribute float aS; uniform float uSize; uniform float uGrow; uniform float uScale; varying float vT;
        void main(){ vT = aT; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aT >= 1.0 ? 0.0 : clamp(uSize * aS * (1.0 + uGrow * aT) * uScale / max(0.1, -mv.z), 1.0, 300.0); }`,
      fragmentShader: `uniform vec3 cA; uniform vec3 cB; uniform float uAlpha; varying float vT;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard;
          float a = (1.0 - r * r) * (1.0 - vT) * uAlpha; gl_FragColor = vec4(mix(cA, cB, sqrt(vT)) * a, a); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.pts = new THREE.Points(this.geo, this.mat); this.pts.frustumCulled = false;
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3); this.vel.set([v.x, v.y, v.z], i * 3); this.age[i] = 0; this.life[i] = life; this.t[i] = 0;
  }
  update(dt: number) {
    const k = 1 - this.drag * dt;
    for (let i = 0; i < this.n; i++) {
      if (this.t[i] >= 1) continue;
      this.age[i] += dt; this.t[i] = Math.min(1, this.age[i] / this.life[i]);
      for (let j = i * 3; j < i * 3 + 3; j++) { if (this.drag) this.vel[j] *= k; this.pos[j] += this.vel[j] * dt; }
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aT.needsUpdate = true;
  }
}

/** Final grade: slight colour fringing at the edges (stronger in the shock), vignette and film grain. */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uCA: { value: 0.003 }, uTime: { value: 0 }, uVig: { value: 0.55 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uCA; uniform float uTime; uniform float uVig; varying vec2 vUv;
    void main(){ vec2 d = vUv - 0.5; float r2 = dot(d, d); vec2 o = d * uCA * (0.5 + r2 * 3.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      c *= 1.0 - uVig * smoothstep(0.08, 0.55, r2);
      float g = fract(sin(dot(vUv * vec2(1733.0, 947.0) + uTime * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
      gl_FragColor = vec4(c + (g - 0.5) * 0.03, 1.0); }`,
};

export function MeteorStrike({ active, alarm = false, leaving = false }: { active: boolean; alarm?: boolean; leaving?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const entry = useRef<HTMLDivElement>(null);
  const leave = useRef({ on: false, at: 0 });
  useEffect(() => { leave.current = { on: leaving, at: performance.now() }; }, [leaving]);

  useEffect(() => {
    const el = host.current;
    if (!el || !active) return;
    const C: Record<string, THREE.Color> = {
      space: css('--space'), fg: css('--fg'), metal: css('--metal'), metalDark: css('--metal-dark'), panel: css('--sat-panel'),
      warn: css('--warning'), alarm: css('--alarm'), sky: css('--earth-glow'), rust: css('--mars-rust'), sand: css('--mars-sand'),
      shadow: css('--mars-shadow'), dust: css('--mars-dust'), mSky: css('--mars-sky'),
    };
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = C.space;
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 6e4);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 0.86);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);

    // ---- Space: the galaxy band, stars of different brightness and colour, Mars ahead with its thin air ----
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2.5e4, 48, 24), skyMaterial(C));
    scene.add(sky);
    {
      const N = 4200, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
      const tones = [C.fg, C.dust, C.sky, C.fg.clone().lerp(C.warn, 0.3)];
      const bandN = new THREE.Vector3(0.35, 0.85, -0.4).normalize(), v = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        v.set(rnd(2), rnd(2), rnd(2)).normalize();
        if (i % 3 === 0) v.addScaledVector(bandN, -v.dot(bandN) * 0.85).normalize(); // more stars along the band
        v.multiplyScalar(2.3e4); pos.set([v.x, v.y, v.z], i * 3);
        const b = Math.pow(Math.random(), 4), t = tones[i % 9 === 0 ? 2 : i % 7 === 0 ? 3 : i % 2];
        const k = 0.25 + b * (i % 97 === 0 ? 4 : 1.3);
        col.set([t.r * k, t.g * k, t.b * k], i * 3); size[i] = 1 + b * 2.6 + (i % 97 === 0 ? 2 : 0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
      scene.add(new THREE.Points(g, new THREE.ShaderMaterial({
        vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; void main(){ vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; }',
        fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; gl_FragColor = vec4(vC * (1.0 - r * r), 1.0); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      })));
    }
    const sunDir = new THREE.Vector3(-0.6, 0.45, 0.65).normalize();
    const MARS_R = 600;
    const mars = new THREE.Mesh(new THREE.SphereGeometry(MARS_R, 128, 96), marsMaterial(C, sunDir));
    mars.position.set(2600, 900, -9000);
    mars.rotation.set(0.35, 1.2, 0.2);
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(MARS_R * 1.025, 96, 64), atmoMaterial(C.dust.clone().lerp(C.mSky, 0.35).multiplyScalar(1.4), sunDir));
    mars.add(atmo);
    scene.add(mars);
    const sun = new THREE.DirectionalLight(C.fg, 3.4);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun);
    const marsLight = new THREE.DirectionalLight(C.sand, 0.35); // sunlight bounced off Mars, from ahead
    scene.add(marsLight);
    scene.add(new THREE.AmbientLight(C.sky, 0.04));

    // ---- The ship (+x = forward, toward Mars) ----
    const ship = new THREE.Group();
    const hullTex = hullTexture(C), foilTex = foilTexture(C), cellTex = cellTexture(C), bellTex = bellTexture(C);
    foilTex.repeat.set(3, 1);
    const hull = new THREE.MeshStandardMaterial({ map: hullTex, bumpMap: hullTex, bumpScale: 0.6, roughness: 0.48, metalness: 0.35 });
    const foil = new THREE.MeshStandardMaterial({ map: foilTex, bumpMap: foilTex, bumpScale: 2.5, roughness: 0.26, metalness: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: C.metalDark, roughness: 0.45, metalness: 0.7 });
    const white = new THREE.MeshStandardMaterial({ color: C.fg, roughness: 0.6, metalness: 0.05 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 64, 1, true), hull);
    body.rotation.z = Math.PI / 2;
    const engineSec = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.0, 3, 64), foil);
    engineSec.rotation.z = Math.PI / 2; engineSec.position.x = -6;
    const bell = new THREE.Mesh(
      new THREE.LatheGeometry(Array.from({ length: 14 }, (_, i) => { const u = i / 13; return new THREE.Vector2(0.5 + 1.15 * Math.pow(u, 0.7), u * 3); }), 48),
      new THREE.MeshStandardMaterial({ map: bellTex, roughness: 0.32, metalness: 0.9, side: THREE.DoubleSide }),
    );
    bell.rotation.z = Math.PI / 2; bell.position.x = -7.4; // throat at the ship, wide exit pointing back
    const adapter = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.12, 12, 64), dark);
    adapter.rotation.y = Math.PI / 2; adapter.position.x = 4.5;
    const capsule = new THREE.Mesh(
      new THREE.LatheGeometry([[2.25, 0], [1.95, 0.6], [1.25, 1.7], [0.95, 1.8], [0.9, 2.2], [0, 2.25]].map(([r, y]) => new THREE.Vector2(r, y)), 64),
      new THREE.MeshStandardMaterial({ color: C.fg, roughness: 0.55, metalness: 0.1 }),
    );
    capsule.rotation.z = -Math.PI / 2; capsule.position.x = 4.5;
    ship.add(body, engineSec, bell, adapter, capsule);
    // Capsule windows (dark glass) and radiator panels along the body.
    const glass = new THREE.MeshStandardMaterial({ color: C.space, roughness: 0.05, metalness: 0.9 });
    for (const a of [-0.35, 0.35]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.28, 0.05), glass); w.position.set(5.4, Math.cos(a) * 1.8, Math.sin(a) * 1.8); w.rotation.set(-a, 0, -0.55); ship.add(w); }
    for (const s of [1, -1]) {
      const rad = new THREE.Mesh(new THREE.BoxGeometry(6, 0.05, 1.1), white);
      rad.position.set(0.3, s * 2.22, 0); ship.add(rad);
      for (let k = -2; k <= 2; k++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 1.1), dark); rib.position.set(0.3 + k * 1.2, s * 2.25, 0); ship.add(rib); }
    }
    // RCS thruster quads, front and back, four nozzles each.
    const rcs: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
    for (const x of [3.6, -4.2]) for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2, ny = Math.cos(a), nz = Math.sin(a);
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.42), dark);
      box.position.set(x, ny * 2.32, nz * 2.32); box.rotation.x = -a; ship.add(box);
      const noz = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 10, 1, true), dark);
      noz.position.set(x, ny * 2.52, nz * 2.52); noz.rotation.x = -a + Math.PI; ship.add(noz);
      rcs.push({ pos: new THREE.Vector3(x, ny * 2.6, nz * 2.6), dir: new THREE.Vector3(0, ny, nz) });
    }
    // High-gain dish on a boom, pointed back toward Earth.
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), dark);
    boom.position.set(-3.4, -3.3, 0); ship.add(boom);
    const dish = new THREE.Mesh(
      new THREE.LatheGeometry(Array.from({ length: 10 }, (_, i) => new THREE.Vector2(i * 0.15, (i * 0.15) ** 2 * 0.35)), 40),
      new THREE.MeshStandardMaterial({ color: C.fg, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }),
    );
    dish.position.set(-3.6, -4.5, 0); dish.rotation.z = Math.PI / 2 + 0.5; ship.add(dish);
    // Solar wings: four panels each on a yoke, cells on the sunny face, white backing.
    const wings: THREE.Group[] = [];
    const cellMat = new THREE.MeshStandardMaterial({ map: cellTex, roughness: 0.18, metalness: 0.65, emissive: C.sky, emissiveIntensity: 0.02 });
    for (const s of [1, -1]) {
      const w = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const cell = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 2.4), [white, white, cellMat, white, white, white]);
        cell.position.set(0, 0, s * (3.6 + k * 2.55)); w.add(cell);
      }
      const spar = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 10.6), dark); spar.position.z = s * 7.4; w.add(spar);
      const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 8), dark); yoke.rotation.x = Math.PI / 2; yoke.position.z = s * 2.4; w.add(yoke);
      w.position.x = -1.5; ship.add(w); wings.push(w);
    }
    // The breach (hidden until the hit): scorch and hole, and the glowing torn rim.
    const hitLocal = new THREE.Vector3(-6, 1.9, 0.8); // on the engine section's upper side
    const hitN = new THREE.Vector3(0, 1.9, 0.8).normalize();
    const br = breachTextures(C);
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), new THREE.MeshBasicMaterial({ map: br.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const rimMat = new THREE.MeshBasicMaterial({ map: br.rim, color: C.warn.clone().multiplyScalar(6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const rim = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0), rimMat);
    for (const m of [scorch, rim]) { m.position.copy(hitLocal).addScaledVector(hitN, 0.12); m.lookAt(m.position.clone().add(hitN)); m.visible = false; ship.add(m); }
    scene.add(ship);
    marsLight.position.copy(mars.position).normalize().multiplyScalar(100);

    // ---- The rock: ~1.6 m, dark and dusty, tumbling in from the upper right-front ----
    const rock = new THREE.Mesh(rockGeometry(0.8), new THREE.MeshStandardMaterial({ color: C.shadow.clone().lerp(C.metalDark, 0.5), roughness: 1, flatShading: true }));
    scene.add(rock);
    const fromDir = new THREE.Vector3(0.75, 0.55, 0.35).normalize();
    const ROCK_V = 70; // m/s on screen (slowed down so it can be seen)

    // ---- Impact effects ----
    const sprite = softSprite(), ring = ringSprite();
    const flashMat = new THREE.SpriteMaterial({ map: sprite, color: C.fg.clone().lerp(C.sky, 0.3).multiplyScalar(9), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const flashSprite = new THREE.Sprite(flashMat); scene.add(flashSprite);
    const ringMat = new THREE.SpriteMaterial({ map: ring, color: C.sky.clone().lerp(C.fg, 0.5).multiplyScalar(4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ringSpr = new THREE.Sprite(ringMat); scene.add(ringSpr);
    const flashLight = new THREE.PointLight(C.fg, 0, 140, 1.4); scene.add(flashLight);
    const arcLight = new THREE.PointLight(C.sky, 0, 18, 1.5); scene.add(arcLight);
    const glowLight = new THREE.PointLight(C.warn, 0, 10, 1.6); scene.add(glowLight);
    const glitter = new Particles(1100, C.fg.clone().multiplyScalar(3), C.warn.clone().multiplyScalar(0.4), 0.09, 0, 1);
    const sparks = new Particles(900, C.fg.clone().lerp(C.warn, 0.2).multiplyScalar(7), C.alarm.clone().multiplyScalar(1.2), 0.07, 0, 1);
    const ice = new Particles(2400, C.fg.clone().lerp(C.sky, 0.2).multiplyScalar(1.6), C.sky.clone().multiplyScalar(0.25), 0.1, 3, 0.75);
    const mist = new Particles(260, C.fg.clone().multiplyScalar(0.55), C.metal.clone().multiplyScalar(0.12), 0.8, 5, 0.32);
    const thrust = new Particles(500, C.fg.clone().multiplyScalar(2.2), C.metal.clone().multiplyScalar(0.2), 0.22, 7, 0.6);
    for (const p of [glitter, sparks, ice, mist, thrust]) scene.add(p.pts);
    // Larger pieces of hull and foil, some still hot.
    const chunks: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3; hot: THREE.MeshStandardMaterial | null }[] = [];
    for (let i = 0; i < 30; i++) {
      const hot = i % 3 === 0 ? new THREE.MeshStandardMaterial({ color: C.metalDark, emissive: C.warn, emissiveIntensity: 3, roughness: 0.5 }) : null;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06 + Math.random() * 0.4, 0.02, 0.06 + Math.random() * 0.3), hot ?? (Math.random() < 0.55 ? foil : hull));
      m.visible = false; scene.add(m);
      chunks.push({ m, v: new THREE.Vector3(), w: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9), hot });
    }
    // Arcs from cut wiring: short jagged lines that flicker across the breach.
    const ARC_N = 10, arcPos = new Float32Array(ARC_N * 3);
    const arcGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    const arcMat = new THREE.LineBasicMaterial({ color: C.sky.clone().lerp(C.fg, 0.4).multiplyScalar(5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const arc = new THREE.Line(arcGeo, arcMat); arc.frustumCulled = false; ship.add(arc);
    let arcUntil = 0, nextArc = 0;

    // ---- Size ----
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h); composer.setSize(w, h); camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
      const scale = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
      for (const p of [glitter, sparks, ice, mist, thrust]) p.mat.uniforms.uScale.value = scale;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el); resize();
    mist.drag = 0.6;

    // ---- Loop ----
    const t0 = performance.now();
    let last = t0, raf = 0, alive = true, hit = false, ventAcc = 0, sparkAcc = 0, rcsPulse = 0;
    const spin = new THREE.Vector3(), hitWorld = new THREE.Vector3(), normal = new THREE.Vector3(), tmp = new THREE.Vector3(), v2 = new THREE.Vector3();
    const camPos = new THREE.Vector3(), camWant = new THREE.Vector3(), look = new THREE.Vector3(), lookWant = new THREE.Vector3();
    const toMars = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), jitter = new THREE.Vector3();
    const aimQ = new THREE.Quaternion(), fwd = new THREE.Vector3(1, 0, 0);
    let camInit = false, leaveFrom: THREE.Vector3 | null = null;

    function frame(now: number) {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const T = (now - t0) / 1000;
      const L = leave.current.on ? (now - leave.current.at) / 1000 : 0;
      if (leave.current.on && L > LEAVE_S + 0.4) return; // dissolved: stop drawing until the intro unmounts us

      // Mars grows as the ship diverts toward it.
      mars.scale.setScalar(1 + Math.min(1.4, Math.max(0, T - 3) * 0.14));
      mars.rotation.y += dt * 0.01;
      // The ship drifts forward; after the hit it tumbles. Thrusters damp the spin, then swing the nose to Mars.
      ship.position.x = T * 0.6;
      toMars.copy(mars.position).sub(ship.position).normalize();
      const venting = hit ? Math.exp(-(T - IMPACT_S) * 0.45) : 0;
      if (hit) {
        if (T < 4.2) spin.addScaledVector(tmp.set(0.02, -0.01, 0.03), venting * dt * 6); // the jet's push
        const ctl = smooth(4.2, 5.5, T);
        spin.multiplyScalar(1 - dt * 0.5 * ctl);
        tmp.set(spin.x * dt, spin.y * dt, spin.z * dt);
        ship.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tmp.x, tmp.y, tmp.z)));
        if (T > 7) { aimQ.setFromUnitVectors(fwd, toMars); ship.quaternion.slerp(aimQ, 1 - Math.exp(-dt * 0.5 * smooth(7, 9, T))); }
      }
      ship.updateMatrixWorld();
      hitWorld.copy(hitLocal).applyMatrix4(ship.matrixWorld);
      normal.copy(hitN).transformDirection(ship.matrixWorld);

      // The rock: straight in, tumbling, until it hits.
      if (!hit) {
        rock.visible = true;
        rock.position.copy(hitWorld).addScaledVector(fromDir, ROCK_V * Math.max(0, IMPACT_S - T));
        rock.rotation.set(T * 2.3, T * 1.7, T * 3.1);
      }
      if (!hit && T >= IMPACT_S) {
        hit = true; rock.visible = false; scorch.visible = rim.visible = true;
        for (let i = 0; i < 1000; i++) {
          const dir = tmp.copy(normal).addScaledVector(fromDir, 0.35).add(v2.set(rnd(1.5), rnd(1.5), rnd(1.5))).normalize();
          glitter.emit(hitWorld, dir.multiplyScalar(5 + Math.random() * Math.random() * 45), 2 + Math.random() * 2.5);
        }
        for (let i = 0; i < 420; i++) {
          const dir = tmp.copy(normal).add(v2.set(rnd(2), rnd(2), rnd(2))).normalize();
          sparks.emit(hitWorld, dir.multiplyScalar(8 + Math.random() * 30), 0.6 + Math.random() * 1.4);
        }
        chunks.forEach((c) => {
          const dir = tmp.copy(normal).add(v2.set(rnd(1.6), rnd(1.6), rnd(1.6))).normalize();
          c.m.position.copy(hitWorld); c.v.copy(dir).multiplyScalar(3 + Math.random() * 11); c.m.visible = true;
        });
        spin.set(0.3, -0.1, 0.2);
        wings[0].userData.free = true; // the near wing's root is cut
      }
      const since = hit ? T - IMPACT_S : -1;

      // Flash, plasma ring, and the light they throw on the hull.
      const f = hit ? Math.exp(-since * 8) : 0;
      flashSprite.position.copy(hitWorld).addScaledVector(normal, 0.5);
      flashSprite.scale.setScalar(5 + (hit ? since * 34 : 0));
      flashMat.opacity = f;
      ringSpr.position.copy(flashSprite.position); ringSpr.scale.setScalar(hit ? 2 + since * 60 : 0.01);
      ringMat.opacity = hit ? clamp(1 - since / 0.45) : 0;
      flashLight.position.copy(flashSprite.position); flashLight.intensity = f * 9000;
      if (flash.current) flash.current.style.opacity = String(clamp(f * 0.55));
      grade.uniforms.uCA.value = 0.003 + 0.035 * f + (leave.current.on ? 0.01 * smooth(0, LEAVE_S, L) : 0);
      grade.uniforms.uTime.value = T;
      bloom.strength = 0.8 + f * 1.2;

      if (hit) {
        // The torn rim glows white-hot, then orange, then fades as the metal cools.
        const heat = Math.exp(-since * 0.35);
        rimMat.color.copy(C.fg).lerp(C.warn, smooth(0, 1.5, since)).lerp(C.alarm, smooth(2, 6, since)).multiplyScalar(1 + 7 * heat);
        rimMat.opacity = clamp(0.25 + heat);
        glowLight.position.copy(hitWorld).addScaledVector(normal, 0.8); glowLight.intensity = heat * 60;
        for (const c of chunks) {
          c.m.position.addScaledVector(c.v, dt); c.m.rotation.x += c.w.x * dt; c.m.rotation.y += c.w.y * dt; c.m.rotation.z += c.w.z * dt;
          if (c.hot) c.hot.emissiveIntensity = 3 * Math.exp(-since * 0.6);
        }
        // Venting: gas leaves fast and freezes at once into a glittering jet of ice, with a faint mist at the root.
        ventAcc += dt * (420 * venting + 50);
        while (ventAcc > 1) {
          ventAcc -= 1;
          const dir = tmp.copy(normal).add(v2.set(rnd(0.45), rnd(0.45), rnd(0.45))).normalize();
          const p0 = v2.copy(hitWorld).addScaledVector(normal, 0.2);
          ice.emit(p0, dir.multiplyScalar(14 + Math.random() * 16), 1.2 + Math.random() * 1.2);
          if (Math.random() < 0.08) mist.emit(p0, tmp.copy(normal).multiplyScalar(4 + Math.random() * 3), 1.4);
        }
        // Sparks spit from the breach now and then.
        sparkAcc += dt * (30 * Math.exp(-since * 0.3) + (Math.sin(T * 7) > 0.85 ? 160 : 0));
        while (sparkAcc > 1) { sparkAcc -= 1; sparks.emit(hitWorld, tmp.copy(normal).add(v2.set(rnd(1.4), rnd(1.4), rnd(1.4))).normalize().multiplyScalar(3 + Math.random() * 9), 0.4 + Math.random() * 0.8); }
        // Electrical arcs across the hole.
        if (T > nextArc) {
          nextArc = T + 0.25 + Math.random() * 0.9; arcUntil = T + 0.05 + Math.random() * 0.07;
          const a = tmp.copy(hitLocal).addScaledVector(hitN, 0.15), b = v2.set(rnd(1.4), rnd(0.3), rnd(1.4)).add(a);
          for (let i = 0; i < ARC_N; i++) { const u = i / (ARC_N - 1); arcPos.set([a.x + (b.x - a.x) * u + rnd(0.18), a.y + (b.y - a.y) * u + rnd(0.18) + 0.1, a.z + (b.z - a.z) * u + rnd(0.18)], i * 3); }
          arcGeo.attributes.position.needsUpdate = true;
        }
        const arcing = T < arcUntil;
        arcMat.opacity = arcing ? 1 : 0; arcLight.position.copy(hitWorld).addScaledVector(normal, 0.6); arcLight.intensity = arcing ? 90 : 0;
        // Attitude thrusters: short bursts from the quads while the spin is being stopped and the nose swung round.
        const firing = T > 4.2 && T < 11 && (rcsPulse += dt) % 0.55 < 0.16;
        if (firing) {
          for (let k = 0; k < rcs.length; k++) {
            if ((k + Math.floor(T / 0.55)) % 3) continue;
            const p0 = tmp.copy(rcs[k].pos).applyMatrix4(ship.matrixWorld), d = v2.copy(rcs[k].dir).transformDirection(ship.matrixWorld);
            for (let j = 0; j < 4; j++) thrust.emit(p0, d.clone().multiplyScalar(16 + Math.random() * 6).add(new THREE.Vector3(rnd(2), rnd(2), rnd(2))), 0.3);
          }
        }
      }
      for (const p of [glitter, sparks, ice, mist, thrust]) p.update(dt);
      // The cut wing drifts off and turns.
      const w0 = wings[0];
      if (w0.userData.free) { w0.position.z += dt * 1.6; w0.position.y += dt * 0.5; w0.rotation.x += dt * 0.9; w0.rotation.y += dt * 0.25; }

      // Camera. Approach: a slow push in beside the ship. After the hit: shaken, it settles and moves round behind
      // the ship so Mars sits beyond it. Leaving: it dives past the ship at Mars until the planet fills the view.
      side.crossVectors(toMars, up).normalize();
      if (T < 3.4) {
        const Tc = Math.min(T, 3.2);
        camWant.set(-1 + Tc * 0.3, 7, 38 - Tc * 2.2);
        lookWant.set(1 + T * 0.6, 2, 0);
      } else {
        const k = smooth(3.4, 9, T);
        camWant.copy(ship.position).add(tmp.set(-1, 7, 31).lerp(v2.copy(toMars).multiplyScalar(-26).addScaledVector(side, 9).addScaledVector(up, 4), k));
        lookWant.copy(ship.position).lerp(v2.copy(ship.position).addScaledVector(toMars, 60), k * 0.7);
      }
      if (leave.current.on) {
        if (!leaveFrom) leaveFrom = camPos.clone();
        const u = smooth(0, 1.5, L);
        const surfaceGap = MARS_R * mars.scale.x * 1.08;
        const target = tmp.copy(mars.position).addScaledVector(v2.copy(leaveFrom).sub(mars.position).normalize(), surfaceGap);
        camWant.copy(leaveFrom).lerp(target, u * u * 0.55 + u * 0.45); // accelerating
        lookWant.copy(mars.position);
      }
      if (!camInit) { camPos.copy(camWant); look.copy(lookWant); camInit = true; }
      const ease = leave.current.on ? 1 - Math.exp(-dt * 8) : T < 3.4 ? 1 : 1 - Math.exp(-dt * 1.6);
      camPos.lerp(camWant, ease); look.lerp(lookWant, ease);
      const shake = hit ? 0.9 * Math.exp(-since * 2.5) + (leave.current.on ? 0.25 * smooth(0.4, LEAVE_S, L) : 0) : 0;
      jitter.set(rnd(1), rnd(1), rnd(1)).multiplyScalar(shake);
      camera.position.copy(camPos).add(jitter);
      camera.lookAt(look);
      const fov = 38 - 5 * f + (leave.current.on ? 14 * smooth(0, LEAVE_S, L) : 0);
      if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
      sky.position.copy(camera.position);
      if (entry.current) entry.current.style.opacity = leave.current.on ? String(smooth(0.5, LEAVE_S, L)) : '0';

      if (cap.current) cap.current.textContent = hit && T < 3.4 ? '▲ IMPACT · ENGINE SECTION BREACHED' : '';
      composer.render();
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
      for (const t of [sprite, ring, hullTex, foilTex, cellTex, bellTex, br.scorch, br.rim]) t.dispose();
      composer.dispose(); renderer.dispose();
      renderer.domElement.remove();
    };
  }, [active]);

  return (
    <div ref={host} className={`meteor-strike${active ? ' on' : ''}${alarm ? ' alarm' : ''}${leaving ? ' leaving' : ''}`} aria-hidden="true">
      <div className="meteor-alarm" />
      <p ref={cap} className="meteor-cap" />
      <p className="meteor-note">Game fiction: the rock is slowed down so it can be seen</p>
      <div ref={flash} className="meteor-flash" />
      <div ref={entry} className="meteor-entry" />
    </div>
  );
}
