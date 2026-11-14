// LOCAL DRAFT (Aiman, not pushed): the intro's Earth as a lit 3D globe instead of a flat photo, in the style of the
// AURIS black hole (one canvas: a big sphere, light escaping round its lower edge, particles that orbit it and hide
// behind it). The Apollo 17 photo (the file the intro already credits) is wrapped onto a sphere that slowly turns.
// One photo only shows one side of Earth, so the turn swings back and forth; a full spin needs a NASA world map
// image (ask the Data role with a PR).
import { useEffect, useRef } from 'react';

const PHOTO = '/data/earth_apollo17.jpg';
// Where the Earth disc sits in the photo (same numbers as the intro's old clip-path): centre and radius as fractions.
const DISC = { cx: 0.502, cy: 0.508, r: 0.331 };
const SWING_RAD = 0.36;   // ±20° of turn
const SWING_S = 46;       // seconds for one full swing
const TILT_RAD = 0.41;    // 23.5° axial tilt, for the orbiting particles
const REDRAW_RAD = 0.0012; // re-shade the sphere only after it has turned this much (it turns slowly)

interface Particle { a: number; v: number; k: number; y: number; s: number; hot: number }

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function rgb(hex: string, fallback: number): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : fallback;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Per-pixel sphere geometry, worked out once per size: only the photo lookup changes as the globe turns. */
interface Geometry { d: number; u: Float32Array; v: Float32Array; z: Float32Array; light: Float32Array; rim: Float32Array; inside: Uint8Array }
function geometry(d: number): Geometry {
  const n = d * d, g: Geometry = { d, u: new Float32Array(n), v: new Float32Array(n), z: new Float32Array(n), light: new Float32Array(n), rim: new Float32Array(n), inside: new Uint8Array(n) };
  const lx = -0.55, ly = -0.45, lz = 0.7; // sunlight from the upper left, a little in front
  for (let j = 0; j < d; j++) {
    const v = ((j + 0.5) / d) * 2 - 1;
    for (let i = 0; i < d; i++) {
      const u = ((i + 0.5) / d) * 2 - 1, rr = u * u + v * v, k = j * d + i;
      if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      g.inside[k] = 1; g.u[k] = u; g.v[k] = v; g.z[k] = z;
      g.light[k] = 0.25 + 0.95 * Math.max(0, u * lx + v * ly + z * lz);
      // Atmosphere seen edge-on, a little stronger along the lower edge (the backlit side, as on the black hole).
      g.rim[k] = Math.pow(1 - z, 3) * (0.75 + 0.5 * Math.max(0, v));
    }
  }
  return g;
}

