import * as THREE from 'three';
import { cssColor } from './astronaut3d';

// The air of the 3D view, drawn by small GPU shaders: the sky dome with the sun in it, blowing dust and dust devils.
// The particles move in the vertex shader, so nothing is recomputed on the CPU each frame.
// Colours come from the :root variables via cssColor().

/** Unit vector toward the sun. World axes: x east, y up, z south. Azimuth is clockwise from north. */
export function sunDirection(azimuthDeg: number, elevationDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

/** Pixels per metre at one metre from the camera, for sizing point sprites in world units. */
export function pointScale(drawHeightPx: number, fovDeg: number): number {
  return drawHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 glowColor;
uniform float sunVis;
uniform float glowAmt;
uniform float starVis;
varying vec3 vDir;

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  // Bright dusty horizon fading to a deeper zenith.
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.55, d.y));

  // Mars dust scatters sunlight forward: a wide aureole round the sun with a tight core. The core is
  // bluish when the sun is low (the blue Martian sunset); glowColor carries that.
  float mu = max(dot(d, sunDir), 0.0);
  col += glowColor * glowAmt * (0.3 * pow(mu, 8.0) + 1.1 * pow(mu, 180.0));

  // The sun's disc, about 0.5 degrees across on screen (0.35 in reality, so it is still a small sun).
  col += sunColor * sunVis * smoothstep(0.99994, 0.99997, mu);

  // Stars: one cell in 400 on a fine grid over the dome holds a star.
  if (starVis > 0.001) {
    vec3 g = d * 220.0;
    vec3 cell = floor(g);
    float star = step(0.9975, hash3(cell)) * smoothstep(0.38, 0.0, length(fract(g) - 0.5));
    col += vec3(star) * starVis * (0.45 + 0.55 * hash3(cell + 7.0)) * smoothstep(0.02, 0.3, d.y);
  }

  // No tone mapping here: three.js doesn't tone-map fog either, so the horizon and the haze stay the same colour.
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  #include <colorspace_fragment>
}`;

export interface Sky {
  mesh: THREE.Mesh;
  /**
   * Set the sky for this frame. `day` is 0 (night) to 1, `dust` is 0 (clear) to 1 (storm), `tau` the dust optical
   * depth, and the sun's position in degrees. Returns the horizon colour, for the fog.
   */
  update: (day: number, dust: number, tau: number, sunAzimuthDeg: number, sunElevationDeg: number) => THREE.Color;
  /** Direction to the sun as last set (unit vector). */
  sunDir: THREE.Vector3;
  dispose: () => void;
}

/**
 * A sky dome that follows the camera: a dusty horizon and deeper zenith, the sun with its dust glow, and stars
 * at night. Its horizon is exactly the fog colour, so far hills fade into the sky without a seam.
 *
 * The sun's brightness follows the real direct-beam law: exp(−τ / sin(elevation)). So it dims near the horizon
 * and disappears in a storm, as it does on Mars.
 */
export function buildSky(): Sky {
  const horizonDay = cssColor('--mars-sky'), zenithDay = cssColor('--mars-rust');
  const night = cssColor('--space');
  const dustColor = cssColor('--mars-dust');
  // Forward-scattered light: warm with the sun high, blue with the sun low.
  const glowHigh = dustColor.clone().multiplyScalar(0.9);
  const glowLow = new THREE.Color().setRGB(0.3, 0.5, 1.0).multiplyScalar(0.9);
  const sunWhite = new THREE.Color().setRGB(1, 0.94, 0.85).multiplyScalar(12);
  const uniforms = {
    horizon: { value: horizonDay.clone() },
    zenith: { value: zenithDay.clone() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: sunWhite.clone() },
    glowColor: { value: glowHigh.clone() },
    sunVis: { value: 1 },
    glowAmt: { value: 0.5 },
    starVis: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  });
  const geo = new THREE.SphereGeometry(7000, 32, 16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  const out = new THREE.Color(), zen = new THREE.Color();
  const update: Sky['update'] = (day, dust, tau, azDeg, elDeg) => {
    // Night darkens the sky; dust washes the zenith out toward the horizon colour.
    uniforms.horizon.value.copy(night).lerp(horizonDay, 0.12 + 0.88 * day);
    uniforms.zenith.value.copy(night).lerp(zen.copy(zenithDay).lerp(horizonDay, dust * 0.8), 0.08 + 0.92 * day);
    sunDirection(azDeg, elDeg, uniforms.sunDir.value);
    const el = (elDeg * Math.PI) / 180;
    const airmass = 1 / Math.max(Math.sin(el), 0.05);
    const above = THREE.MathUtils.smoothstep(elDeg, -1.2, 0.6);
    // Direct beam through the dust (Beer–Lambert), then the scattered glow, which needs some dust to exist
    // and fades more slowly than the disc.
    uniforms.sunVis.value = Math.exp(-tau * airmass) * above;
    uniforms.glowAmt.value = THREE.MathUtils.smoothstep(elDeg, -6, 4) * (0.35 + 0.65 * (1 - Math.exp(-2 * tau))) * Math.exp(-0.12 * tau * airmass);
    uniforms.glowColor.value.copy(glowLow).lerp(glowHigh, THREE.MathUtils.smoothstep(elDeg, 2, 28));
    uniforms.starVis.value = Math.max(0, 1 - day * 2.2) * Math.exp(-tau * 1.2);
    return out.copy(uniforms.horizon.value);
  };
  return { mesh, update, sunDir: uniforms.sunDir.value, dispose: () => { geo.dispose(); mat.dispose(); } };
}

const DUST_VERT = /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform float uSize;
uniform float uScale;
attribute vec3 seed;
varying float vFade;
const vec3 BOX = vec3(80.0, 20.0, 80.0);
void main() {
  // Each mote drifts downwind (east) and sinks slowly, wrapped into a box that stays round the astronaut.
  vec3 p = seed * BOX;
  p.x += uTime * (8.0 + 6.0 * fract(seed.z * 7.31 + seed.y * 3.7));
  p.y -= uTime * 0.6;
  p.z += sin(uTime * 0.7 + seed.x * 40.0) * 0.6;
  vec3 rel = mod(p - uCenter + 0.5 * BOX, BOX) - 0.5 * BOX;
  rel.y = mod(p.y, BOX.y);
  vec4 mvPosition = viewMatrix * vec4(uCenter.x + rel.x, uCenter.y + rel.y, uCenter.z + rel.z, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float px = uSize * uScale / max(-mvPosition.z, 0.1);
  gl_PointSize = max(px, 1.5);
  // Fade at the box's sides so motes don't pop as they wrap, and thin out the ones too small to draw.
  vFade = (1.0 - smoothstep(0.75, 1.0, max(abs(rel.x), abs(rel.z)) / 40.0)) * min(1.0, px / 1.5);
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vFade;
void main() {
  float a = smoothstep(0.5, 0.12, length(gl_PointCoord - 0.5)) * uOpacity * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Blowing dust motes round the astronaut when the air is dusty (τ above about 1). */
export function buildDust(count = 1400) {
  let s = 7;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
  // three.js wants a position attribute to know how many points to draw; the shader ignores it.
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uniforms = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 0.11 }, uScale: { value: 400 },
    uColor: { value: cssColor('--mars-dust') }, uOpacity: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG, transparent: true, depthWrite: false, fog: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  return {
    points,
    /** `scale` is pointScale() for the current canvas and camera. */
    update(dt: number, tau: number, center: THREE.Vector3, scale: number) {
      const opacity = THREE.MathUtils.clamp((tau - 1) / 3, 0, 0.85);
      uniforms.uOpacity.value = opacity;
      points.visible = opacity > 0;
      if (!points.visible) return;
      // The wind picks up with the dust: a storm blows the motes past about twice as fast.
      uniforms.uTime.value += dt * (1 + THREE.MathUtils.clamp((tau - 1) / 5, 0, 1));
      uniforms.uCenter.value.copy(center);
      uniforms.uScale.value = scale;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

const DEVIL_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
uniform float uTime;
uniform float uWidth;
uniform float uHeight;
uniform float uSize;
uniform float uScale;
attribute vec3 seed; // start angle, height 0..1, spread
varying float vAlpha;
void main() {
  float a = seed.x + uTime * (2.2 + seed.z);
  // Narrow at the ground, flaring upward, and leaning a little as it drifts.
  float r = uWidth * 0.5 * (0.35 + pow(seed.y, 1.3) * 1.4) * seed.z;
  vec3 p = vec3(cos(a) * r, seed.y * uHeight, sin(a) * r);
  p.x += sin(uTime * 0.31 + seed.y * 2.6) * seed.y * uWidth * 0.45;
  p.z += cos(uTime * 0.23 + seed.y * 2.1) * seed.y * uWidth * 0.3;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * (0.7 + 0.6 * seed.z) * uScale / max(-mvPosition.z, 1.0);
  vAlpha = 1.0 - 0.55 * seed.y; // thinner toward the top
  #include <fog_vertex>
}`;

