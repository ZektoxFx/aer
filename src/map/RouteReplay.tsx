// The end-of-game route replay (Map/Aiman). The camera "rises" off the astronaut: the orbital photo starts close
// over where the game ended and pulls back until the whole map is in frame, while the route actually walked draws
// itself from the crash site. NASA sites salvaged, findings and Perseverance pop in as markers along the way.
// When it settles it doubles as the map of the Survival Guide card, which can be saved as a PNG.
// Race Perseverance: the rover's real drive (pois.json traverse, NASA/JPL MMGIS) draws beside yours, metre for
// metre, with the sol it reached each point, so the card can say on which sol the rover had driven as far as you.
// Colours come from the :root palette (read at mount).
import { useEffect, useRef } from 'react';
import type { Pt } from './geo';
import type { PoiFile } from '../data/files';
import { REPLAY_S, replayView, roverCut, roverPath, roverSolAt, trailCut, trailLength, type RoverPath } from './replayPath';

export interface ReplayMark { at: Pt; label: string; tone: 'start' | 'site' | 'finding' | 'goal' }
export interface SurvivalGuide { title: string; rows: [string, string][]; findings: string[]; note: string }

interface Props {
  imageUrl: string;
  area: { widthM: number; heightM: number };
  trail: Pt[];
  /** Where the game ended (the replay starts close over it). */
  end: Pt;
  marks: ReplayMark[];
  /** Short attribution shown under the map. */
  credit: string;
  /** Distance walked as the game counted it (the thinned trail reads a little short); defaults to the trail length. */
  walkedM?: number;
  /** When given, a button saves the Survival Guide (map + these lines) as a PNG. */
  guide?: SurvivalGuide;
}

type Palette = Record<'space' | 'fg' | 'dim' | 'warning' | 'critical' | 'earth' | 'dust', string>;
function palette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return { space: v('--space'), fg: v('--fg'), dim: v('--dim'), warning: v('--warning'), critical: v('--critical'), earth: v('--earth-glow'), dust: v('--mars-dust') };
}
const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const clamp = (x: number) => Math.max(0, Math.min(1, x));
/** A round length for the scale bar that is about `want` metres. */
function niceM(want: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(want)));
  return [1, 2, 5, 10].map((k) => k * p).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
}

