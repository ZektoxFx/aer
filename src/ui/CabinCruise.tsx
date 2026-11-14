// Map/Aiman: the intro's cabin scene. Seated in the AER-1 cabin, first person, during the Earth→Mars cruise as a
// time-lapse: the console counts the days (1 → 203), the distance and the radio delay to Earth; the ship spins
// slowly (Perseverance's cruise stage spun at about 2 rpm), so sunlight sweeps through the windows; Mars grows from a
// dot to a disc on the final approach (true apparent size from the distance); a checklist floats in zero-g. Then
// the master alarm. Numbers in cabin.ts. AER-1 is fictional; colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CABIN_S, CRUISE, cruiseAt, marsAngularRadius, type CruiseState } from './cabin';
import { makeGlove } from './hands';
import './cabin.css';

type RGB = [number, number, number];
function rgb(name: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (k: RGB, a = 1) => `rgba(${k[0]},${k[1]},${k[2]},${a})`;
const col = (k: RGB) => new THREE.Color(k[0] / 255, k[1] / 255, k[2] / 255);

interface Pal { metal: RGB; dark: RGB; fg: RGB; dim: RGB; warn: RGB; alarm: RGB; space: RGB; sand: RGB; rust: RGB; shadow: RGB; dust: RGB; sky: RGB; blue: RGB; sat: RGB }

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d')! }; }

/** Wall panels: plates, seams and rivets. */
function panelTexture(p: Pal) {
  const { c, g } = canvas(512, 512);
  g.fillStyle = css(p.metal); g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2500; i++) { g.fillStyle = css(i % 2 ? p.dark : p.fg, 0.05); g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  g.strokeStyle = css(p.dark, 0.7); g.lineWidth = 3;
  for (let k = 0; k <= 512; k += 128) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 512); g.stroke(); g.beginPath(); g.moveTo(0, k); g.lineTo(512, k); g.stroke(); }
  g.strokeStyle = css(p.dark, 0.35); g.lineWidth = 1.5;
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) g.strokeRect(x + 14, y + 14, 100, 100);
  g.fillStyle = css(p.dark, 0.6);
  for (let k = 0; k < 512; k += 128) for (let s = 8; s < 128; s += 24) { g.fillRect(k + 6, s, 3, 3); g.fillRect(s, k + 6, 3, 3); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Mars for the window: an equirectangular sketch (dark plains, polar caps, a few craters), not a real map. */
function marsTexture(p: Pal) {
  const { c, g } = canvas(1024, 512);
  g.fillStyle = css(p.sand); g.fillRect(0, 0, 1024, 512);
  let s = 7; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 260; i++) {
    const x = r() * 1024, y = 120 + r() * 280, R = 20 + r() * 90, k = r() < 0.55 ? p.shadow : r() < 0.5 ? p.rust : p.sky;
    const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, css(k, 0.22)); gr.addColorStop(1, css(k, 0));
    g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2);
  }
  g.strokeStyle = css(p.shadow, 0.35); g.lineWidth = 6; g.beginPath(); g.moveTo(560, 270); g.bezierCurveTo(640, 280, 700, 262, 790, 276); g.stroke();
  for (let i = 0; i < 120; i++) { const x = r() * 1024, y = 60 + r() * 390, R = 2 + r() * 9; g.fillStyle = css(p.shadow, 0.3); g.beginPath(); g.arc(x, y, R, 0, 7); g.fill(); g.fillStyle = css(p.dust, 0.25); g.beginPath(); g.arc(x + R * 0.3, y + R * 0.3, R * 0.6, 0, 7); g.fill(); }
  const cap = (y0: number, y1: number) => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, css(p.dust, 0.95)); gr.addColorStop(1, css(p.dust, 0)); g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), 1024, Math.abs(y1 - y0)); };
  cap(0, 46); cap(512, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Window glass: faint smudges, a reflection streak and frost creeping in from the cold frame. Transparent canvas. */
function glassTexture(p: Pal) {
  const W = 360, H = 250, { c, g } = canvas(W, H);
  let s = 11; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, css(p.dust, 0.32)); gr.addColorStop(1, css(p.dust, 0)); g.fillStyle = gr; g.fillRect(0, 0, W, H);
  };
  edge(0, 0, 34, 0); edge(W, 0, W - 34, 0); edge(0, H, 0, H - 30); edge(0, 0, 0, 22);
  for (let i = 0; i < 900; i++) { // frost crystals, denser toward the frame
    const side = Math.floor(r() * 4), d = Math.pow(r(), 2.2) * 40, t = r();
    const x = side === 0 ? d : side === 1 ? W - d : t * W, y = side === 2 ? H - d : side === 3 ? d : t * H;
    g.fillStyle = css(p.fg, 0.08 + r() * 0.25); g.fillRect(x, y, 1 + r() * 2, 1 + r() * 2);
  }
  g.globalCompositeOperation = 'lighter';
  const st = g.createLinearGradient(W * 0.15, 0, W * 0.55, H); st.addColorStop(0, css(p.fg, 0)); st.addColorStop(0.5, css(p.fg, 0.07)); st.addColorStop(1, css(p.fg, 0));
  g.fillStyle = st; g.beginPath(); g.moveTo(W * 0.22, 0); g.lineTo(W * 0.38, 0); g.lineTo(W * 0.62, H); g.lineTo(W * 0.46, H); g.fill();
  for (let i = 0; i < 6; i++) { const x = r() * W, y = r() * H, R = 10 + r() * 26; const gr = g.createRadialGradient(x, y, 0, x, y, R); gr.addColorStop(0, css(p.fg, 0.05)); gr.addColorStop(1, css(p.fg, 0)); g.fillStyle = gr; g.fillRect(x - R, y - R, R * 2, R * 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A stencilled label or a small placard, drawn on a canvas. */
function labelTexture(lines: string[], fg: RGB, bg: RGB | null, w = 256, h = 96) {
  const { c, g } = canvas(w, h);
  if (bg) { g.fillStyle = css(bg); g.fillRect(0, 0, w, h); g.strokeStyle = css(fg, 0.8); g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8); }
  g.fillStyle = css(fg); g.textAlign = 'center'; g.textBaseline = 'middle';
  const fs = Math.floor((h * 0.62) / lines.length); g.font = `700 ${fs}px ui-monospace, Consolas, monospace`;
  lines.forEach((l, i) => g.fillText(l, w / 2, (h / (lines.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Soft cargo-bag fabric: woven noise, stitched seams and a tag. */
function fabricTexture(p: Pal, tag: string) {
  const { c, g } = canvas(256, 256);
  g.fillStyle = css(p.dust); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) { g.fillStyle = css(i % 2 ? p.dim : p.fg, 0.08); g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1); }
  g.strokeStyle = css(p.dim, 0.7); g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeRect(10, 10, 236, 236); g.setLineDash([]);
  g.fillStyle = css(p.fg); g.fillRect(70, 96, 116, 50); g.fillStyle = css(p.space); g.font = '700 22px ui-monospace, Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tag, 128, 122);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The panel above the windows: guarded switches, labels and status lamps. */
function overheadTexture(p: Pal) {
  const { c, g } = canvas(1024, 180);
  g.fillStyle = css(p.dark); g.fillRect(0, 0, 1024, 180);
  g.font = '600 15px ui-monospace, Consolas, monospace'; g.textAlign = 'center';
  const names = ['PWR BUS A', 'PWR BUS B', 'O₂ ISOL', 'N₂ ISOL', 'CO₂ SCRUB', 'FANS', 'HEATERS', 'XPDR', 'RCS A', 'RCS B', 'PYRO ARM', 'CHUTE ARM'];
  names.forEach((n, i) => {
    const x = 50 + i * 84;
    g.fillStyle = css(p.fg, 0.85); g.fillText(n, x, 30);
    g.strokeStyle = css(i >= 10 ? p.alarm : p.metal, 0.8); g.lineWidth = 3; g.strokeRect(x - 22, 44, 44, 70);
    g.fillStyle = css(p.metal, 0.35); g.fillRect(x - 6, 52, 12, 54);
    g.fillStyle = css(i % 4 === 3 ? p.warn : p.fg, 0.9); g.beginPath(); g.arc(x, 140, 6, 0, 7); g.fill();
  });
  g.fillStyle = css(p.dim); g.textAlign = 'left'; g.fillText('AER-1 · OVERHEAD 1', 14, 170);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The proximity warning runs over the last PROX_S seconds of the time-lapse, just before the meteor strike. */
const PROX_S = 1.1;

function roundRect(path: THREE.Path | THREE.Shape, cx: number, cy: number, w: number, h: number, r: number) {
  const x = cx - w / 2, y = cy - h / 2;
  path.moveTo(x + r, y); path.lineTo(x + w - r, y); path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  path.lineTo(x + w, y + h - r); path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  path.lineTo(x + r, y + h); path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  path.lineTo(x, y + r); path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
}

const WIN = [{ x: -0.48, y: 1.5 }, { x: 0.48, y: 1.5 }];
const WIN_W = 0.72, WIN_H = 0.5;
const CAM = new THREE.Vector3(0, 1.28, 0.42), LOOK = new THREE.Vector3(0, 1.36, -1.5);

/** Draw the three console screens for the current state. */
function drawScreens(gs: CanvasRenderingContext2D[], st: CruiseState, p: Pal, blink: boolean, prox = 0) {
  const [L, C, R] = gs, W = 512, H = 300, alarm = st.alarm > 0;
  for (const g of gs) { g.fillStyle = css(p.space); g.fillRect(0, 0, W, H); g.font = '600 22px ui-monospace, Consolas, monospace'; g.textBaseline = 'top'; }
  // Left: the transfer orbit, with the ship's place along it.
  const cx = 230, cy = 162, rE = 70, rM = 112, f = (st.day - 1) / (CRUISE.days - 1);
  L.strokeStyle = css(p.dim, 0.6); L.lineWidth = 2;
  L.beginPath(); L.arc(cx, cy, rE, 0, 7); L.stroke(); L.beginPath(); L.arc(cx, cy, rM, 0, 7); L.stroke();
  L.fillStyle = css(p.warn); L.beginPath(); L.arc(cx, cy, 9, 0, 7); L.fill();
  // Half an ellipse from Earth's orbit (perihelion) to Mars' orbit (aphelion): a Hohmann-style transfer.
  const a = (rE + rM) / 2, e = (rM - rE) / (rM + rE), b = a * Math.sqrt(1 - e * e), ox = cx - (a - rE);
  L.strokeStyle = css(p.fg, 0.9); L.setLineDash([6, 6]); L.beginPath(); L.ellipse(ox, cy, a, b, 0, 0, Math.PI, true); L.stroke(); L.setLineDash([]);
  const th = -Math.PI * f, sx = ox + a * Math.cos(th), sy = cy + b * Math.sin(th);
  L.fillStyle = css(p.blue); L.beginPath(); L.arc(cx + rE, cy, 6, 0, 7); L.fill();
  L.fillStyle = css(p.sand); L.beginPath(); L.arc(ox - a, cy, 7, 0, 7); L.fill();
  L.fillStyle = css(alarm && blink ? p.alarm : p.fg); L.beginPath(); L.arc(sx, sy, 6, 0, 7); L.fill();
  L.fillStyle = css(p.fg); L.fillText('TRANSFER ORBIT', 16, 12); L.fillStyle = css(p.dim); L.font = '16px ui-monospace, Consolas, monospace';
  L.fillText('EARTH', cx + rE - 26, cy + 12); L.fillText('MARS', ox - a - 18, cy + 14);
  // Centre: the day and the distances.
  C.fillStyle = css(p.dim); C.fillText('MISSION DAY', 20, 14);
  C.fillStyle = css(p.fg); C.font = '700 78px ui-monospace, Consolas, monospace'; C.fillText(`${Math.floor(st.day)}`.padStart(3, ' '), 18, 44);
  C.font = '600 30px ui-monospace, Consolas, monospace'; C.fillStyle = css(p.dim); C.fillText(`/ ${CRUISE.days}`, 210, 84);
  C.font = '18px ui-monospace, Consolas, monospace'; C.fillStyle = css(p.fg);
  const toMars = st.marsKm > 1e6 ? `${(st.marsKm / 1e6).toFixed(1)} million km` : `${Math.round(st.marsKm).toLocaleString('en-US')} km`;
  C.fillText(`TRAVELLED  ${(st.travelledKm / 1e6).toFixed(1)} million km`, 20, 150);
  C.fillText(`TO MARS    ${toMars}`, 20, 180);
  C.fillText(`SIGNAL     ${st.signalMin.toFixed(1)} min to Earth`, 20, 210);
  C.fillText(`SPIN       ${CRUISE.rpm} rpm (cruise)`, 20, 240);
  // Right: systems; the debris warning just before the strike; then the alarm.
  if (!alarm && prox > 0) {
    R.fillStyle = css(blink ? p.warn : p.space); R.fillRect(0, 0, W, H);
    R.fillStyle = css(blink ? p.space : p.warn); R.font = '700 32px ui-monospace, Consolas, monospace';
    R.fillText('PROXIMITY ALERT', 36, 60); R.font = '600 22px ui-monospace, Consolas, monospace';
    R.fillText('UNTRACKED OBJECT', 36, 128); R.fillText('ON INTERCEPT · AFT', 36, 164);
    R.fillText(`T-${Math.max(0, (1 - prox) * 1.1).toFixed(1)} s`, 36, 214);
  } else if (!alarm) {
    const rows: [string, string][] = [['O₂ SUPPLY', 'NOMINAL'], ['CABIN PRESS', 'NOMINAL'], ['POWER', 'SOLAR OK'], ['COMMS', 'LINK'], ['NAV', 'ON COURSE'], ['DESCENT ENG', 'STANDBY']];
    R.fillStyle = css(p.dim); R.fillText('SYSTEMS', 20, 14); R.font = '18px ui-monospace, Consolas, monospace';
    rows.forEach(([k, v], i) => { R.fillStyle = css(p.fg); R.fillText(k, 20, 56 + i * 38); R.fillStyle = css(p.fg, 0.8); R.fillText(v, 300, 56 + i * 38); });
  } else {
    R.fillStyle = css(blink ? p.alarm : p.space); R.fillRect(0, 0, W, H);
    R.fillStyle = css(blink ? p.space : p.alarm); R.font = '700 34px ui-monospace, Consolas, monospace';
    R.fillText('MASTER ALARM', 40, 70); R.font = '600 24px ui-monospace, Consolas, monospace';
    R.fillText('DESCENT ENGINE FAULT', 40, 140); R.fillText('TRAJECTORY: OFF NOMINAL', 40, 182);
  }
}

interface Props { prepare: boolean; active: boolean }

export function CabinCruise({ prepare, active }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const cap = useRef<HTMLParagraphElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const play = useRef({ on: false, t0: 0 });
  useEffect(() => { play.current = { on: active, t0: performance.now() }; }, [active]);

  useEffect(() => {
    const host = root.current;
    if (!prepare || !host) return;
    let alive = true, raf = 0;
    const p: Pal = {
      metal: rgb('--metal'), dark: rgb('--metal-dark'), fg: rgb('--fg'), dim: rgb('--dim'), warn: rgb('--warning'), alarm: rgb('--alarm'),
      space: rgb('--space'), sand: rgb('--mars-sand'), rust: rgb('--mars-rust'), shadow: rgb('--mars-shadow'), dust: rgb('--mars-dust'), sky: rgb('--mars-sky'), blue: rgb('--earth-glow'), sat: rgb('--sat-panel'),
    };
    const dispose: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => { dispose.push(x); return x; };

    // ---------- Outside: stars and Mars (units of 1000 km) ----------
    const space = new THREE.Scene();
    const spCam = new THREE.PerspectiveCamera(62, 1, 0.05, 2e6);
    const outside = new THREE.Group(); space.add(outside);
    const axis = LOOK.clone().sub(CAM).normalize(); // straight out through the windows
    {
      const n = 3000, pos = new Float32Array(n * 3), cols = new Float32Array(n * 3);
      const tones = [col(p.fg), col(p.dust), col(p.blue), col(p.sky)];
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        pos.set([Math.cos(a) * s * 1000, u * 1000, Math.sin(a) * s * 1000], i * 3);
        const t = tones[i % 7 === 0 ? 2 : i % 5 === 0 ? 3 : i % 2], b = 0.4 + Math.random() * 0.6;
        cols.set([t.r * b, t.g * b, t.b * b], i * 3);
      }
      const g = keep(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      outside.add(new THREE.Points(g, keep(new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }))));
    }
    const MR = 3.3895;
    const marsTex = keep(marsTexture(p));
    const mars = new THREE.Mesh(keep(new THREE.SphereGeometry(MR, 64, 48)), keep(new THREE.MeshStandardMaterial({ map: marsTex, roughness: 1 })));
    mars.rotation.z = 0.44; outside.add(mars);
    const haloMat = keep(new THREE.ShaderMaterial({
      uniforms: { color: { value: col(p.sky) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 color; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0); gl_FragColor = vec4(color * f, f); }',
    }));
    const halo = new THREE.Mesh(keep(new THREE.SphereGeometry(MR * 1.035, 48, 32)), haloMat); outside.add(halo);
    const dotGeo = keep(new THREE.BufferGeometry()); dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const dotMat = keep(new THREE.PointsMaterial({ size: 3.5, sizeAttenuation: false, color: col(p.sand), transparent: true }));
    const dot = new THREE.Points(dotGeo, dotMat); outside.add(dot);
    const sunOut = new THREE.DirectionalLight(col(p.fg), 3); outside.add(sunOut); outside.add(sunOut.target);
    space.add(new THREE.AmbientLight(col(p.dust), 0.05));

    // ---------- Inside: the cabin (metres) ----------
    const cabin = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(62, 1, 0.02, 30);
    const panel = keep(panelTexture(p));
    const wallMat = keep(new THREE.MeshStandardMaterial({ map: panel, roughness: 0.75, metalness: 0.25, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide }));
    const darkMat = keep(new THREE.MeshStandardMaterial({ color: col(p.dark), roughness: 0.6, metalness: 0.5 }));
    const add = (g: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], cast = true) => { keep(g); const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = true; cabin.add(o); return o; };
    // Front wall with two windows.
    const front = new THREE.Shape(); front.moveTo(-2.2, -0.3); front.lineTo(2.2, -0.3); front.lineTo(2.2, 2.8); front.lineTo(-2.2, 2.8); front.lineTo(-2.2, -0.3);
    for (const w of WIN) { const h = new THREE.Path(); roundRect(h, w.x, w.y, WIN_W, WIN_H, 0.09); front.holes.push(h); }
    add(new THREE.ShapeGeometry(front), wallMat).position.z = -1.5;
    for (const w of WIN) {
      const ring = new THREE.Shape(); roundRect(ring, w.x, w.y, WIN_W + 0.14, WIN_H + 0.14, 0.14);
      const hole = new THREE.Path(); roundRect(hole, w.x, w.y, WIN_W, WIN_H, 0.09); ring.holes.push(hole);
      add(new THREE.ExtrudeGeometry(ring, { depth: 0.07, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }), darkMat).position.z = -1.5;
    }
    const side = (x: number) => { const m = add(new THREE.PlaneGeometry(3.2, 3.1), wallMat); m.position.set(x, 1.25, 0); m.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2; };
    side(-1.6); side(1.6);
    const ceil = add(new THREE.PlaneGeometry(3.2, 3.2), wallMat); ceil.position.set(0, 2.5, 0); ceil.rotation.x = Math.PI / 2;
    const floor = add(new THREE.PlaneGeometry(3.2, 3.2), darkMat); floor.position.set(0, -0.3, 0); floor.rotation.x = -Math.PI / 2;
    const back = add(new THREE.PlaneGeometry(3.2, 3.1), wallMat); back.position.set(0, 1.25, 1.6); back.rotation.y = Math.PI;
    // Handrails beside the windows and a strip of ceiling lights.
    const railMat = keep(new THREE.MeshStandardMaterial({ color: col(p.warn), roughness: 0.5 }));
    for (const x of [-1.05, 1.05]) { const r = add(new THREE.CylinderGeometry(0.016, 0.016, 0.7, 10), railMat); r.position.set(x, 1.5, -1.42); }
    const lampMat = keep(new THREE.MeshBasicMaterial({ color: col(p.fg) }));
    for (const x of [-0.6, 0, 0.6]) { const l = add(new THREE.BoxGeometry(0.4, 0.02, 0.08), lampMat, false); l.position.set(x, 2.49, -0.4); }
    // The console: a sloped desk under the windows (side profile extruded across the cabin).
    const prof = new THREE.Shape(); prof.moveTo(1.48, -0.3); prof.lineTo(1.48, 0.95); prof.lineTo(0.9, 0.8); prof.lineTo(0.9, -0.3); prof.lineTo(1.48, -0.3);
    const desk = add(new THREE.ExtrudeGeometry(prof, { depth: 2.6, bevelEnabled: false }).rotateY(Math.PI / 2).translate(-1.3, 0, 0), darkMat);
    desk.receiveShadow = true;
    const slopeAng = Math.atan2(0.15, 0.58), screenRot = -(Math.PI / 2 - slopeAng);
    const screenGs: CanvasRenderingContext2D[] = [], screenTex: THREE.CanvasTexture[] = [];
    [-0.66, 0, 0.66].forEach((x) => {
      const { c, g } = canvas(512, 300); screenGs.push(g);
      const t = keep(new THREE.CanvasTexture(c)); t.colorSpace = THREE.SRGBColorSpace; screenTex.push(t);
      const s = add(new THREE.PlaneGeometry(0.56, 0.33), keep(new THREE.MeshBasicMaterial({ map: t })), false);
      s.position.set(x, 0.88 + 0.006, -1.19); s.rotation.x = screenRot;
    });
    // Rows of indicator lights along the front edge.
    const ledN = 28, leds = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.03, 0.012, 0.02)), keep(new THREE.MeshBasicMaterial()), ledN);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -slopeAng);
    for (let i = 0; i < ledN; i++) { m4.compose(new THREE.Vector3(-1.2 + (i * 2.4) / (ledN - 1), 0.81, -0.95), q, new THREE.Vector3(1, 1, 1)); leds.setMatrixAt(i, m4); leds.setColorAt(i, col(p.fg)); }
    cabin.add(leds);
    // The astronaut's hands on the console.
    const gc = { suit: col(p.metal), ring: col(p.dark), dark: col(p.dark) };
    const hands = ([-1, 1] as const).map((s) => {
      const gl = makeGlove(s, gc, 0.9); dispose.push(gl);
      gl.group.position.set(s * 0.27, 0.85, -0.97); gl.group.rotation.set(0.42, s * 0.55, 0); gl.setGrip(0.35);
      cabin.add(gl.group); return gl;
    });
    // A checklist card floating in zero-g.
    const { c: cardC, g: cg } = canvas(256, 360);
    cg.fillStyle = css(p.fg); cg.fillRect(0, 0, 256, 360); cg.fillStyle = css(p.space); cg.font = '700 22px ui-monospace, Consolas, monospace';
    cg.fillText('AER-1', 16, 36); cg.font = '16px ui-monospace, Consolas, monospace'; cg.fillText('ENTRY CHECKLIST', 16, 62);
    for (let i = 0; i < 9; i++) { cg.fillRect(16, 92 + i * 28, 14, 14); cg.fillRect(40, 97 + i * 28, 120 + ((i * 37) % 70), 4); }
    const cardTex = keep(new THREE.CanvasTexture(cardC)); cardTex.colorSpace = THREE.SRGBColorSpace;
    const card = add(new THREE.BoxGeometry(0.13, 0.18, 0.003), keep(new THREE.MeshStandardMaterial({ map: cardTex, roughness: 0.9 })));
    const cardV = new THREE.Vector3(), cardSpin = new THREE.Vector3(0.25, 0.4, 0.15), cardHome = new THREE.Vector3(0.28, 1.3, -0.62);
    card.position.copy(cardHome);
    // Window glass behind each frame (the front wall hides its square corners): frost at the cold edges, smudges.
    const glassMat = keep(new THREE.MeshBasicMaterial({ map: keep(glassTexture(p)), transparent: true, depthWrite: false }));
    for (const w of WIN) { const gl = add(new THREE.PlaneGeometry(WIN_W + 0.04, WIN_H + 0.04), glassMat, false); gl.position.set(w.x, w.y, -1.51); gl.receiveShadow = false; }
    // Overhead switch panel above the windows.
    const ohMat = keep(new THREE.MeshStandardMaterial({ map: keep(overheadTexture(p)), roughness: 0.7, metalness: 0.3 }));
    add(new THREE.BoxGeometry(1.7, 0.3, 0.05), [darkMat, darkMat, darkMat, darkMat, ohMat, darkMat]).position.set(0, 2.12, -1.475);
    const tg = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6)), keep(new THREE.MeshStandardMaterial({ color: col(p.metal), metalness: 0.8, roughness: 0.3 })), 12);
    for (let i = 0; i < 12; i++) {
      m4.compose(new THREE.Vector3(-0.85 + ((50 + i * 84) / 1024) * 1.7, 2.12 + 0.01, -1.43), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (i % 3 ? 0.35 : -0.35), 0, 0)), new THREE.Vector3(1, 1, 1));
      tg.setMatrixAt(i, m4);
    }
    cabin.add(tg);
    // Fire extinguisher (left) and a portable O₂ bottle (right), strapped to the front wall, with stencils.
    const bottle = (x: number, colour: RGB, lines: string[]) => {
      const b = add(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 20), keep(new THREE.MeshStandardMaterial({ color: col(colour), roughness: 0.45, metalness: 0.2 })));
      b.position.set(x, 1.12, -1.43);
      const neck = add(new THREE.CylinderGeometry(0.02, 0.03, 0.07, 12), darkMat); neck.position.set(x, 1.32, -1.43);
      for (const y of [1.02, 1.22]) { const strap = add(new THREE.BoxGeometry(0.13, 0.025, 0.12), darkMat); strap.position.set(x, y, -1.44); }
      const tag = add(new THREE.PlaneGeometry(0.2, 0.075), keep(new THREE.MeshStandardMaterial({ map: keep(labelTexture(lines, p.fg, p.dark)), roughness: 0.8 })), false);
      tag.position.set(x, 0.86, -1.495);
    };
    bottle(-1.32, p.alarm, ['FIRE']); bottle(1.32, p.metal, ['O₂ · PBA']);
    // Soft cargo bags strapped to the side walls, near the front.
    ([[-1, 1.85, 'CTB-04'], [-1, 0.45, 'FOOD 7'], [1, 1.85, 'MED KIT'], [1, 0.45, 'CTB-11']] as const).forEach(([s, y, tagText]) => {
      const bag = add(new THREE.BoxGeometry(0.22, 0.42, 0.55), keep(new THREE.MeshStandardMaterial({ map: keep(fabricTexture(p, tagText)), roughness: 1 })));
      bag.position.set(s * 1.48, y, -1.05); bag.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2;
      bag.scale.set(1, 1, 1 - Math.abs(y - 1) * 0.05);
      for (const dz of [-0.16, 0.16]) { const strap = add(new THREE.BoxGeometry(0.235, 0.44, 0.03), railMat); strap.position.set(s * 1.48, y, -1.05 + dz); }
    });
    // Cable bundles along the upper corners, sagging between clips.
    ([-1, 1] as const).forEach((s) => {
      const pts = [new THREE.Vector3(s * 1.55, 2.38, -1.46), new THREE.Vector3(s * 1.54, 2.3, -0.9), new THREE.Vector3(s * 1.55, 2.37, -0.4), new THREE.Vector3(s * 1.54, 2.29, 0.2), new THREE.Vector3(s * 1.55, 2.36, 0.8)];
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.022, 8, false), darkMat);
    });
    // Loose things in zero-g: a drink pouch, a pen, a coiled cable and a few water droplets.
    const floaters: { o: THREE.Object3D; home: THREE.Vector3; spin: THREE.Vector3; ph: number }[] = [];
    const float = (o: THREE.Object3D, home: [number, number, number], spin: [number, number, number]) => {
      o.position.set(...home); floaters.push({ o, home: o.position.clone(), spin: new THREE.Vector3(...spin), ph: floaters.length * 1.7 });
    };
    float(add(new THREE.BoxGeometry(0.075, 0.11, 0.02), keep(new THREE.MeshStandardMaterial({ color: col(p.metal), metalness: 0.85, roughness: 0.25 }))), [-0.42, 1.12, -0.6], [0.3, 0.5, 0.2]);
    float(add(new THREE.CylinderGeometry(0.004, 0.004, 0.13, 8), keep(new THREE.MeshStandardMaterial({ color: col(p.sat), roughness: 0.4 }))), [0.12, 1.42, -0.8], [0.9, 0.2, 0.6]);
    float(add(new THREE.TorusGeometry(0.05, 0.005, 8, 32), darkMat), [0.5, 1.08, -0.75], [0.2, 0.7, 0.35]);
    const dropMat = keep(new THREE.MeshStandardMaterial({ color: col(p.fg), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55 }));
    for (let i = 0; i < 7; i++) float(add(new THREE.SphereGeometry(0.004 + (i % 3) * 0.003, 12, 8), dropMat, false), [-0.15 + i * 0.05, 1.22 + Math.sin(i * 2.1) * 0.06, -0.55 - (i % 2) * 0.1], [0, 0, 0]);
    // Light: dim cabin light, the alarm light, and the Sun through the windows (casts the window shapes).
    cabin.add(new THREE.AmbientLight(col(p.dust), 0.35));
    const lamp = new THREE.PointLight(col(p.fg), 6, 6, 1.6); lamp.position.set(0, 2.3, -0.2); cabin.add(lamp);
    const red = new THREE.PointLight(col(p.alarm), 0, 6, 1.4); red.position.set(0, 2.0, -0.6); cabin.add(red);
    const glow = new THREE.PointLight(col(p.fg), 1.4, 1.3, 2); glow.position.set(0, 1.0, -1.0); cabin.add(glow); // screens light the gloves
    const sun = new THREE.DirectionalLight(col(p.fg), 4.5);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0008;
    Object.assign(sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 0.5, far: 14 });
    sun.target.position.set(0, 1, -0.4); cabin.add(sun); cabin.add(sun.target);
    const sunBase = new THREE.Vector3(1.6, 1.1, -4.2); // toward the Sun, ahead and to the right: light comes in through the windows

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false; renderer.setClearColor(col(p.space));
    host.prepend(renderer.domElement);
    const size = () => {
      const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
      renderer.setSize(w, h, false);
      for (const c of [cam, spCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
    };
    size(); const ro = new ResizeObserver(size); ro.observe(host);

    const sunDir = new THREE.Vector3(), spinQ = new THREE.Quaternion(), shake = new THREE.Vector3();
    let lastScreen = -1, lastT = 0;
    const frame = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      if (!play.current.on) return;
      const T = (now - play.current.t0) / 1000, dt = Math.min(0.05, Math.max(0, T - lastT)); lastT = T;
      const st = cruiseAt(T), alarm = st.alarm, blink = Math.floor(T * 4) % 2 === 0;
      const prox = smooth(CABIN_S.lapse - PROX_S, CABIN_S.lapse - PROX_S + 0.15, T);
      // The ship's slow spin (shown slower than the time-lapse would, so it reads): the stars, Mars' lit side and
      // the sunlight all turn about the axis out through the windows.
      const spin = T * 0.55;
      spinQ.setFromAxisAngle(axis, spin);
      outside.quaternion.copy(spinQ);
      sunDir.copy(sunBase).applyQuaternion(spinQ);
      sun.position.copy(sun.target.position).add(sunDir);
      // Mars along the window axis, at its true distance; its apparent size follows (marsAngularRadius).
      const d = st.marsKm / 1000;
      const local = axis.clone().multiplyScalar(d).applyQuaternion(spinQ.clone().invert());
      mars.position.copy(local); halo.position.copy(local);
      (dotGeo.attributes.position as THREE.BufferAttribute).setXYZ(0, local.x, local.y, local.z); dotGeo.attributes.position.needsUpdate = true;
      const ang = marsAngularRadius(st.marsKm);
      dotMat.opacity = Math.max(0, 1 - ang / 0.004);
      mars.rotation.y = T * 0.05;
      sunOut.position.copy(local).add(sunBase.clone().normalize().multiplyScalar(-50).negate()); sunOut.target.position.copy(local);
      // Camera: breathing sway; a hard shake once the alarm sounds.
      const sh = alarm ? 0.012 : 0;
      shake.set((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, 0);
      // The astronaut glances down at the orbit screen mid-cruise, then snaps to the alert screen when it goes off.
      const gl = smooth(1.4, 2.0, T) * (1 - smooth(2.9, 3.6, T)), ga = smooth(CABIN_S.lapse - PROX_S + 0.1, CABIN_S.lapse - PROX_S + 0.45, T);
      cam.position.set(CAM.x + Math.sin(T * 0.7) * 0.004, CAM.y + Math.sin(T * 1.1) * 0.006, CAM.z).add(shake);
      cam.lookAt(LOOK.x - gl * 0.55 + ga * 0.5 + shake.x * 2, LOOK.y - gl * 0.42 - ga * 0.3 + shake.y * 2, LOOK.z);
      spCam.quaternion.copy(cam.quaternion);
      // Cabin: the card drifts; the alarm turns the lights red and jolts things.
      if (alarm > 0 && cardV.lengthSq() === 0) cardV.set(0.12, 0.25, 0.18);
      cardV.multiplyScalar(0.995).add(cardHome.clone().sub(card.position).multiplyScalar(dt * 0.6));
      card.position.addScaledVector(cardV, dt);
      card.position.y += Math.sin(T * 0.8) * 0.0008;
      card.rotation.x += cardSpin.x * dt * (1 + alarm * 6); card.rotation.y += cardSpin.y * dt * (1 + alarm * 6); card.rotation.z += cardSpin.z * dt;
      for (const f of floaters) {
        f.o.position.set(f.home.x + Math.sin(T * 0.37 + f.ph) * 0.035, f.home.y + Math.sin(T * 0.29 + f.ph * 1.3) * 0.045, f.home.z + Math.sin(T * 0.23 + f.ph) * 0.025);
        f.o.rotation.x += f.spin.x * dt; f.o.rotation.y += f.spin.y * dt; f.o.rotation.z += f.spin.z * dt;
      }
      red.color.copy(col(prox > 0 && !alarm ? p.warn : p.alarm));
      red.intensity = Math.max(alarm * (blink ? 14 : 2), prox * (blink ? 9 : 1.5)); lamp.intensity = alarm ? 2 : prox ? 4 : 6;
      hands.forEach((h, i) => { h.setGrip(0.35 + Math.max(alarm, prox * 0.6) * 0.55); h.group.position.y = 0.85 + Math.sin(T * 1.3 + i) * 0.003 + shake.y; });
      for (let i = 0; i < ledN; i++) leds.setColorAt(i, col(alarm || prox ? (blink && i % 2 ? p.alarm : p.warn) : (i * 7 + Math.floor(T * 2)) % 11 === 0 ? p.warn : p.fg));
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true;
      const tick = Math.floor(T * 10);
      if (tick !== lastScreen) { lastScreen = tick; drawScreens(screenGs, st, p, blink, prox); for (const t of screenTex) t.needsUpdate = true; }
      renderer.clear(); renderer.render(space, spCam); renderer.clearDepth(); renderer.render(cabin, cam);
      // Captions.
      if (cap.current) {
        const msg = alarm ? '▲ MASTER ALARM · DESCENT ENGINE FAULT'
          : prox ? '▲ PROXIMITY ALERT · UNTRACKED OBJECT ON INTERCEPT'
          : st.day < 20 ? `DAY ${Math.floor(st.day)} · LEFT EARTH ORBIT · CRUISE TO MARS`
          : st.day < 199 ? `DAY ${Math.floor(st.day)} · DEEP SPACE CRUISE`
          : 'DAY 203 · MARS APPROACH · PREPARING FOR ENTRY';
        if (cap.current.textContent !== msg) cap.current.textContent = msg;
        cap.current.dataset.alert = alarm || prox ? '1' : '0';
      }
      if (fade.current) fade.current.style.opacity = String(Math.min(1, Math.max(0, 1 - T / 0.6, (T - (CABIN_S.lapse - 0.3)) / 0.3)));
    };
    raf = requestAnimationFrame(frame);

    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect();
      for (const d of dispose) d.dispose();
      renderer.domElement.remove(); renderer.dispose(); renderer.forceContextLoss();
    };
  }, [prepare]);

  return (
    <div ref={root} className={`cabin-cruise${active ? ' on' : ''}`} aria-hidden={!active}>
      <div className="cab-visor" />
      <p ref={cap} className="cab-cap" />
      <p className="cab-note">Simulated cabin · AER-1 is fictional · 203 days, ~472 million km and the 2 rpm cruise spin follow NASA's Perseverance (2020–21) · time-lapse</p>
      <div ref={fade} className="cab-fade" />
    </div>
  );
}