const DEVIL_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.0, 1.0, d)) * uOpacity * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/**
 * Up to two dust devils: swirling columns of dust drifting a few hundred metres ahead of the camera, so they show up
 * when they are about. Sizes follow MEDA (Jackson 2022): about 20 m across on average. The swirl runs on the GPU.
 */
export function buildDustDevils() {
  const PER = 420, H = 140;
  const group = new THREE.Group();
  const color = cssColor('--mars-dust');
  const devils = [{ offset: -0.45, dist: 210, widthM: 22 }, { offset: 0.5, dist: 330, widthM: 14 }].map((cfg) => {
    const seeds = new Float32Array(PER * 3);
    for (let i = 0; i < PER; i++) {
      seeds[i * 3] = (i * 2.39996) % (Math.PI * 2);
      seeds[i * 3 + 1] = i / PER;
      seeds[i * 3 + 2] = 0.7 + ((i * 37) % 10) / 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PER * 3), 3));
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: Math.random() * 60 }, uWidth: { value: cfg.widthM }, uHeight: { value: H }, uSize: { value: 5 },
      uScale: { value: 400 }, uColor: { value: color.clone() }, uOpacity: { value: 0 },
    }]);
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: DEVIL_VERT, fragmentShader: DEVIL_FRAG, transparent: true, depthWrite: false, fog: true });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    group.add(points);
    return { ...cfg, points, geo, mat, uniforms, sway: Math.random() * 6, bearing: NaN };
  });
  return {
    group,
    /** `count` devils (0–2) in view; `camYaw` is the camera heading (0 = north, clockwise); `scale` is pointScale(). */
    update(dt: number, center: THREE.Vector3, camYaw: number, count: number, surfaceY: (x: number, z: number) => number, scale: number) {
      devils.forEach((dv, idx) => {
        const on = idx < count;
        const u = dv.uniforms;
        u.uOpacity.value += ((on ? 0.55 : 0) - u.uOpacity.value) * Math.min(1, dt * 0.8);
        if (u.uOpacity.value < 0.01) { dv.points.visible = false; dv.bearing = NaN; return; }
        dv.points.visible = true;
        // Hold a bearing a little to one side of the view; if the camera turns far away, reappear ahead.
        const want = camYaw + dv.offset;
        if (Number.isNaN(dv.bearing) || Math.abs(Math.atan2(Math.sin(want - dv.bearing), Math.cos(want - dv.bearing))) > 1.1) dv.bearing = want;
        dv.sway += dt * 0.05;
        const b = dv.bearing + Math.sin(dv.sway) * 0.25;
        const cx = center.x + Math.sin(b) * dv.dist, cz = center.z - Math.cos(b) * dv.dist;
        dv.points.position.set(cx, surfaceY(cx, cz), cz);
        u.uTime.value += dt;
        u.uScale.value = scale;
      });
    },
    dispose() { devils.forEach((d) => { d.geo.dispose(); d.mat.dispose(); }); },
  };
}
