// LOCAL DRAFT (Aiman, not pushed): Mars in the intro as a lit, turning globe in the same AURIS style as EarthGlobe
// (sphere, butterscotch haze round the edge, light from the upper left), instead of a flat disc.
// It sits inside the intro's `.mars` element, so the cruise / fault / crash animations (the landing) are unchanged:
// they still move and scale that element exactly as before.
// Surface: the HiRISE Jezero image the intro already uses and credits, tinted to the Mars palette. It is a close-up
// of one crater, not a global map, so it is mirrored round the sphere as texture only (a full Mars needs a global
// mosaic, e.g. from the Data role).
import { useEffect, useRef } from 'react';

const SURFACE = '/data/jezero_base_2m.jpg';
const TEX_W = 1024;       // texture is downsampled to this width (plenty for a globe that is mostly small or moving)
const SPIN_S = 70;        // seconds per turn
const MAX_PX = 720;       // sphere drawn at most this many pixels across, then scaled smoothly

/** A :root palette colour as [r, g, b] (colours live only in src/index.css). */
function rgb(name: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Geo { d: number; lon: Float32Array; lat: Float32Array; light: Float32Array; rim: Float32Array; inside: Uint8Array }
function geometry(d: number): Geo {
  const n = d * d, g: Geo = { d, lon: new Float32Array(n), lat: new Float32Array(n), light: new Float32Array(n), rim: new Float32Array(n), inside: new Uint8Array(n) };
  const lx = -0.6, ly = -0.42, lz = 0.68;
  const tilt = 0.44; // Mars' axial tilt (25°), so the turn reads as a planet and not a spinning plate
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let j = 0; j < d; j++) {
    const v = ((j + 0.5) / d) * 2 - 1;
    for (let i = 0; i < d; i++) {
      const u = ((i + 0.5) / d) * 2 - 1, rr = u * u + v * v, k = j * d + i;
      if (rr > 1) continue;
      const z = Math.sqrt(1 - rr);
      // Tilt the globe about the view axis, then read longitude / latitude.
      const x = u * ct + v * st, y = -u * st + v * ct;
      g.inside[k] = 1;
      g.lon[k] = Math.atan2(x, z);
      g.lat[k] = Math.asin(Math.max(-1, Math.min(1, y)));
      g.light[k] = Math.max(0, u * lx + v * ly + z * lz);
      g.rim[k] = Math.pow(1 - z, 2.4);
    }
  }
  return g;
}