export function EarthGlobe({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const glow = rgb(cssVar('--earth-glow', '#7fb2ff'), 0x7fb2ff);
    const hot = rgb(cssVar('--metal', '#dcd8d1'), 0xdcd8d1);
    let photo: ImageData | null = null;
    let w = 0, h = 0, R = 0, raf = 0, alive = true, visible = true, shadedYaw = NaN;
    const t0 = performance.now();
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d');
    let out: ImageData | null = null, geo: Geometry | null = null;

    // Low-orbit traffic: particles circling a tilted axis just above the surface.
    const parts: Particle[] = Array.from({ length: 1400 }, () => ({
      a: Math.random() * Math.PI * 2, v: 0.04 + Math.random() * 0.08, k: 1.04 + Math.random() * 0.24,
      y: (Math.random() - 0.5) * 0.24, s: 0.7 + Math.random() * 1.5, hot: Math.random(),
    }));

    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0);
      photo = g.getImageData(0, 0, img.width, img.height);
      size();
      if (still) draw(performance.now());
    };
    img.src = PHOTO;

    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas!.getBoundingClientRect();
      w = r.width; h = r.height;
      if (!w || !h) return;
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = w * 0.33; // the disc fills 66% of the canvas; the rest is room for the glow and the particles
      // Draw the sphere at the photo's own detail (the disc is ~850 px across in the photo), never more:
      // beyond that there is nothing extra to show, and the canvas scales it up smoothly.
      const native = photo ? Math.round(2 * DISC.r * photo.width) : 850;
      const d = Math.max(64, Math.min(native, Math.round(2 * R * dpr)));
      if (!geo || geo.d !== d) {
        buf.width = d; buf.height = d;
        out = bctx ? bctx.createImageData(d, d) : null;
        geo = geometry(d);
      }
      shadedYaw = NaN;
    }

    /** Shade the sphere: each pixel looks up the photo after turning the globe by `yaw`. */
    function shade(yaw: number) {
      if (!photo || !out || !bctx || !geo) return;
      const { d, u, v, z, light, rim, inside } = geo, P = photo.data, pw = photo.width, ph = photo.height, o = out.data;
      const pcx = DISC.cx * pw, pcy = DISC.cy * ph, pr = DISC.r * pw, cs = Math.cos(yaw), sn = Math.sin(yaw);
      for (let k = 0, n = d * d; k < n; k++) {
        const q = k * 4;
        if (!inside[k]) { o[q + 3] = 0; continue; }
        const qx = u[k] * cs - z[k] * sn, qz = u[k] * sn + z[k] * cs;
        const sx = Math.min(pw - 1, Math.max(0, (pcx + qx * pr) | 0));
        const sy = Math.min(ph - 1, Math.max(0, (pcy + v[k] * pr) | 0));
        const p = (sy * pw + sx) * 4;
        // The photo has no data for the far side: fade into night there, which also reads as the limb.
        const known = Math.min(1, Math.max(0, (qz - 0.02) / 0.22));
        const L = light[k] * (0.35 + 0.65 * known), a = rim[k];
        o[q] = Math.min(255, P[p] * L + glow[0] * a * 0.7);
        o[q + 1] = Math.min(255, P[p + 1] * L + glow[1] * a * 0.75);
        o[q + 2] = Math.min(255, P[p + 2] * L + glow[2] * a * 0.95);
        o[q + 3] = 255;
      }
      bctx.putImageData(out, 0, 0);
      shadedYaw = yaw;
    }

    function draw(now: number) {
      if (!alive || !w) return;
      const t = (now - t0) / 1000, cx = w / 2, cy = h / 2;
      const [r0, g0, b0] = glow, [hr, hg, hb] = hot;
      ctx!.clearRect(0, 0, w, h);

      // Halo: light escaping round the edge, white at the rim falling to blue, brightest below (as on the black hole).
      const halo = ctx!.createRadialGradient(cx, cy + R * 0.06, R * 0.97, cx, cy + R * 0.06, R * 1.42);
      halo.addColorStop(0, `rgba(${hr},${hg},${hb},0)`);
      halo.addColorStop(0.05, `rgba(${hr},${hg},${hb},0.55)`);
      halo.addColorStop(0.12, `rgba(${r0},${g0},${b0},0.42)`);
      halo.addColorStop(0.34, `rgba(${r0},${g0},${b0},0.14)`);
      halo.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      ctx!.fillStyle = halo;
      ctx!.fillRect(0, 0, w, h);

      const yaw = still ? 0 : SWING_RAD * Math.sin((t / SWING_S) * Math.PI * 2);
      if (!(Math.abs(yaw - shadedYaw) < REDRAW_RAD)) shade(yaw);
      ctx!.imageSmoothingEnabled = true;
      ctx!.imageSmoothingQuality = 'high';
      ctx!.drawImage(buf, cx - R, cy - R, 2 * R, 2 * R);

      // Orbiting particles on a tilted ring; the ones behind the globe are hidden.
      ctx!.globalCompositeOperation = 'lighter';
      const ct = Math.cos(TILT_RAD), st = Math.sin(TILT_RAD);
      for (const p of parts) {
        const a = p.a + (still ? 0 : t * p.v);
        const x0 = Math.cos(a) * p.k, z = Math.sin(a) * p.k, y0 = p.y;
        const x = x0 * ct - y0 * st, y = x0 * st + y0 * ct;
        if (z < 0 && x * x + y * y < 1) continue;
        const px = cx + R * x, py = cy + R * y;
        if (px < 0 || py < 0 || px > w || py > h) continue;
        const depth = z < 0 ? 0.45 : 0.75 + 0.25 * z, tw = 0.75 + 0.25 * Math.sin(t * 1.9 + p.hot * 40);
        ctx!.fillStyle = p.hot > 0.85
          ? `rgba(${hr},${hg},${hb},${0.95 * depth * tw})`
          : `rgba(${Math.min(255, r0 + 60)},${Math.min(255, g0 + 40)},${b0},${0.9 * depth * tw})`;
        ctx!.beginPath(); ctx!.arc(px, py, p.s, 0, Math.PI * 2); ctx!.fill();
      }
      ctx!.globalCompositeOperation = 'source-over';
      if (!still && visible) raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(() => { size(); if (still) draw(performance.now()); });
    ro.observe(canvas); size();
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !still) raf = requestAnimationFrame(draw);
    });
    io.observe(canvas);
    if (!still) raf = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); img.onload = null; };
  }, [still]);

  return <canvas ref={ref} className="earth-globe" aria-hidden="true" />;
}