/** Draw the map, the route up to `frac` and the markers, for a view centred on (cx, cy) at mPerPx. */
function drawScene(
  g: CanvasRenderingContext2D, W: number, H: number, view: { cx: number; cy: number; mPerPx: number },
  frac: number, markIn: number, img: HTMLImageElement | null, p: Props, c: Palette, now: number,
  rover: RoverPath | null = null, roverM = 0,
) {
  const sx = (x: number) => (x - view.cx) / view.mPerPx + W / 2;
  const sy = (y: number) => (y - view.cy) / view.mPerPx + H / 2;
  g.fillStyle = c.space; g.fillRect(0, 0, W, H);
  if (img?.complete && img.naturalWidth) g.drawImage(img, sx(0), sy(0), p.area.widthM / view.mPerPx, p.area.heightM / view.mPerPx);
  g.fillStyle = c.space; g.globalAlpha = 0.18; g.fillRect(0, 0, W, H); g.globalAlpha = 1;

  // Perseverance's real drive up to the same distance, under your route (blue).
  let roverHead: { x: number; y: number; label: string } | null = null;
  if (rover && rover.legs.length) {
    const r = roverCut(rover, roverM);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); for (const leg of r.legs) leg.forEach((q, i) => (i ? g.lineTo(sx(q.x), sy(q.y)) : g.moveTo(sx(q.x), sy(q.y)))); };
    path(); g.strokeStyle = c.earth; g.globalAlpha = 0.3; g.lineWidth = 6; g.stroke();
    path(); g.globalAlpha = 0.95; g.lineWidth = 1.6; g.stroke(); g.globalAlpha = 1;
    if (r.head && r.sol !== null) {
      const hx = sx(r.head.x), hy = sy(r.head.y);
      g.beginPath(); g.arc(hx, hy, frac < 1 ? 4 + 2 * Math.sin(now * 8) : 4, 0, Math.PI * 2); g.fillStyle = c.earth; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = c.space; g.stroke();
      // Earth year of that sol (landing 18 Feb 2021; a sol is 1.0275 days), so it reads as history, not the game's rover.
      const year = new Date(Date.UTC(2021, 1, 18) + r.sol * 1.0275 * 86400000).getUTCFullYear();
      roverHead = { x: hx, y: hy, label: `REAL DRIVE ${year} · SOL ${r.sol}` };
    }
  }
  // The route: a wide soft glow under a bright core, with a pulsing head while it is still drawing.
  const route = trailCut(p.trail, frac);
  if (route.length > 1) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); route.forEach((q, i) => (i ? g.lineTo(sx(q.x), sy(q.y)) : g.moveTo(sx(q.x), sy(q.y)))); };
    path(); g.strokeStyle = c.warning; g.globalAlpha = 0.35; g.lineWidth = 7; g.stroke();
    path(); g.globalAlpha = 1; g.strokeStyle = c.fg; g.lineWidth = 2; g.stroke();
    const head = route[route.length - 1];
    if (frac < 1) {
      const r = 5 + 3 * Math.sin(now * 8);
      g.beginPath(); g.arc(sx(head.x), sy(head.y), r, 0, Math.PI * 2); g.fillStyle = c.fg; g.fill();
    }
  }
  // Markers pop in one after another once the camera has risen a little.
  g.font = `600 11px ${FONT}`; g.textBaseline = 'middle';
  const placed: { x: number; y: number; w: number }[] = [];
  p.marks.forEach((m, i) => {
    const a = clamp(markIn * (p.marks.length + 2) - i);
    if (a <= 0) return;
    const x = sx(m.at.x), y = sy(m.at.y);
    const col = m.tone === 'start' ? c.critical : m.tone === 'goal' ? c.earth : m.tone === 'finding' ? c.warning : c.fg;
    g.globalAlpha = a;
    g.beginPath(); g.arc(x, y, 4 + (1 - a) * 8, 0, Math.PI * 2); g.fillStyle = col; g.fill();
    g.lineWidth = 1.5; g.strokeStyle = c.space; g.stroke();
    const tw = g.measureText(m.label).width;
    const lx = x + 9 + tw > W - 4 ? x - 9 - tw : x + 9;
    // Labels that would overlap an earlier one step down a line.
    let ly = y;
    while (placed.some((q) => Math.abs(q.y - ly) < 16 && lx < q.x + q.w + 6 && q.x < lx + tw + 6)) ly += 17;
    placed.push({ x: lx, y: ly, w: tw });
    g.fillStyle = c.space; g.globalAlpha = a * 0.7; g.fillRect(lx - 3, ly - 8, tw + 6, 16);
    g.globalAlpha = a; g.fillStyle = col; g.fillText(m.label, lx, ly);
  });
  g.globalAlpha = 1;
  if (roverHead) {
    g.font = `600 11px ${FONT}`; g.textBaseline = 'middle';
    const tw = g.measureText(roverHead.label).width;
    const lx = roverHead.x - 9 - tw < 4 ? roverHead.x + 9 : roverHead.x - 9 - tw;
    let ly = roverHead.y;
    while (placed.some((q) => Math.abs(q.y - ly) < 16 && lx < q.x + q.w + 6 && q.x < lx + tw + 6)) ly -= 17;
    g.fillStyle = c.space; g.globalAlpha = 0.75; g.fillRect(lx - 3, ly - 8, tw + 6, 16);
    g.globalAlpha = 1; g.fillStyle = c.earth; g.fillText(roverHead.label, lx, ly);
  }
}

