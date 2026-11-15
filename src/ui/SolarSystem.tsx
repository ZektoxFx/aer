// LOCAL DRAFT (Aiman, not pushed): the title screen's backdrop as a solar system, laid out like the AURIS home page
// (one glowing body in the middle, everything else orbiting round it). The Sun takes the black hole's place: a bright
// sphere with a corona and a disc of particles that hide behind it. The planets circle on tilted orbits; Earth and
// Mars are the main pair (larger, textured, labelled, glowing orbits, a dashed transfer path between them).
// Sizes, distances and speeds are for the picture, not to scale.
// It publishes Earth's screen position as --earth-x / --earth-y on the intro, so the rocket launch starts there.
// Since 15 Nov: the planets start where they really are today (mean orbits, heliocentric.ts) and run on at a few
// days per second; a readout gives the date, the Earth–Mars distance and the radio delay. The view leans gently
// with the mouse (parallax), and the title letters resolve in (title.css).
import { useEffect, useRef } from 'react';
import { daysSinceJ2000, earthMars, ELEMENTS, meanLongitude } from './heliocentric';

const EARTH_PHOTO = '/data/earth_apollo17.jpg';
const EARTH_DISC = { cx: 0.502, cy: 0.508, r: 0.331 }; // where the disc sits in the photo (as in EarthGlobe)
const TILT = 0.3;  // orbit ellipse height / width (how far we look down on the plane)
const CY = 0.42;   // Sun's height on screen (the title sits below)

type Kind = 'rock' | 'earth' | 'mars' | 'gas' | 'ringed' | 'ice';
interface Planet { name: string; orbit: number; size: number; period: number; phase: number; kind: Kind; colors: string[]; main?: boolean }
// orbit: × half the screen width; size: × the smaller screen side; period: seconds per lap.
/** Simulated days per real second (Earth laps in 110 s). */
const DAYS_PER_S = 365.256 / 110;
/** Screen angle of longitude 0. The view's orientation is free: this puts mid-Nov 2026's Earth front left, where the
 * design had it. Only Earth and Mars use real positions; the others keep their picture phases so they never pile up. */
const VIEW_OFFSET = 2.35 + (53.8 * Math.PI) / 180;
const PLANETS: Planet[] = [
  { name: 'Mercury', orbit: 0.15, size: 0.006, period: 24, phase: 1.2, kind: 'rock', colors: ['--metal-dark', '--metal'] },
  { name: 'Venus', orbit: 0.23, size: 0.011, period: 48, phase: 3.6, kind: 'rock', colors: ['--mars-dust', '--mars-sky'] },
  { name: 'Earth', orbit: 0.33, size: 0.024, period: 110, phase: 2.35, kind: 'earth', colors: ['--earth-glow'], main: true },
  { name: 'Mars', orbit: 0.46, size: 0.019, period: 200, phase: 0.75, kind: 'mars', colors: ['--mars-sand', '--mars-rust'], main: true },
  { name: 'Jupiter', orbit: 0.64, size: 0.032, period: 600, phase: 4.3, kind: 'gas', colors: ['--mars-dust', '--mars-sky', '--mars-sand'] },
  { name: 'Saturn', orbit: 0.82, size: 0.026, period: 900, phase: 5.4, kind: 'ringed', colors: ['--mars-dust', '--mars-sky'] },
  { name: 'Uranus', orbit: 0.98, size: 0.016, period: 1400, phase: 2.9, kind: 'ice', colors: ['--earth-glow', '--metal'] },
  { name: 'Neptune', orbit: 1.12, size: 0.016, period: 1900, phase: 0.2, kind: 'ice', colors: ['--earth-glow', '--sat-panel'] },
];

/** A :root palette colour as [r, g, b] (colours live only in src/index.css). */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const dateLabel = (ms: number) => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };

