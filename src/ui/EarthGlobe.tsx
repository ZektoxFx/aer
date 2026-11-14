// LOCAL DRAFT (Aiman, not pushed): the intro's Earth as a lit 3D globe instead of a flat photo, in the style of the
// AURIS black hole (one canvas: a sphere, a glowing rim, particles that orbit it and hide behind it).
// The Apollo 17 photo (the same file the intro already credits) is wrapped onto a sphere that slowly turns. One photo
// only shows one side of Earth, so the turn swings back and forth; a full spin needs a NASA world map image (ask Data).
import { useEffect, useRef } from 'react';

const PHOTO = '/data/earth_apollo17.jpg';
// Where the Earth disc sits in the photo (same numbers as the intro's clip-path): centre and radius as fractions.
const DISC = { cx: 0.502, cy: 0.508, r: 0.331 };
const SWING_RAD = 0.36;   // ±20° of turn
const SWING_S = 46;       // seconds for one full swing
const TILT_RAD = 0.41;    // 23.5° axial tilt, for the orbiting particles
const GLOBE_PX = 560;     // the sphere is drawn at most this wide, then scaled (keeps it fast)

interface Particle { a: number; v: number; k: number; y: number; s: number; hot: number }

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x7fb2ff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function EarthGlobe({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const glow = rgb(cssVar('--earth-glow', '#7fb2ff'));
    let photo: ImageData | null = null;
    let w = 0, h = 0, R = 0, raf = 0, alive = true, visible = true;
    const t0 = performance.now();
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d');
    let out: ImageData | null = null;

    // Low-orbit traffic: particles circling a tilted axis just above the surface.
    const parts: Particle[] = Array.from({ length: 1200 }, () => ({
      a: Math.random() * Math.PI * 2, v: 0.05 + Math.random() * 0.09, k: 1.04 + Math.random() * 0.2,
      y: (Math.random() - 0.5) * 0.22, s: 0.8 + Math.random() * 1.6, hot: Math.random(),
    }));

    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0);
      photo = g.getImageData(0, 0, img.width, img.height);
      if (still) draw(performance.now());
    };
    img.src = PHOTO;

    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas!.getBoundingClientRect();
      w = r.width; h = r.height;
      if (!w || !h) return;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = w * 0.33; // the disc is 99vmin across inside a 150vmin canvas, as before
      const d = Math.min(GLOBE_PX, Math.round(2 * R * dpr));
      buf.width = d; buf.height = d;
      out = bctx ? bctx.createImageData(d, d) : null;
    }

    /** The globe: each pixel of the sphere looks up the photo after turning the sphere by `yaw`. */
    function globe(yaw: number) {
      if (!photo || !out || !bctx) return;
      const d = out.width, P = photo.data, pw = photo.width, ph = photo.height;
      const pcx = DISC.cx * pw, pcy = DISC.cy * ph, pr = DISC.r * pw;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const o = out.data;
      // Sunlight from the upper left, a little in front.
      const lx = -0.55, ly = -0.45, lz = 0.7;
      for (let j = 0; j < d; j++) {
        const v = (j + 0.5) / d * 2 - 1;
        for (let i = 0; i < d; i++) {
          const u = (i + 0.5) / d * 2 - 1, rr = u * u + v * v, k = (j * d + i) * 4;
          if (rr > 1) { o[k + 3] = 0; continue; }
          const z = Math.sqrt(1 - rr);
          // Turn the view point back into the photo's frame (rotation about the vertical axis).
          const qx = u * cs - z * sn, qz = u * sn + z * cs;
          const sx = Math.min(pw - 1, Math.max(0, Math.round(pcx + qx * pr)));
          const sy = Math.min(ph - 1, Math.max(0, Math.round(pcy + v * pr)));
          const pk = (sy * pw + sx) * 4;
          // The photo has no data for the far side: fade into night there, which also reads as the limb.
          const known = Math.min(1, Math.max(0, (qz - 0.02) / 0.22));
          const sun = Math.max(0, u * lx + v * ly + z * lz);
          const light = (0.25 + 0.95 * sun) * (0.35 + 0.65 * known);
          // A thin blue haze toward the edge (the atmosphere seen edge-on).
          const rim = Math.pow(1 - z, 3);
          o[k] = Math.min(255, P[pk] * light + glow[0] * rim * 0.7);
          o[k + 1] = Math.min(255, P[pk + 1] * light + glow[1] * rim * 0.7);
          o[k + 2] = Math.min(255, P[pk + 2] * light + glow[2] * rim * 0.9);
          o[k + 3] = 255;
        }
      }
      bctx.putImageData(out, 0, 0);
    }

    function draw(now: number) {
      if (!alive || !w) return;
      const t = (now - t0) / 1000;
      const cx = w / 2, cy = h / 2;
      ctx!.clearRect(0, 0, w, h);
      // Atmosphere glow outside the disc.
      const g = ctx!.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.22);
      const [r0, g0, b0] = glow;
      g.addColorStop(0, `rgba(${r0},${g0},${b0},0.55)`);
      g.addColorStop(0.18, `rgba(${r0},${g0},${b0},0.22)`);
      g.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
      ctx!.fillStyle = g;
      ctx!.beginPath(); ctx!.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx!.fill();

      const yaw = still ? 0 : SWING_RAD * Math.sin((t / SWING_S) * Math.PI * 2);
      globe(yaw);
      ctx!.imageSmoothingQuality = 'high';
      ctx!.drawImage(buf, cx - R, cy - R, 2 * R, 2 * R);

      // Orbiting particles on a tilted ring; the ones behind the globe are hidden.
      ctx!.globalCompositeOperation = 'lighter';
      const ct = Math.cos(TILT_RAD), st = Math.sin(TILT_RAD);
      for (const p of parts) {
        const a = p.a + (still ? 0 : t * p.v);
        const x0 = Math.cos(a) * p.k, z0 = Math.sin(a) * p.k, y0 = p.y;
        const x = x0 * ct - y0 * st, y = x0 * st + y0 * ct, z = z0;
        if (z < 0 && x * x + y * y < 1) continue;
        const px = cx + R * x, py = cy + R * y;
        if (px < 0 || py < 0 || px > w || py > h) continue;
        const depth = z < 0 ? 0.45 : 0.75 + 0.25 * z;
        const tw = 0.75 + 0.25 * Math.sin(t * 1.9 + p.hot * 40);
        ctx!.fillStyle = p.hot > 0.85 ? `rgba(255,255,255,${0.9 * depth * tw})` : `rgba(${Math.min(255, r0 + 60)},${Math.min(255, g0 + 40)},${b0},${0.95 * depth * tw})`;
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