/** Scale bar bottom-right, and the equivalent camera height top-left (a 60° lens seeing this much ground). */
/** What the race line in the corner says once the rover is loaded. */
function raceLine(rover: RoverPath | null, walkedM: number): string | null {
  if (!rover || !rover.legs.length) return null;
  const sol = roverSolAt(rover, walkedM), last = rover.legs[rover.legs.length - 1].sol;
  return sol !== null ? `ROVER   same distance by sol ${sol}` : `ROVER   ${(rover.totalM / 1000).toFixed(1)} km here by sol ${last}`;
}

function drawOverlay(g: CanvasRenderingContext2D, W: number, H: number, mPerPx: number, walkedM: number, c: Palette, camera = true, race: string | null = null) {
  g.font = `11px ${FONT}`; g.textBaseline = 'alphabetic';
  const len = niceM(mPerPx * W * 0.18), px = len / mPerPx;
  g.fillStyle = c.space; g.globalAlpha = 0.6; g.fillRect(W - px - 22, H - 30, px + 14, 22); g.globalAlpha = 1;
  g.strokeStyle = c.fg; g.lineWidth = 2; g.beginPath(); g.moveTo(W - px - 15, H - 13); g.lineTo(W - 15, H - 13); g.stroke();
  g.fillStyle = c.fg; g.textAlign = 'right'; g.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, W - 15, H - 17);
  const heightM = mPerPx * W * 0.866;
  g.textAlign = 'left';
  const lines = (camera ? 2 : 1) + (race ? 1 : 0);
  g.fillStyle = c.space; g.globalAlpha = 0.6; g.fillRect(8, 8, 250, 6 + lines * 16); g.globalAlpha = 1;
  g.fillStyle = c.fg;
  if (camera) g.fillText(`CAMERA  ${heightM >= 1000 ? `${(heightM / 1000).toFixed(1)} km` : `${Math.round(heightM)} m`} up`, 14, 23);
  g.fillText(`ROUTE   ${walkedM >= 1000 ? `${(walkedM / 1000).toFixed(2)} km` : `${Math.round(walkedM)} m`} walked`, 14, camera ? 39 : 23);
  if (race) { g.fillStyle = c.earth; g.fillText(race, 14, camera ? 55 : 39); }
}

