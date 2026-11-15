// Map role: the "locating" shot right after the crash. The suit's navigation computer finds the astronaut: the view
// drops from orbit onto Jezero crater, then onto the real HiRISE map tile (orthomosaic draped on the 10 m DTM), and
// settles on the AER-1 cabin with the NASA sites around it labelled. The camera path lives in locate.ts.
// The regional views above the map tile are SCHEMATIC (craters, the delta fan and the channels are drawn for the
// shot, at Jezero's real position and size); the caption says so. Colours come from the :root palette.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { geoToLocal, JEZERO, localToGeo, niceScale, OBLIQUE, shotAt, ZOOM_ALT, ZOOM_S, type GeoRef } from './locate';
import './orbitZoom.css';

interface PackLite {
  imageUrl: string;
  area: { widthM: number; heightM: number; eMin: number; nMax: number };
  elevation: { cols: number; rows: number; cellM: number; heightsM: number[] };
  crashedLander: { cabinLocation: { lat: number; lon: number; eastingM: number; northingM: number } };
  hardwareSites?: { id: string; name: string; eastingM: number; northingM: number }[];
}

type RGB = [number, number, number];
function rgb(name: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (k: RGB, a = 1) => `rgba(${k[0]},${k[1]},${k[2]},${a})`;
const col = (k: RGB) => new THREE.Color(k[0] / 255, k[1] / 255, k[2] / 255);

function mulberry(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

interface Disc { x: number; z: number; r: number; k?: number; a?: number }
const HEIGHT_X = 1.6; // same vertical exaggeration as the 3D game view

/** Craters and albedo blobs in the local frame (metres from the cabin), the same list for every painted layer. */
function makeSurface(J: { x: number; z: number }) {
  const rnd = mulberry(20210218);
  const craters: Disc[] = [], blobs: Disc[] = [];
  const pareto = (lo: number, hi: number) => lo / Math.pow(1 - rnd() * (1 - Math.pow(lo / hi, 2)), 0.5);
  const around = (cx: number, cz: number, span: number, n: number, lo: number, hi: number, out: Disc[], blob = false) => {
    for (let i = 0; i < n; i++) {
      const d: Disc = { x: cx + (rnd() - 0.5) * span, z: cz + (rnd() - 0.5) * span, r: pareto(lo, hi) };
      // Keep Jezero's rim and floor free of big craters so it reads as one crater.
      const dj = Math.hypot(d.x - J.x, d.z - J.z);
      if (!blob && d.r > 2_000 && Math.abs(dj - JEZERO.radiusM) < d.r + 4_000) continue;
      if (!blob && d.r > 600 && dj < JEZERO.radiusM - d.r) continue;
      if (blob) { d.k = Math.floor(rnd() * 3); d.a = 0.05 + rnd() * 0.12; }
      out.push(d);
    }
  };
  around(0, 0, 900_000, 520, 12_000, 90_000, blobs, true);
  around(J.x, J.z, 200_000, 900, 2_000, 14_000, blobs, true);
  around(J.x, J.z, 64_000, 1_400, 200, 2_500, blobs, true);
  around(0, 0, 900_000, 70, 4_000, 30_000, craters);
  around(0, 0, 900_000, 1_100, 800, 4_000, craters);
  around(J.x, J.z, 200_000, 2_600, 250, 1_500, craters);
  around(J.x, J.z, 64_000, 6_000, 40, 300, craters);
  craters.sort((a, b) => b.r - a.r);
  return { craters, blobs };
}

interface Pal { sand: RGB; rust: RGB; shadow: RGB; sky: RGB; dust: RGB }

/** Paint one square layer of the schematic surface: `span` metres wide, centred on (cx, cz). */
function paintLayer(size: number, cx: number, cz: number, span: number, s: ReturnType<typeof makeSurface>, J: { x: number; z: number }, p: Pal) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!;
  const k = size / span, X = (x: number) => (x - cx + span / 2) * k, Y = (z: number) => (z - cz + span / 2) * k;
  const inView = (d: Disc, m: number) => X(d.x) > -d.r * k * m && X(d.x) < size + d.r * k * m && Y(d.z) > -d.r * k * m && Y(d.z) < size + d.r * k * m;
  g.fillStyle = css(p.sand); g.fillRect(0, 0, size, size);
  const tones = [p.rust, p.shadow, p.sky];
  for (const b of s.blobs) {
    const R = b.r * k; if (R < 2 || !inView(b, 1)) continue;
    const gr = g.createRadialGradient(X(b.x), Y(b.z), 0, X(b.x), Y(b.z), R);
    gr.addColorStop(0, css(tones[b.k ?? 0], b.a)); gr.addColorStop(1, css(tones[b.k ?? 0], 0));
    g.fillStyle = gr; g.beginPath(); g.arc(X(b.x), Y(b.z), R, 0, Math.PI * 2); g.fill();
  }
  // A dusty wash so the schematic layers sit closer to the tone of the HiRISE tile.
  g.fillStyle = css(p.sky, 0.32); g.fillRect(0, 0, size, size);
  g.fillStyle = css(p.shadow, 0.22); g.fillRect(0, 0, size, size);
  // Sun from the north-west (upper left): the inner wall on that side is in shadow, the far wall lit.
  const crater = (x: number, y: number, R: number, soft = 1) => {
    if (R < 2.5) {
      g.fillStyle = css(p.shadow, 0.45 * soft); g.fillRect(x - R, y - R, R * 1.4, R * 1.4);
      g.fillStyle = css(p.dust, 0.3 * soft); g.fillRect(x, y, R * 0.9, R * 0.9);
      return;
    }
    const ej = g.createRadialGradient(x, y, R * 0.9, x, y, R * 2.1);
    ej.addColorStop(0, css(p.dust, 0.12 * soft)); ej.addColorStop(1, css(p.dust, 0));
    g.fillStyle = ej; g.beginPath(); g.arc(x, y, R * 2.1, 0, Math.PI * 2); g.fill();
    g.save(); g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = css(p.shadow, 0.6 * soft); g.fillRect(x - R, y - R, R * 2, R * 2);
    g.fillStyle = css(p.sky, 0.55 * soft); g.beginPath(); g.arc(x + R * 0.32, y + R * 0.32, R * 0.86, 0, Math.PI * 2); g.fill();
    g.fillStyle = css(p.sand, 0.65 * soft); g.beginPath(); g.arc(x + R * 0.12, y + R * 0.12, R * 0.52, 0, Math.PI * 2); g.fill();
    g.restore();
    g.lineWidth = Math.max(0.8, R * 0.12);
    g.strokeStyle = css(p.dust, 0.4 * soft); g.beginPath(); g.arc(x, y, R * 1.03, Math.PI * 0.75, Math.PI * 1.75); g.stroke();
    g.strokeStyle = css(p.shadow, 0.35 * soft); g.beginPath(); g.arc(x, y, R * 1.03, -Math.PI * 0.25, Math.PI * 0.75); g.stroke();
  };
  const jezero = () => {
    const x = X(J.x), y = Y(J.z), R = JEZERO.radiusM * k;
    if (x < -3 * R || x > size + 3 * R || y < -3 * R || y > size + 3 * R) return;
    const inA = Math.PI + 0.35, outA = -0.25; // Neretva Vallis comes in from the west-north-west, Pliva Vallis leaves east
    const channel = (a: number, len: number, w: number) => {
      const bx = x + Math.cos(a) * R, by = y + Math.sin(a) * R;
      g.strokeStyle = css(p.shadow, 0.55); g.lineWidth = Math.max(1, w * k); g.lineCap = 'round';
      g.beginPath(); g.moveTo(bx, by);
      for (let i = 1; i <= 24; i++) {
        const f = i / 24, d = len * k * f;
        g.lineTo(bx + Math.cos(a) * d + Math.sin(f * 17) * 900 * k * f, by + Math.sin(a) * d + Math.cos(f * 13) * 900 * k * f);
      }
      g.stroke();
    };
    channel(inA, 70_000, 700); channel(outA, 45_000, 500);
    crater(x, y, R, 0.75);
    // Darker lava floor (the Máaz formation is dark), then the light delta fan from the inlet.
    g.fillStyle = css(p.shadow, 0.18); g.beginPath(); g.arc(x, y, R * 0.92, 0, Math.PI * 2); g.fill();
    const bx = x + Math.cos(inA) * R, by = y + Math.sin(inA) * R, fr = 12_300 * k, mid = inA + Math.PI;
    // The fan: overlapping soft lobes spreading from the inlet, each with a shaded front (the scarps face east,
    // away from the sun).
    for (let i = -3; i <= 3; i++) {
      const a = mid + i * 0.24, reach = fr * (0.78 + 0.22 * Math.cos(i * 1.7)), lx = bx + Math.cos(a) * reach * 0.55, ly = by + Math.sin(a) * reach * 0.55;
      const lobe = g.createRadialGradient(lx, ly, 0, lx, ly, reach * 0.5);
      lobe.addColorStop(0, css(p.dust, 0.32)); lobe.addColorStop(0.75, css(p.dust, 0.2)); lobe.addColorStop(1, css(p.dust, 0));
      g.fillStyle = lobe; g.beginPath(); g.arc(lx, ly, reach * 0.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = css(p.shadow, 0.22); g.lineWidth = Math.max(1, 200 * k);
      g.beginPath(); g.arc(lx, ly, reach * 0.46, a - 0.7, a + 0.7); g.stroke();
    }
  };
  let jDone = false;
  for (const c of s.craters) {
    if (!jDone && c.r < 10_000) { jezero(); jDone = true; }
    const R = c.r * k; if (R < 0.7 || !inView(c, 2.2)) continue;
    crater(X(c.x), Y(c.z), R);
  }
  if (!jDone) jezero();
  return cv;
}

/** A soft-edged mask: white in the middle fading to black at the edges (round or rectangular). */
function edgeMask(w: number, h: number, round: boolean, feather: number) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  if (round) {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, '#fff'); gr.addColorStop(1 - feather, '#fff'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  } else {
    g.filter = `blur(${feather * w * 0.35}px)`; g.fillStyle = '#fff';
    g.fillRect(feather * w, feather * w, w - 2 * feather * w, h - 2 * feather * w);
  }
  return cv;
}

const fmtAlt = (m: number) => (m >= 10_000 ? `${(m / 1000).toFixed(0)} km` : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m.toFixed(0)} m`);

interface Props {
  /** Build the scene ahead of time (painting the layers takes a moment). */
  prepare: boolean;
  /** Play the shot (it starts from the beginning each time this turns on). */
  active: boolean;
}

export function OrbitZoom({ prepare, active }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const tele = useRef<HTMLPreElement>(null);
  const stage = useRef<HTMLParagraphElement>(null);
  const ret = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const barTxt = useRef<HTMLElement>(null);
  const lock = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const play = useRef<{ on: boolean; t0: number }>({ on: false, t0: 0 });

  useEffect(() => { play.current = { on: active, t0: performance.now() }; }, [active]);

  useEffect(() => {
    const host = root.current, labelBox = labels.current;
    if (!prepare || !host || !labelBox) return;
    let alive = true, raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    const disposables: { dispose(): void }[] = [];
    const nextTick = () => new Promise((r) => setTimeout(r, 0));

    (async () => {
      const pack = (await (await fetch('/data/jezero_pack.json')).json()) as PackLite;
      if (!alive) return;
      const p: Pal = { sand: rgb('--mars-sand'), rust: rgb('--mars-rust'), shadow: rgb('--mars-shadow'), sky: rgb('--mars-sky'), dust: rgb('--mars-dust') };
      const cab = pack.crashedLander.cabinLocation;
      const ref: GeoRef = { lat: cab.lat, lon: cab.lon };
      const J = geoToLocal(JEZERO.lat, JEZERO.lon, ref);
      const { widthM: W, heightM: H, eMin, nMax } = pack.area;
      const cx = cab.eastingM - eMin, cy = nMax - cab.northingM; // the cabin in map metres (x east, y south)
      const el = pack.elevation;
      const hAt = (mx: number, my: number) => {
        const fx = Math.max(0, Math.min(el.cols - 1.001, mx / el.cellM - 0.5)), fy = Math.max(0, Math.min(el.rows - 1.001, my / el.cellM - 0.5));
        const c = Math.floor(fx), r = Math.floor(fy), tx = fx - c, ty = fy - r, hs = el.heightsM;
        const a = hs[r * el.cols + c], b = hs[r * el.cols + c + 1], d = hs[(r + 1) * el.cols + c], e = hs[(r + 1) * el.cols + c + 1];
        return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      };
      const h0 = hAt(cx, cy);
      const surf = makeSurface(J);

      // Three painted layers, coarse to fine, each a little above the last; the map tile sits on top.
      const layers: { span: number; c: { x: number; z: number }; size: number; round: boolean }[] = [
        { span: 900_000, c: { x: 0, z: 0 }, size: 2048, round: false },
        { span: 200_000, c: J, size: 2048, round: true },
        { span: 64_000, c: J, size: 2048, round: true },
      ];
      const scene = new THREE.Scene();
      // The plains are a little below the cabin: use the average height round the tile's edge.
      let edge = 0, n = 0;
      for (let i = 0; i <= 40; i++) { const f = (i / 40); edge += hAt(f * W, 5) + hAt(f * W, H - 5) + hAt(5, f * H) + hAt(W - 5, f * H); n += 4; }
      const baseY = ((edge / n) - h0) * HEIGHT_X - 4;
      for (let i = 0; i < layers.length; i++) {
        const L = layers[i];
        const tex = new THREE.CanvasTexture(paintLayer(L.size, L.c.x, L.c.z, L.span, surf, J, p));
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        const mask = i === 0 ? null : new THREE.CanvasTexture(edgeMask(256, 256, L.round, 0.35));
        const mat = new THREE.MeshBasicMaterial({ map: tex, alphaMap: mask, transparent: !!mask, depthTest: false, depthWrite: false });
        const geo = new THREE.PlaneGeometry(L.span, L.span).rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(L.c.x, baseY, L.c.z); mesh.renderOrder = -10 + i;
        scene.add(mesh); disposables.push(tex, mat, geo); if (mask) disposables.push(mask);
        await nextTick(); if (!alive) return;
      }

      // The real map: HiRISE orthomosaic on the 10 m DTM (every 2nd post), centred on the cabin.
      const SX = Math.round(W / (el.cellM * 2)), SZ = Math.round(H / (el.cellM * 2));
      const tgeo = new THREE.PlaneGeometry(W, H, SX, SZ).rotateX(-Math.PI / 2);
      const pos = tgeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const mx = pos.getX(i) + W / 2, my = pos.getZ(i) + H / 2;
        pos.setY(i, (hAt(mx, my) - h0) * HEIGHT_X);
      }
      tgeo.translate(W / 2 - cx, 0, H / 2 - cy); tgeo.computeVertexNormals();
      const ortho = await new THREE.TextureLoader().loadAsync(pack.imageUrl);
      if (!alive) { ortho.dispose(); return; }
      ortho.colorSpace = THREE.SRGBColorSpace; ortho.anisotropy = 8;
      const tmask = new THREE.CanvasTexture(edgeMask(320, 200, false, 0.13));
      const tint = col(p.sand).lerp(col(p.dust), 0.3);
      const tmat = new THREE.MeshStandardMaterial({ map: ortho, alphaMap: tmask, transparent: true, color: tint, roughness: 1, metalness: 0 });
      const tile = new THREE.Mesh(tgeo, tmat);
      scene.add(tile); disposables.push(tgeo, tmat, ortho, tmask);
      scene.add(new THREE.AmbientLight(col(p.dust), 2.1));
      const sun = new THREE.DirectionalLight(col(p.dust), 1.5); sun.position.set(-1, 0.9, -0.8); scene.add(sun);

      // The cabin: a pulsing ring on the ground and a tall beam.
      const warn = col(rgb('--warning'));
      const ringGeo = new THREE.RingGeometry(16, 24, 48).rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({ color: warn, transparent: true, opacity: 0.9, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.y = 1.5; scene.add(ring);
      const beamGeo = new THREE.CylinderGeometry(2.5, 2.5, 500, 12, 1, true);
      const beamMat = new THREE.MeshBasicMaterial({ color: warn, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 250; scene.add(beam);
      disposables.push(ringGeo, ringMat, beamGeo, beamMat);

      // Labels: Jezero from orbit, then the NASA sites round the cabin once the map tile fills the view.
      type Lab = { el: HTMLDivElement; at: THREE.Vector3; minAlt: number; maxAlt: number; you?: boolean };
      const labs: Lab[] = [];
      const addLab = (text: string, at: THREE.Vector3, minAlt: number, maxAlt: number, you = false) => {
        const d = document.createElement('div'); d.className = you ? 'oz-lab you' : 'oz-lab'; d.textContent = text;
        labelBox.appendChild(d); labs.push({ el: d, at, minAlt, maxAlt, you });
      };
      addLab('JEZERO CRATER · ≈45 km', new THREE.Vector3(J.x, baseY, J.z - JEZERO.radiusM * 1.12), 25_000, 1e9);
      addLab('DELTA', new THREE.Vector3(-6_500, baseY, -2_500), 9_000, 70_000);
      const skip = new Set(['wright_brothers_field']); // sits on top of the landing site
      for (const s of pack.hardwareSites ?? []) {
        if (skip.has(s.id)) continue;
        const mx = s.eastingM - eMin, my = nMax - s.northingM;
        addLab(s.name, new THREE.Vector3(mx - cx, (hAt(mx, my) - h0) * HEIGHT_X + 6, my - cy), 0, 9_000);
      }
      addLab('AER-1 CABIN · YOU', new THREE.Vector3(0, 30, 0), 0, 9_000, true);

      renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(col(rgb('--space')));
      host.prepend(renderer.domElement);
      const cam = new THREE.PerspectiveCamera(45, 1, 0.5, 3e6);
      const size = () => {
        const w = host.clientWidth || innerWidth, h = host.clientHeight || innerHeight;
        renderer!.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
      };
      size();
      const ro = new ResizeObserver(size); ro.observe(host);
      disposables.push({ dispose: () => ro.disconnect() });

      const v = new THREE.Vector3(), aim = new THREE.Vector3();
      const nadirUp = new THREE.Vector3(), up = new THREE.Vector3();
      const frame = (now: number) => {
        if (!alive) return;
        raf = requestAnimationFrame(frame);
        if (!play.current.on) return;
        const T = (now - play.current.t0) / 1000;
        const s = shotAt(T);
        const h = (s.headingDeg * Math.PI) / 180;
        // During the drop the screen's "up" turns to match the direction the oblique camera will look (toward the
        // delta front), so the tilt at the end needs no roll.
        const fwd = { x: -Math.cos(h), z: -Math.sin(h) };
        const yaw0 = Math.atan2(fwd.x, -fwd.z) + 0.6 * (1 - s.aim);
        nadirUp.set(Math.sin(yaw0), 0, -Math.cos(yaw0));
        aim.set(J.x + (0 - J.x) * s.aim, 0, J.z + (0 - J.z) * s.aim);
        if (s.tilt <= 0) {
          cam.position.set(aim.x, s.alt, aim.z); up.copy(nadirUp);
        } else {
          const elev = (90 + (OBLIQUE.elevDeg - 90) * s.tilt) * Math.PI / 180;
          const dist = ZOOM_ALT.to + (OBLIQUE.distM - ZOOM_ALT.to) * s.tilt;
          cam.position.set(Math.cos(elev) * Math.cos(h) * dist, Math.sin(elev) * dist, Math.cos(elev) * Math.sin(h) * dist);
          up.copy(nadirUp).lerp(v.set(0, 1, 0), s.tilt).normalize();
        }
        cam.up.copy(up); cam.lookAt(aim);
        const pulse = 1 + 0.25 * Math.sin(T * 6);
        ring.scale.setScalar(pulse * Math.max(1, cam.position.y / 900));
        ringMat.opacity = cam.position.y > 30_000 ? 0 : 0.6 + 0.3 * Math.sin(T * 6);
        // The real map resolves as the suit's nav gets a fix: the HiRISE tile fades in between 22 km and 9 km.
        tmat.opacity = Math.max(0, Math.min(1, (22_000 - cam.position.y) / 13_000));
        beamMat.opacity = 0.35 * tmat.opacity;
        renderer!.render(scene, cam);

        // HUD: telemetry, stage, reticle, labels, scale bar, lock card, fades.
        const W2 = host.clientWidth, H2 = host.clientHeight;
        const altNow = cam.position.y;
        const g = localToGeo(aim.x, aim.z, ref);
        const src = s.stage === 'orbit' || s.stage === 'crater' ? 'SCHEMATIC REGIONAL VIEW' : 'HiRISE ORTHO + DTM · 1 px ≈ 2 m';
        if (tele.current) tele.current.textContent = `SUIT NAV · ORBITAL FIX\nALT   ${fmtAlt(altNow)}\nLAT   ${g.lat.toFixed(4)}°N\nLON   ${g.lon.toFixed(4)}°E\nMAP   ${src}`;
        if (stage.current) stage.current.textContent = { orbit: 'ACQUIRING · MARS ORBIT', crater: 'JEZERO CRATER', site: 'WESTERN DELTA FRONT', locked: 'POSITION LOCKED' }[s.stage];
        const proj = (at: THREE.Vector3) => { v.copy(at).project(cam); return { x: (v.x * 0.5 + 0.5) * W2, y: (-v.y * 0.5 + 0.5) * H2, ok: v.z < 1 && v.z > -1 }; };
        if (ret.current) {
          const c = proj(aim), sz = 220 - 184 * s.aim;
          ret.current.style.transform = `translate(${c.x - sz / 2}px, ${c.y - sz / 2}px)`;
          ret.current.style.width = ret.current.style.height = `${sz}px`;
          ret.current.style.opacity = s.stage === 'locked' ? '0' : '1';
        }
        for (const L of labs) {
          const c = proj(L.at), show = c.ok && altNow >= L.minAlt && altNow < L.maxAlt && c.x > -50 && c.x < W2 + 50 && c.y > 0 && c.y < H2;
          L.el.style.opacity = show ? '1' : '0';
          if (show) L.el.style.transform = `translate(${c.x}px, ${c.y}px)`;
        }
        if (bar.current && barTxt.current) {
          const dist = cam.position.distanceTo(aim);
          const sc = niceScale((2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / H2);
          bar.current.style.width = `${sc.px}px`; barTxt.current.textContent = sc.label;
        }
        const end = ZOOM_S.descend + ZOOM_S.tilt + ZOOM_S.hold;
        if (lock.current) lock.current.style.opacity = String(Math.max(0, Math.min(1, (T - ZOOM_S.descend - ZOOM_S.tilt * 0.8) / 0.4)));
        if (fade.current) fade.current.style.opacity = String(Math.max(0, 1 - T / 0.6, (T - (end - 0.45)) / 0.45));
      };
      raf = requestAnimationFrame(frame);
    })().catch((e) => console.warn('OrbitZoom: could not build the locating shot', e));

    return () => {
      alive = false; cancelAnimationFrame(raf);
      for (const d of disposables) d.dispose();
      if (renderer) { renderer.domElement.remove(); renderer.dispose(); }
      labelBox.textContent = '';
    };
  }, [prepare]);

  return (
    <div ref={root} className={`orbit-zoom${active ? ' on' : ''}`} aria-hidden={!active}>
      <div ref={labels} className="oz-labels" />
      <div ref={ret} className="oz-reticle"><i /><i /><i /><i /></div>
      <pre ref={tele} className="oz-tele" />
      <p ref={stage} className="oz-stage" />
      <div className="oz-scale"><span ref={bar} /><b ref={barTxt} /></div>
      <div ref={lock} className="oz-lock">
        <strong>POSITION LOCKED · AER-1 CABIN</strong>
        <span>18.4485°N 77.4402°E · Jezero crater, Mars</span>
        <p>Plan every Marswalk so you make it back to the cabin before your O₂ runs out.</p>
      </div>
      <p className="oz-credit">Regional view: schematic (Jezero at its real place and size, ≈45 km) · Close-up: HiRISE orthomosaic + DTM, USGS (DOI 10.5066/P9REJ9JN), height ×1.6 · archived data, not live</p>
      <div ref={fade} className="oz-fade" />
    </div>
  );
}