/** `active`: animate (only while the intro shows Mars, so it costs nothing on the title screen). */
export function MarsGlobe({ active, still }: { active: boolean; still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const sand = rgb('--mars-sand');
    const rust = rgb('--mars-rust');
    const sky = rgb('--mars-sky');
    const dust = rgb('--mars-dust');
    let tex: Uint8ClampedArray | null = null, tw = 0, th = 0;
    let w = 0, R = 0, raf = 0, alive = true;
    const t0 = performance.now();
    const buf = document.createElement('canvas');
    const bctx = buf.getContext('2d');
    let out: ImageData | null = null, geo: Geo | null = null;

    const img = new Image();
    img.onload = () => {
      tw = TEX_W; th = Math.round((img.height / img.width) * TEX_W);
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const g = c.getContext('2d');
      if (!g) return;
      g.drawImage(img, 0, 0, tw, th);
      tex = g.getImageData(0, 0, tw, th).data;
      draw(performance.now());
    };
    img.src = SURFACE;

    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas!.getBoundingClientRect();
      // getBoundingClientRect includes the parent's scale transform, so use the layout size instead.
      w = canvas!.offsetWidth || r.width;
      if (!w) return;
      const px = Math.min(Math.round(w * dpr), 1600);
      canvas!.width = px; canvas!.height = px;
      ctx!.setTransform(px / w, 0, 0, px / w, 0, 0);
      R = w * 0.33;
      const d = Math.min(MAX_PX, Math.max(64, Math.round(2 * R * (px / w))));
      if (!geo || geo.d !== d) {
        buf.width = d; buf.height = d;
        out = bctx ? bctx.createImageData(d, d) : null;
        geo = geometry(d);
      }
    }

    function shade(spin: number) {
      if (!tex || !out || !bctx || !geo) return;
      const { d, lon, lat, light, rim, inside } = geo, o = out.data, T = tex;
      const period = 2 * tw; // mirrored tiling: the texture runs forwards then backwards, so there is no seam
      for (let k = 0, n = d * d; k < n; k++) {
        const q = k * 4;
        if (!inside[k]) { o[q + 3] = 0; continue; }
        const la = lat[k];
        let sx = Math.floor(((lon[k] + spin) / (Math.PI * 2)) * period * 3) % period;
        if (sx < 0) sx += period;
        if (sx >= tw) sx = period - 1 - sx;
        // Latitude also runs the texture forwards then mirrored (pole → equator → pole), again without a seam.
        const fy = ((la / Math.PI) + 0.5) * 2;
        const sy = Math.min(th - 1, Math.max(0, Math.floor((fy > 1 ? 2 - fy : fy) * (th - 1))));
        const g = T[(sy * tw + sx) * 4] / 255;
        // Albedo: the photo's grey, tinted from rust (dark ground) to sand (bright ground).
        const a = 0.35 + 0.9 * g;
        let r = rust[0] + (sand[0] - rust[0]) * g, gg = rust[1] + (sand[1] - rust[1]) * g, b = rust[2] + (sand[2] - rust[2]) * g;
        // Thin polar cap near the north pole.
        const cap = Math.max(0, Math.min(1, (-la - 1.18) / 0.12));
        r += (dust[0] - r) * cap; gg += (dust[1] - gg) * cap; b += (dust[2] - b) * cap;
        const lit = light[k], L = 0.03 + 1.25 * lit * lit * (3 - 2 * lit), h = rim[k] * (0.35 + 0.65 * lit);
        o[q] = Math.min(255, r * a * L + sky[0] * h * 0.55);
        o[q + 1] = Math.min(255, gg * a * L + sky[1] * h * 0.45);
        o[q + 2] = Math.min(255, b * a * L + sky[2] * h * 0.35);
        o[q + 3] = 255;
      }
      bctx.putImageData(out, 0, 0);
    }

    function draw(now: number) {
      if (!alive) return;
      if (!w) size();
      if (!w) return;
      const t = (now - t0) / 1000, c = w / 2;
      ctx!.clearRect(0, 0, w, w);
      // Haze: thin dusty atmosphere lit from the sun side, as a soft ring (AURIS rim light, in Mars colours).
      const halo = ctx!.createRadialGradient(c, c, R * 0.98, c, c, R * 1.3);
      halo.addColorStop(0, `rgba(${dust[0]},${dust[1]},${dust[2]},0.5)`);
      halo.addColorStop(0.15, `rgba(${sky[0]},${sky[1]},${sky[2]},0.32)`);
      halo.addColorStop(0.5, `rgba(${sand[0]},${sand[1]},${sand[2]},0.08)`);
      halo.addColorStop(1, `rgba(${sand[0]},${sand[1]},${sand[2]},0)`);
      ctx!.fillStyle = halo;
      ctx!.fillRect(0, 0, w, w);

      shade(still ? 0 : (t / SPIN_S) * Math.PI * 2);
      ctx!.imageSmoothingEnabled = true;
      ctx!.imageSmoothingQuality = 'high';
      ctx!.drawImage(buf, c - R, c - R, 2 * R, 2 * R);

      // Phobos and Deimos: two small moons on near-equatorial orbits, hidden when behind the planet.
      const moons = [{ k: 1.38, p: 9, s: 0.022, ph: 0.3 }, { k: 1.85, p: 22, s: 0.014, ph: 2.1 }];
      for (const m of moons) {
        const a = m.ph + (still ? 0 : (t / m.p) * Math.PI * 2);
        const x = Math.cos(a) * m.k, z = Math.sin(a) * m.k, y = x * 0.18;
        if (z < 0 && Math.abs(x) < 1) continue;
        ctx!.fillStyle = `rgba(${dust[0]},${dust[1]},${dust[2]},0.85)`;
        ctx!.beginPath(); ctx!.arc(c + R * x, c + R * y, Math.max(1.2, R * m.s), 0, Math.PI * 2); ctx!.fill();
      }
      if (active && !still) raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(() => { size(); draw(performance.now()); });
    ro.observe(canvas); size();
    draw(performance.now());
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); img.onload = null; };
  }, [active, still]);

  return <canvas ref={ref} className="mars-globe" aria-hidden="true" />;
}
