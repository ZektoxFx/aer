// LOCAL DRAFT (Aiman, not pushed): a black hole in the distance during the cruise. It is the AURIS black hole
// (CSP600 prototype, static/js/blackhole.js: a dark sphere with a bright rim and particles circling it) with a
// tilted accretion disc added: the far side of the disc is bent up over the top and under the bottom by gravity
// (gravitational lensing, the look of the black hole in the film Interstellar), and the side coming toward us is
// brighter (Doppler beaming). Story fiction, not a NASA object. Colours come from the :root palette.
import { useEffect, useRef } from 'react';

function rgb(name: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Part { a: number; r: number; v: number; s: number; hot: number; lift: number }

/** Where it sits on screen (fractions of the window) and its size (fraction of the shorter side). */
const AT = { x: 0.24, y: 0.3, r: 0.075 };

export function BlackHole({ active, still }: { active: boolean; still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !active) return;
    const dust = rgb('--mars-dust'), sky = rgb('--mars-sky'), sand = rgb('--mars-sand'), blue = rgb('--earth-glow'), space = rgb('--space');
    const c = (k: [number, number, number], a: number) => `rgba(${k[0]},${k[1]},${k[2]},${a})`;
    let w = 0, h = 0, raf = 0, alive = true;
    const t0 = performance.now();
    // Disc particles: most in a thin disc from 1.6 to 4 radii, a few on the sphere's rim like the AURIS original.
    const parts: Part[] = Array.from({ length: 1300 }, (_, i) => {
      const rim = i % 5 === 0;
      const r = rim ? 1.02 + Math.random() * 0.12 : 1.6 + Math.pow(Math.random(), 1.6) * 2.4;
      return { a: Math.random() * Math.PI * 2, r, v: (rim ? 1.4 : 0.9) / Math.pow(r, 1.5), s: 0.5 + Math.random() * 1.2, hot: Math.random(), lift: rim ? (Math.random() - 0.5) * 1.6 : (Math.random() - 0.5) * 0.06 };
    });

    function size() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas!.offsetWidth; h = canvas!.offsetHeight;
      if (!w || !h) return;
      canvas!.width = w * dpr; canvas!.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(now: number) {
      if (!alive) return;
      if (!w) size();
      const t = still ? 0 : (now - t0) / 1000, g = ctx!;
      const cx = w * AT.x, cy = h * AT.y, R = Math.min(w, h) * AT.r, tilt = 0.18; // disc seen nearly edge-on
      g.clearRect(0, 0, w, h);

      // Warm glow round everything.
      const glow = g.createRadialGradient(cx, cy, R, cx, cy, R * 6);
      glow.addColorStop(0, c(dust, 0.35)); glow.addColorStop(0.25, c(sky, 0.12)); glow.addColorStop(1, c(sand, 0));
      g.fillStyle = glow; g.fillRect(cx - R * 6, cy - R * 6, R * 12, R * 12);

      // The far side of the disc, lensed into a halo over the top and under the bottom of the sphere.
      g.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 3; k++) {
        const rr = R * (1.25 + k * 0.32);
        g.strokeStyle = c(k === 0 ? dust : sky, 0.5 - k * 0.13); g.lineWidth = R * (0.18 - k * 0.04);
        g.beginPath(); g.ellipse(cx, cy, rr * 1.05, rr, 0, 0, Math.PI * 2); g.stroke();
      }
      // Back half of the flat disc (behind the sphere).
      const drawParts = (front: boolean) => {
        for (const p of parts) {
          const a = p.a + t * p.v;
          const x = Math.cos(a) * p.r, z = Math.sin(a) * p.r;
          if ((z >= 0) !== front) continue;
          const y = z * tilt + p.lift;
          if (!front && x * x + y * y < 1) continue; // hidden behind the sphere
          const beam = 0.55 + 0.45 * Math.cos(a); // the disc turns toward us where cos(a) > 0: brighter there
          const hotC = p.hot > 0.85 ? dust : p.hot > 0.45 ? sky : sand;
          g.fillStyle = c(p.hot > 0.97 ? blue : hotC, Math.min(1, (front ? 0.9 : 0.55) * beam * (1.5 / p.r + 0.25)));
          g.beginPath(); g.arc(cx + x * R, cy + y * R, p.s * (front ? 1.1 : 0.9), 0, Math.PI * 2); g.fill();
        }
      };
      drawParts(false);
      g.globalCompositeOperation = 'source-over';

      // The sphere: nothing escapes, so it is plain black, with a thin bright photon ring.
      const body = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
      body.addColorStop(0, c(space, 1)); body.addColorStop(0.92, c(space, 1)); body.addColorStop(1, c(sand, 0.6));
      g.fillStyle = body; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.strokeStyle = c(dust, 0.9); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R * 1.02, 0, Math.PI * 2); g.stroke();

      // Front half of the disc, across the sphere.
      g.globalCompositeOperation = 'lighter';
      g.strokeStyle = c(sky, 0.35); g.lineWidth = R * 0.1;
      g.beginPath(); g.ellipse(cx, cy, R * 3, R * 3 * tilt, 0, 0, Math.PI); g.stroke();
      drawParts(true);
      g.globalCompositeOperation = 'source-over';
      if (!still) raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(() => { size(); frame(performance.now()); });
    ro.observe(canvas); size();
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
  }, [active, still]);

  return <canvas ref={ref} className="blackhole" aria-hidden="true" />;
}