export function RouteReplay(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const roverRef = useRef<RoverPath | null>(null);
  const live = useRef(props);
  useEffect(() => { live.current = props; });

  useEffect(() => {
    const el = host.current, cv = canvas.current;
    if (!el || !cv) return;
    const c = palette();
    const img = props.imageUrl ? new Image() : null;
    if (img) img.src = props.imageUrl;
    // If the photo arrives after the replay has settled, draw the settled frame once more.
    if (img) img.onload = () => { if (alive) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); } };
    imgRef.current = img;
    const walked = props.walkedM ?? trailLength(props.trail);
    let raf = 0, t0 = 0, alive = true;
    // The rover's real drive (already cached: the map loaded pois.json at start). The race joins in when it lands.
    fetch('/data/pois.json').then((r) => r.json() as Promise<PoiFile>).then((f) => {
      if (!alive || !Array.isArray(f.traverse)) return;
      roverRef.current = roverPath(f.traverse);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    }).catch(() => { /* no race without the file; the replay still works */ });
    const frame = (ms: number) => {
      if (!alive) return;
      if (!t0) t0 = ms;
      const t = (ms - t0) / 1000;
      const p = live.current;
      const W = el.clientWidth, H = Math.round(W * 0.62), dpr = Math.min(devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.height = `${H}px`; }
      const g = cv.getContext('2d');
      if (!g || W === 0) { raf = requestAnimationFrame(frame); return; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const view = replayView(t, p.end, p.area, W, H);
      const frac = clamp(t / (REPLAY_S * 0.85)), rover = roverRef.current;
      drawScene(g, W, H, view, frac, clamp((view.f - 0.25) / 0.6), img, p, c, t, rover, frac * walked);
      drawOverlay(g, W, H, view.mPerPx, walked, c, true, frac >= 1 ? raceLine(rover, walked) : null);
      // Keep animating through the pull-back, then a little longer for the last markers; then hold still.
      if (t < REPLAY_S + 1.5) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Only a change of width (a real resize) skips to the settled view; the canvas setting its own height does not.
    let lastW = el.clientWidth;
    const ro = new ResizeObserver(() => { if (el.clientWidth === lastW) return; lastW = el.clientWidth; cancelAnimationFrame(raf); t0 = performance.now() - (REPLAY_S + 1.4) * 1000; raf = requestAnimationFrame(frame); });
    ro.observe(el);
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); };
    // The replay runs once per mount; later prop changes are read through `live`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const p = live.current, guide = p.guide;
    if (!guide) return;
    const c = palette();
    const W = 1200, mapH = Math.round(W * p.area.heightM / p.area.widthM), rowH = 30;
    const H = 150 + mapH + 40 + guide.rows.length * rowH + 50 + guide.findings.length * 26 + 110;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    g.fillStyle = c.space; g.fillRect(0, 0, W, H);
    g.fillStyle = c.warning; g.font = `600 18px ${FONT}`; g.fillText('AER · INTERPLANETARY SURVIVAL GUIDE · JEZERO CRATER, MARS', 40, 56);
    g.fillStyle = c.fg; g.font = `600 40px ${FONT}`; g.fillText(guide.title, 40, 110);
    g.save(); g.translate(0, 140);
    const walkedM = p.walkedM ?? trailLength(p.trail);
    drawScene(g, W, mapH, { cx: p.area.widthM / 2, cy: p.area.heightM / 2, mPerPx: p.area.widthM / W }, 1, 1, imgRef.current, p, c, 0, roverRef.current, walkedM);
    drawOverlay(g, W, mapH, p.area.widthM / W, walkedM, c, false, raceLine(roverRef.current, walkedM));
    g.restore();
    let y = 140 + mapH + 50;
    g.font = `20px ${FONT}`;
    for (const [k, v] of guide.rows) {
      g.fillStyle = c.dim; g.textAlign = 'left'; g.fillText(k, 40, y);
      g.fillStyle = c.fg; g.textAlign = 'right'; g.fillText(v, W - 40, y);
      y += rowH;
    }
    g.textAlign = 'left';
    if (guide.findings.length) {
      y += 20; g.fillStyle = c.warning; g.font = `600 18px ${FONT}`; g.fillText('WHAT WE LEARNED', 40, y); y += 30;
      g.fillStyle = c.fg; g.font = `18px ${FONT}`;
      for (const f of guide.findings) { g.fillText(`▸ ${f}`, 40, y); y += 26; }
    }
    y += 30; g.fillStyle = c.fg; g.font = `italic 18px ${FONT}`; g.fillText(guide.note, 40, y);
    g.fillStyle = c.dim; g.font = `13px ${FONT}`;
    g.fillText('Map: HiRISE orthomosaic, USGS Mars 2020 TRN. Blue: Perseverance traverse, NASA/JPL MMGIS (archived, not live). Story is fiction.', 40, H - 40);
    g.fillText('NASA Space Apps 2026 · Interplanetary Survival Guide: Martian Map', 40, H - 20);
    cv.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'aer-survival-guide.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  };

  return (
    <figure className="route-replay" ref={host}>
      <canvas ref={canvas} aria-label="Your route on the HiRISE map of Jezero crater" />
      <figcaption>
        <span>{props.credit}</span>
        <span className="route-race-note">Blue: Perseverance's real drive (NASA/JPL MMGIS), shown at the same distance as yours. It stops to study rocks, so it is slow on purpose.</span>
        {props.guide && <button className="choice-btn route-save" onClick={save}>SAVE SURVIVAL GUIDE (PNG)</button>}
      </figcaption>
    </figure>
  );
}