export function SolarSystem({ frozen, still }: { frozen: boolean; still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const readout = useRef<HTMLDListElement>(null);
  const live = useRef({ frozen, still });
  useEffect(() => { live.current = { frozen, still }; }, [frozen, still]);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const intro = canvas.closest('.intro') as HTMLElement | null;
    const C = (v: string) => rgbOf(cssVar(v));
    const sunHot = C('--metal'), sunMid = C('--warning'), sunEdge = C('--mars-sand'), glow = C('--earth-glow');
    const dust = C('--mars-dust'), sky = C('--mars-sky'), rust = C('--mars-rust'), space = C('--space');
    const pal = PLANETS.map((p) => p.colors.map(C));
    let w = 0, h = 0, m = 0, raf = 0, alive = true, simT = 0, last = performance.now(), lastText = 0;
    const startMs = Date.now(), startD = daysSinceJ2000(startMs);
    // Mouse parallax: the view leans a little toward the pointer (smoothed).
    const lean = { x: 0, y: 0, tx: 0, ty: 0 };
    const onPointer = (e: PointerEvent) => { lean.tx = (e.clientX / innerWidth) * 2 - 1; lean.ty = (e.clientY / innerHeight) * 2 - 1; };
    addEventListener('pointermove', onPointer);
    const earthImg = new Image();
    let earthReady = false;
    earthImg.onload = () => { earthReady = true; };
    earthImg.src = EARTH_PHOTO;

    // Particles round the Sun, like the black hole's disc (tilted ring, hidden behind the sphere).
    const parts = Array.from({ length: 900 }, () => ({
      a: Math.random() * Math.PI * 2, k: 1.15 + Math.pow(Math.random(), 1.6) * 1.4, v: 0.05 + Math.random() * 0.12,
      y: (Math.random() - 0.5) * 0.18, s: 0.5 + Math.random() * 1.3, hot: Math.random(),
    }));

    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2), r = canvas!.getBoundingClientRect();
      w = r.width; h = r.height; m = Math.min(w, h);
      canvas!.width = Math.round(w * dpr); canvas!.height = Math.round(h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** A lit sphere: base colours, night side turned away from the Sun at (sx, sy). */
    function sphere(p: Planet, i: number, x: number, y: number, r: number, sx: number, sy: number) {
      const c = pal[i], g = ctx!;
      g.save();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      if (p.kind === 'earth' && earthReady) {
        const iw = earthImg.width, ih = earthImg.height, pr = EARTH_DISC.r * iw;
        g.drawImage(earthImg, EARTH_DISC.cx * iw - pr, EARTH_DISC.cy * ih - pr, 2 * pr, 2 * pr, x - r, y - r, 2 * r, 2 * r);
      } else {
        const base = g.createLinearGradient(x - r, y - r, x + r, y + r);
        c.forEach((cc, k) => base.addColorStop(c.length > 1 ? k / (c.length - 1) : 0, rgba(cc, 1)));
        g.fillStyle = base; g.fillRect(x - r, y - r, 2 * r, 2 * r);
        if (p.kind === 'gas' || p.kind === 'ringed') { // bands
          for (let b = -3; b <= 3; b++) {
            g.fillStyle = rgba(b % 2 ? sky : dust, 0.35);
            g.fillRect(x - r, y + (b / 3.6) * r - r * 0.07, 2 * r, r * 0.14);
          }
        }
        if (p.kind === 'mars') { // darker ground and a polar cap
          g.fillStyle = rgba(rust, 0.55);
          g.beginPath(); g.ellipse(x + r * 0.2, y + r * 0.15, r * 0.5, r * 0.28, 0.4, 0, Math.PI * 2); g.fill();
          g.fillStyle = rgba(dust, 0.9);
          g.beginPath(); g.ellipse(x, y - r * 0.86, r * 0.42, r * 0.16, 0, 0, Math.PI * 2); g.fill();
        }
      }
      // Night side: dark away from the Sun.
      const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      const night = g.createLinearGradient(x - ux * r, y - uy * r, x + ux * r, y + uy * r);
      night.addColorStop(0, rgba(space, 0)); night.addColorStop(0.45, rgba(space, 0.15)); night.addColorStop(1, rgba(space, 0.92));
      g.fillStyle = night; g.fillRect(x - r, y - r, 2 * r, 2 * r);
      g.restore();
      // Atmosphere rim on the main pair.
      if (p.main) {
        const rim = p.kind === 'earth' ? glow : sky;
        g.strokeStyle = rgba(rim, 0.65); g.lineWidth = Math.max(1, r * 0.12);
        g.beginPath(); g.arc(x, y, r * 1.04, 0, Math.PI * 2); g.stroke();
        const halo = g.createRadialGradient(x, y, r, x, y, r * 2.6);
        halo.addColorStop(0, rgba(rim, 0.35)); halo.addColorStop(1, rgba(rim, 0));
        g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 2.6, 0, Math.PI * 2); g.fill();
      }
    }

    function draw(now: number) {
      if (!alive || !w) return;
      const { frozen: fz, still: st } = live.current;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!fz && !st) simT += dt;
      if (!st) { const k = 1 - Math.exp(-dt * 3); lean.x += (lean.tx - lean.x) * k; lean.y += (lean.ty - lean.y) * k; }
      const g = ctx!, sx = w / 2 - lean.x * w * 0.018, sy = h * CY - lean.y * h * 0.012, sr = m * 0.075, half = w / 2;
      const tilt = TILT + lean.y * 0.05;
      const simD = startD + simT * DAYS_PER_S;
      g.clearRect(0, 0, w, h);

      // Orbits: faint ellipses; the main pair's glow.
      const pos = PLANETS.map((p) => {
        // Real heliocentric longitude on the simulated date (counter-clockwise seen from the north, as in the sky).
        const a = p.main && ELEMENTS[p.name] ? VIEW_OFFSET - meanLongitude(p.name, simD) : p.phase + (simT / p.period) * Math.PI * 2;
        const rx = p.orbit * half, ry = rx * tilt;
        const depth = Math.sin(a); // +1 = in front of the Sun (lower on screen), -1 = behind it
        return { x: sx + Math.cos(a) * rx, y: sy + depth * ry, depth, rx, ry, scale: 1 + 0.22 * depth };
      });
      PLANETS.forEach((p, i) => {
        const { rx, ry } = pos[i];
        g.lineWidth = p.main ? 1.4 : 1;
        g.strokeStyle = p.main ? rgba(p.kind === 'earth' ? glow : sky, 0.55) : rgba(dust, 0.12);
        if (p.main) { g.shadowColor = rgba(p.kind === 'earth' ? glow : sky, 0.8); g.shadowBlur = 8; }
        g.beginPath(); g.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
        g.shadowBlur = 0;
      });

      const drawPlanet = (i: number) => {
        const p = PLANETS[i], q = pos[i], r = Math.max(1.5, p.size * m * q.scale);
        // Hidden while it passes behind the Sun.
        if (q.depth < 0 && Math.hypot(q.x - sx, q.y - sy) < sr * 0.98 - r) return;
        if (p.kind === 'ringed') { // back half of the ring
          g.strokeStyle = rgba(dust, 0.55); g.lineWidth = r * 0.28;
          g.beginPath(); g.ellipse(q.x, q.y, r * 2.1, r * 0.62, -0.25, Math.PI, Math.PI * 2); g.stroke();
        }
        sphere(p, i, q.x, q.y, r, sx, sy);
        if (p.kind === 'ringed') {
          g.strokeStyle = rgba(dust, 0.75); g.lineWidth = r * 0.28;
          g.beginPath(); g.ellipse(q.x, q.y, r * 2.1, r * 0.62, -0.25, 0, Math.PI); g.stroke();
        }
      };
      const order = PLANETS.map((_, i) => i).sort((a, b) => pos[a].depth - pos[b].depth);

      // Behind the Sun first.
      order.filter((i) => pos[i].depth < 0).forEach(drawPlanet);

      // Sun: corona, sphere, particle disc (the AURIS black hole, lit instead of dark).
      const pulse = 1 + (st ? 0 : 0.03 * Math.sin(now / 900));
      const corona = g.createRadialGradient(sx, sy, sr * 0.8, sx, sy, sr * 4.2 * pulse);
      corona.addColorStop(0, rgba(sunHot, 0.75)); corona.addColorStop(0.12, rgba(sunMid, 0.45));
      corona.addColorStop(0.4, rgba(sunEdge, 0.12)); corona.addColorStop(1, rgba(sunEdge, 0));
      g.fillStyle = corona; g.beginPath(); g.arc(sx, sy, sr * 4.2 * pulse, 0, Math.PI * 2); g.fill();
      const ct = Math.cos(0.32), stt = Math.sin(0.32), tP = st ? 0 : now / 1000;
      g.globalCompositeOperation = 'lighter';
      const drawParts = (front: boolean) => {
        for (const pt of parts) {
          const a = pt.a + tP * pt.v, x0 = Math.cos(a) * pt.k, z = Math.sin(a) * pt.k, y0 = pt.y;
          if ((z >= 0) !== front) continue;
          const x = x0 * ct - y0 * stt, y = (x0 * stt + y0 * ct) * 0.55 + z * 0.12;
          if (!front && x * x + y * y < 1) continue;
          const c = pt.hot > 0.8 ? sunHot : pt.hot > 0.4 ? sunMid : dust;
          g.fillStyle = rgba(c, (front ? 0.85 : 0.45) * (0.7 + 0.3 * Math.sin(tP * 2 + pt.hot * 30)));
          g.beginPath(); g.arc(sx + sr * x, sy + sr * y, pt.s, 0, Math.PI * 2); g.fill();
        }
      };
      drawParts(false);
      g.globalCompositeOperation = 'source-over';
      const body = g.createRadialGradient(sx - sr * 0.25, sy - sr * 0.25, sr * 0.1, sx, sy, sr);
      body.addColorStop(0, rgba(sunHot, 1)); body.addColorStop(0.55, rgba(sunMid, 1)); body.addColorStop(1, rgba(sunEdge, 1));
      g.fillStyle = body; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(sunHot, 0.9); g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.stroke();
      g.globalCompositeOperation = 'lighter';
      drawParts(true);
      g.globalCompositeOperation = 'source-over';

      // Earth → Mars transfer path (dashed, bowed away from the Sun).
      const e = pos[2], ma = pos[3];
      const mx = (e.x + ma.x) / 2, my = (e.y + ma.y) / 2, ox = mx - sx, oy = my - sy, ol = Math.hypot(ox, oy) || 1;
      const bow = Math.hypot(ma.x - e.x, ma.y - e.y) * 0.35;
      g.setLineDash([5, 7]); g.lineDashOffset = st ? 0 : -now / 60;
      g.strokeStyle = rgba(sunHot, 0.6); g.lineWidth = 1.2;
      const cx = mx + (ox / ol) * bow, cy = my + (oy / ol) * bow;
      g.beginPath(); g.moveTo(e.x, e.y); g.quadraticCurveTo(cx, cy, ma.x, ma.y); g.stroke();
      g.setLineDash([]);
      // How long the trip takes: a ship marker runs the path counting the days, and a tag at the top of the arc.
      // Mars 2020 (Perseverance): launched 30 Jul 2020, landed 18 Feb 2021 = 203 days, about 472 million km flown.
      {
        const TRIP_DAYS = 203, k = st ? 0.5 : ((now / 1000) % 7) / 6; // 6 s run, 1 s pause at Mars
        const f = Math.min(1, k), u = 1 - f;
        const px = u * u * e.x + 2 * u * f * cx + f * f * ma.x, py = u * u * e.y + 2 * u * f * cy + f * f * ma.y;
        g.fillStyle = rgba(sunHot, 1); g.shadowColor = rgba(sunHot, 1); g.shadowBlur = 10;
        g.beginPath(); g.arc(px, py, 2.6, 0, Math.PI * 2); g.fill(); g.shadowBlur = 0;
        g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; g.textBaseline = 'middle'; g.textAlign = 'center';
        g.fillStyle = rgba(sunHot, 0.9); g.fillText(`DAY ${Math.round(f * TRIP_DAYS)}`, px, py - 11);
        const tx = 0.25 * e.x + 0.5 * cx + 0.25 * ma.x, ty = 0.25 * e.y + 0.5 * cy + 0.25 * ma.y;
        const away = ty < sy ? -1 : 1, ly = ty + away * 26;
        g.strokeStyle = rgba(sunHot, 0.5); g.lineWidth = 1; g.beginPath(); g.moveTo(tx, ty + away * 4); g.lineTo(tx, ly - away * 10); g.stroke();
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; g.fillStyle = rgba(sunHot, 0.95);
        g.fillText('EARTH → MARS ≈ 7 MONTHS', tx, ly);
        g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'; g.fillStyle = rgba(dust, 0.75);
        g.fillText('Perseverance: 203 days · ~472 million km', tx, ly + away * 14);
        g.textAlign = 'left';
      }

      // In front of the Sun.
      order.filter((i) => pos[i].depth >= 0).forEach(drawPlanet);

      // Labels for the main pair (AURIS-style: mono caps, a tick line).
      g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      g.textBaseline = 'middle';
      for (const i of [2, 3]) {
        const p = PLANETS[i], q = pos[i], r = p.size * m * q.scale, c = p.kind === 'earth' ? glow : sky;
        // Label on the side away from the Sun, so it never sits in the glare.
        // In front of the Sun's lower half, the label goes under the planet instead (out of the glare).
        const side = q.x < sx ? -1 : 1, under = q.y > sy && Math.abs(q.x - sx) < sr * 1.6, ly = under ? q.y + r + 22 : q.y - r - 12;
        const lx = side > 0 ? q.x + r + 14 : q.x - r - 14 - 72;
        g.strokeStyle = rgba(c, 0.8); g.lineWidth = 1;
        g.beginPath(); g.moveTo(q.x + side * r * 0.8, q.y + (under ? r : -r) * 0.8);
        if (side > 0) { g.lineTo(lx - 4, ly); g.lineTo(lx + 72, ly); } else { g.lineTo(lx + 76, ly); g.lineTo(lx, ly); }
        g.stroke();
        g.fillStyle = rgba(sunHot, 0.95); g.fillText(p.name.toUpperCase(), lx, ly - 8);
        g.fillStyle = rgba(c, 0.85); g.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
        g.fillText(p.kind === 'earth' ? 'HOME' : 'DESTINATION', lx, ly + 9);
        g.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      }

      // The readout: the simulated date, how far apart Earth and Mars are, and the radio delay (4× a second).
      if (readout.current && now - lastText > 250) {
        lastText = now;
        const em = earthMars(simD), dd = readout.current.querySelectorAll('dd');
        const shown = dateLabel(startMs + simT * DAYS_PER_S * 86_400_000);
        dd[0].textContent = `${shown}${shown === dateLabel(startMs) ? ' · TODAY' : ''}`;
        dd[1].textContent = `${em.au.toFixed(2)} AU · ${Math.round(em.km / 1e6)} million km`;
        dd[2].textContent = `${em.lightMin.toFixed(1)} min each way`;
      }
      // Tell the intro where Earth is (the launch starts there), and the lean for the star layer's parallax.
      if (intro) {
        intro.style.setProperty('--lean-x', lean.x.toFixed(3));
        intro.style.setProperty('--lean-y', lean.y.toFixed(3));
        intro.style.setProperty('--earth-x', `${e.x.toFixed(1)}px`);
        intro.style.setProperty('--earth-y', `${e.y.toFixed(1)}px`);
        intro.style.setProperty('--earth-r', `${(PLANETS[2].size * m * e.scale).toFixed(1)}px`);
      }
      raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(size);
    ro.observe(canvas); size();
    raf = requestAnimationFrame(draw);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); earthImg.onload = null; removeEventListener('pointermove', onPointer); };
  }, []);

  return (
    <>
      <canvas ref={ref} className="solar-system" aria-hidden="true" />
      <aside className="solar-readout" aria-label="Earth and Mars today">
        <p className="solar-readout-head">EARTH ↔ MARS</p>
        <dl ref={readout}>
          <dt>DATE</dt><dd>-</dd>
          <dt>APART</dt><dd>-</dd>
          <dt>RADIO DELAY</dt><dd>-</dd>
          <dt>JEZERO</dt><dd>18.4°N 77.5°E · ~6 hPa air</dd>
        </dl>
        <p className="solar-readout-note">Earth and Mars placed for today's date (mean circular orbits, approx.), then run at ~3 days a second. Sizes and distances not to scale.</p>
      </aside>
    </>
  );
}
