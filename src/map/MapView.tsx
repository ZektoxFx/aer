// The Mars map canvas. Static layers (terrain, contours, slope, explored ground, safe zone) are rendered once
// into offscreen canvases; an animation loop composites them with the live parts (route, astronaut, storm).
// Click = add waypoint, right-click a waypoint = remove it, wheel = zoom, drag = pan, double-click = fit.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react';
import type { DataPack } from '../data/types';
import { contourSegments } from './contours';
import type { Segment } from './contours';
import type { Elevation, Pt } from './geo';
import { dist, heightAt, samplePath, slopeAt, toLatLon } from './geo';
import type { HazardZone, ItemKind, MapItem } from './layout';
import { SLOPE_BLOCKED, SLOPE_CAUTION, SLOPE_STEEP, zoneAt } from './layout';
import type { RangeField } from './pathfind';
import { cellOf } from './pathfind';
import type { RouteResult, Status } from './route';
import type { Explored } from './visibility';
import { isSeen } from './visibility';

export interface MapLayers { slope: boolean; hazards: boolean; fog: boolean; grid: boolean; contours: boolean; range: boolean; allItems: boolean }

export interface Ping { at: Pt; t0: number }

export interface MapViewProps {
  pack: DataPack;
  zones: HazardZone[];
  /** All items; hidden ones are drawn only when found (or when layers.allItems is on). */
  items: MapItem[];
  found: ReadonlySet<string>;
  explored: Explored;
  /** Bump when `explored` changes so the fog redraws. */
  exploredVersion: number;
  base: Pt;
  astronaut: Pt;
  sightM: number;
  waypoints: Pt[];
  route: RouteResult | null;
  layers: MapLayers;
  /** Safe-return field from pathfind.rangeField. */
  range?: RangeField | null;
  /** Supply fraction that must be left on return (the safe-zone edge). */
  reserve?: number;
  crashPath?: Pt[];
  /** The rover's traverse from the archive maps (always shown). */
  archiveTraverse?: Pt[][];
  /** Wheel tracks to the rover's real position (shown only where explored; erased by a storm). */
  roverTracks?: Pt[][];
  /** The rover's last known area. */
  searchArea?: { at: Pt; r: number };
  /** Where the astronaut has walked. */
  tracks?: Pt[];
  /** Expanding rings where items were just found (t0 = performance.now()). */
  pings?: Ping[];
  night?: boolean;
  storm?: boolean;
  onAddWaypoint?: (p: Pt) => void;
  onRemoveWaypoint?: (index: number) => void;
}

interface View { scale: number; ox: number; oy: number }

const STATUS_COLOR: Record<Status, string> = { nominal: '#4dff88', warning: '#ffb000', critical: '#ff4d4d' };

const ITEM_STYLE: Record<ItemKind, { code: string; color: string }> = {
  base: { code: 'BASE', color: '#e8f5ec' },
  o2: { code: 'O₂', color: '#7fd7ff' },
  lioh: { code: 'LiOH', color: '#c9a7ff' },
  water: { code: 'H₂O', color: '#4fa8ff' },
  battery: { code: 'BAT', color: '#ffe066' },
  repair: { code: 'KIT', color: '#ffb3a0' },
  scrap: { code: 'SCRAP', color: '#ff9a5c' },
  manual: { code: 'PAGE', color: '#e8f5ec' },
  shelter: { code: 'SHLT', color: '#9fe0b4' },
  rover: { code: 'ROVER', color: '#ff6bd6' },
  clue: { code: 'NASA', color: '#9fd0ff' },
  sample: { code: '', color: '#d6c6ff' },
  science: { code: 'SCIENCE', color: '#b8ffcf' },
};

type Ramp = [number, [number, number, number]][];
const DEFAULT_RAMP: Ramp = [
  [0, [48, 34, 30]], [0.3, [112, 62, 38]], [0.65, [172, 104, 60]], [1, [224, 172, 114]],
];
const hexRgb = (h: string | undefined): [number, number, number] | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** Height ramp from the Data role's marsVisuals.terrainColors (low dark basalt sand → regolith → light delta
 *  mudstone on high ground). Falls back to the built-in ramp when the pack has no colours. */
function terrainRamp(colors: Record<string, string> | undefined): Ramp {
  const sand = hexRgb(colors?.darkBasaltSand), reg = hexRgb(colors?.regolithBase), mud = hexRgb(colors?.deltaMudstone);
  if (!sand || !reg || !mud) return DEFAULT_RAMP;
  // Lift the darkest stop a little so hillshade still reads in the hollows.
  const lift = (c: [number, number, number]): [number, number, number] => [c[0] * 0.8 + 20, c[1] * 0.8 + 16, c[2] * 0.8 + 14];
  return [[0, lift(sand)], [0.45, reg], [1, mud]];
}
function ramp(R: Ramp, t: number): [number, number, number] {
  for (let i = 1; i < R.length; i++) {
    if (t <= R[i][0]) {
      const [t0, a] = R[i - 1], [t1, b] = R[i];
      const f = (t - t0) / (t1 - t0);
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return R[R.length - 1][1];
}

/** Box-blurred copy of the heights (local relief = height minus this; brightens rims, darkens hollows). */
function blurred(el: Elevation, rad: number): Elevation {
  const { cols, rows, heightsM: h } = el;
  const tmp = new Array<number>(cols * rows), out = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, n = 0;
    for (let k = -rad; k <= rad; k++) { const cc = c + k; if (cc >= 0 && cc < cols) { s += h[r * cols + cc]; n++; } }
    tmp[r * cols + c] = s / n;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let s = 0, n = 0;
    for (let k = -rad; k <= rad; k++) { const rr = r + k; if (rr >= 0 && rr < rows) { s += tmp[rr * cols + c]; n++; } }
    out[r * cols + c] = s / n;
  }
  return { ...el, heightsM: out };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D | null] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

/** Terrain image at k× the grid: Mars colour ramp × two-light hillshade × local relief, plus film grain. */
function renderTerrain(el: Elevation, k = 3, R: Ramp = DEFAULT_RAMP): HTMLCanvasElement {
  const w = el.cols * k, h = el.rows * k;
  const [cv, ctx] = canvas(w, h);
  if (!ctx) return cv;
  let lo = Infinity, hi = -Infinity;
  for (const v of el.heightsM) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(1, hi - lo);
  const soft = blurred(el, 4);
  const img = ctx.createImageData(w, h);
  const px = el.cellM / k;
  const ex = 5; // vertical exaggeration for shading only
  const key = { x: -0.406, y: -0.406, z: 0.819 }, fill = { x: 0.5, y: 0.5, z: 0.707 };
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const p = { x: (c + 0.5) * px, y: (r + 0.5) * px };
      const z = heightAt(el, p);
      const dzdx = ((heightAt(el, { x: p.x + px, y: p.y }) - heightAt(el, { x: p.x - px, y: p.y })) / (2 * px)) * ex;
      const dzdy = ((heightAt(el, { x: p.x, y: p.y + px }) - heightAt(el, { x: p.x, y: p.y - px })) / (2 * px)) * ex;
      const n = Math.hypot(dzdx, dzdy, 1);
      const sKey = Math.max(0, (-dzdx * key.x - dzdy * key.y + key.z) / n);
      const sFill = Math.max(0, (-dzdx * fill.x - dzdy * fill.y + fill.z) / n);
      const local = z - heightAt(soft, p);
      const ao = Math.min(1.25, Math.max(0.65, 1 + local * 0.05));
      const hash = Math.sin(c * 12.9898 + r * 78.233) * 43758.5453;
      const grain = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.07;
      const s = (0.1 + 1.0 * sKey + 0.12 * sFill) * ao * grain;
      const [Rc, G, B] = ramp(R, (z - lo) / span);
      const i = (r * w + c) * 4;
      img.data[i] = Math.min(255, Rc * s);
      img.data[i + 1] = Math.min(255, G * s);
      img.data[i + 2] = Math.min(255, B * s);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Contour lines every 5 m, thicker every 25 m, at k× the grid. */
function renderContours(el: Elevation, k = 3): HTMLCanvasElement {
  const [cv, ctx] = canvas(el.cols * k, el.rows * k);
  if (!ctx) return cv;
  let lo = Infinity, hi = -Infinity;
  for (const v of el.heightsM) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ctx.lineCap = 'round';
  for (let lvl = Math.ceil(lo / 5) * 5; lvl <= hi; lvl += 5) {
    const major = lvl % 25 === 0;
    ctx.strokeStyle = major ? 'rgba(255,225,190,0.32)' : 'rgba(255,225,190,0.13)';
    ctx.lineWidth = major ? 1.4 : 0.8;
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of contourSegments(el.heightsM, el.cols, el.rows, lvl)) {
      ctx.moveTo((x0 + 0.5) * k, (y0 + 0.5) * k); ctx.lineTo((x1 + 0.5) * k, (y1 + 0.5) * k);
    }
    ctx.stroke();
  }
  return cv;
}

function renderSlope(el: Elevation): HTMLCanvasElement {
  const [cv, ctx] = canvas(el.cols, el.rows);
  if (!ctx) return cv;
  const img = ctx.createImageData(el.cols, el.rows);
  for (let r = 0; r < el.rows; r++) for (let c = 0; c < el.cols; c++) {
    const s = slopeAt(el, { x: (c + 0.5) * el.cellM, y: (r + 0.5) * el.cellM });
    img.data.set(s > SLOPE_BLOCKED ? [255, 60, 60, 170] : s > SLOPE_STEEP ? [255, 140, 0, 110] : s > SLOPE_CAUTION ? [255, 200, 0, 55] : [0, 0, 0, 0], (r * el.cols + c) * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Unexplored ground darkened, pre-blurred so the edge is soft. */
function renderFog(ex: Explored): HTMLCanvasElement {
  const [raw, rctx] = canvas(ex.cols, ex.rows);
  const k = 4;
  const [cv, ctx] = canvas(ex.cols * k, ex.rows * k);
  if (!rctx || !ctx) return cv;
  const img = rctx.createImageData(ex.cols, ex.rows);
  for (let i = 0; i < ex.seen.length; i++) img.data.set(ex.seen[i] ? [0, 0, 0, 0] : [7, 11, 8, 135], i * 4);
  rctx.putImageData(img, 0, 0);
  ctx.filter = 'blur(5px)';
  ctx.drawImage(raw, 0, 0, cv.width, cv.height);
  return cv;
}

/** Safe-return zone: inside stays clear, one-way ground is tinted amber, out of reach is darkened. */
function renderRange(el: Elevation, range: RangeField, reserve: number): HTMLCanvasElement {
  const [cv, ctx] = canvas(el.cols, el.rows);
  if (!ctx) return cv;
  const img = ctx.createImageData(el.cols, el.rows);
  for (let i = 0; i < range.safe.length; i++) {
    const s = range.safe[i], r = range.reach[i];
    img.data.set(s >= reserve ? [0, 0, 0, 0] : r >= 0 ? [24, 12, 0, 105] : [28, 0, 0, 170], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Cell-based hazard zones (from Data's terrain classes) drawn once: dots for sand, hatching for rocks. */
function renderMasks(zones: HazardZone[]): HTMLCanvasElement | null {
  const masked = zones.filter((z) => z.mask);
  if (!masked.length) return null;
  const m0 = masked[0].mask!;
  const k = 6;
  const [cv, ctx] = canvas(m0.cols * k, m0.rows * k);
  if (!ctx) return cv;
  for (const z of masked) {
    const m = z.mask!;
    const pat = makePattern(ctx, z.kind);
    ctx.fillStyle = pat ?? (z.kind === 'sand' ? 'rgba(255,176,0,0.3)' : 'rgba(255,77,77,0.3)');
    const s = (k * m.cellM) / m0.cellM;
    for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) if (m.on[r * m.cols + c]) ctx.fillRect(c * s, r * s, s, s);
  }
  return cv;
}

function makePattern(ctx: CanvasRenderingContext2D, kind: HazardZone['kind']): CanvasPattern | null {
  const [p, g] = canvas(10, 10);
  if (!g) return null;
  if (kind === 'sand') {
    g.fillStyle = 'rgba(255,176,0,0.5)';
    g.fillRect(2, 2, 1.5, 1.5); g.fillRect(7, 7, 1.5, 1.5);
  } else {
    g.strokeStyle = 'rgba(255,77,77,0.5)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(10, 0); g.stroke();
  }
  return ctx.createPattern(p, 'repeat');
}

function niceLength(target: number): number {
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

interface Mote { x: number; y: number; v: number; len: number }

export function MapView(props: MapViewProps) {
  const { pack, explored, exploredVersion, range, crashPath } = props;
  const reserve = props.reserve ?? 0.1;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const userMovedRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const nightCvRef = useRef<HTMLCanvasElement | null>(null);
  const motesRef = useRef<Mote[]>([]);
  const patternsRef = useRef<Partial<Record<HazardZone['kind'], CanvasPattern | null>>>({});
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hover, setHover] = useState<Pt | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);

  const el = pack.elevation;
  const W = pack.area.widthM, H = pack.area.heightM;
  // Large real grids are already detailed; render them at 2× instead of 3× to keep start-up quick.
  const colors = pack.marsVisuals?.terrainColors;
  const terrain = useMemo(() => renderTerrain(el, el.cols * el.rows > 100_000 ? 2 : 3, terrainRamp(colors)), [el, colors]);
  const contours = useMemo(() => renderContours(el, el.cols * el.rows > 100_000 ? 2 : 3), [el]);
  const masks = useMemo(() => renderMasks(props.zones), [props.zones]);
  const slope = useMemo(() => renderSlope(el), [el]);
  // exploredVersion signals that the grid inside `explored` changed.
  const fog = useMemo(() => renderFog(explored), [explored, exploredVersion]);
  const rangeImg = useMemo(() => (range ? renderRange(el, range, reserve) : null), [el, range, reserve]);
  const rangeEdges = useMemo(() => {
    if (!range) return null;
    const toM = (s: Segment): Segment => [(s[0] + 0.5) * el.cellM, (s[1] + 0.5) * el.cellM, (s[2] + 0.5) * el.cellM, (s[3] + 0.5) * el.cellM];
    return {
      safe: contourSegments(range.safe, el.cols, el.rows, reserve).map(toM),
      reach: contourSegments(range.reach, el.cols, el.rows, 0).map(toM),
    };
  }, [el, range, reserve]);
  const scar = useMemo(() => (crashPath ?? []).flatMap((p, i, a) => (i ? samplePath(a[i - 1], p, 12).slice(1) : [p])), [crashPath]);
  const imageUrl = pack.imageUrl && !pack.imageUrl.startsWith('/') && !/^[a-z]+:/i.test(pack.imageUrl) ? `/${pack.imageUrl}` : pack.imageUrl;

  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.src = imageUrl;
    return () => { img.onload = null; setPhoto(null); };
  }, [imageUrl]);

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { viewRef.current = null; userMovedRef.current = false; }, [W, H]);
  useEffect(() => { if (!userMovedRef.current) viewRef.current = null; }, [size.w, size.h]);

  const getView = (): View => {
    if (!viewRef.current) {
      const scale = Math.min(size.w / W, size.h / H) * 0.94;
      viewRef.current = { scale, ox: (size.w - W * scale) / 2, oy: (size.h - H * scale) / 2 };
    }
    return viewRef.current;
  };
  const toMap = (sx: number, sy: number): Pt => { const v = getView(); return { x: (sx - v.ox) / v.scale, y: (sy - v.oy) / v.scale }; };

  // Everything the draw loop needs, refreshed after every render so the loop always sees the latest props.
  const live = { props, size, getView, terrain, contours, slope, fog, rangeImg, rangeEdges, scar, photo, reserve, masks };
  const liveRef = useRef(live);
  useEffect(() => { liveRef.current = live; });

  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      const L = liveRef.current;
      const cv = canvasRef.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const { props: P, size: sz } = L;
      const { zones, items, found, astronaut, sightM, waypoints, route, layers: lay } = P;
      const PW = P.pack.area.widthM, PH = P.pack.area.heightM;
      const dpr = window.devicePixelRatio || 1;
      const pw = Math.round(sz.w * dpr), ph = Math.round(sz.h * dpr);
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
      const v = L.getView();
      const S = (p: Pt) => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
      const mapW = PW * v.scale, mapH = PH * v.scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#070b08';
      ctx.fillRect(0, 0, sz.w, sz.h);

      ctx.save();
      ctx.beginPath(); ctx.rect(v.ox, v.oy, mapW, mapH); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      if (L.photo) {
        ctx.drawImage(L.photo, v.ox, v.oy, mapW, mapH);
        ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
      }
      ctx.drawImage(L.terrain, v.ox, v.oy, mapW, mapH);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      if (lay.contours) ctx.drawImage(L.contours, v.ox, v.oy, mapW, mapH);
      if (lay.slope) ctx.drawImage(L.slope, v.ox, v.oy, mapW, mapH);
      if (lay.range && L.rangeImg) ctx.drawImage(L.rangeImg, v.ox, v.oy, mapW, mapH);

      if (lay.hazards && L.masks) {
        const m = zones.find((z) => z.mask)?.mask;
        if (m) { ctx.globalAlpha = 0.8; ctx.drawImage(L.masks, v.ox, v.oy, m.cols * m.cellM * v.scale, m.rows * m.cellM * v.scale); ctx.globalAlpha = 1; }
      }
      if (lay.hazards) {
        for (const z of zones) {
          if (z.mask) continue;
          ctx.beginPath();
          z.poly.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
          ctx.closePath();
          if (!(z.kind in patternsRef.current)) patternsRef.current[z.kind] = makePattern(ctx, z.kind);
          const pat = patternsRef.current[z.kind];
          if (pat) { ctx.fillStyle = pat; ctx.fill(); }
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = z.kind === 'sand' ? 'rgba(255,176,0,0.75)' : 'rgba(255,77,77,0.75)';
          ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        }
      }
      if (lay.fog) ctx.drawImage(L.fog, v.ox, v.oy, P.explored.cols * P.explored.cellM * v.scale, P.explored.rows * P.explored.cellM * v.scale);

      // Crash scar: only the stretches the astronaut has seen (old orbital maps predate the crash).
      ctx.lineCap = 'round';
      for (let i = 1; i < L.scar.length; i++) {
        const a = L.scar[i - 1], b = L.scar[i];
        if (!isSeen(P.explored, b)) continue;
        const sa = S(a), sb = S(b);
        ctx.strokeStyle = 'rgba(20,12,10,0.55)'; ctx.lineWidth = Math.max(3, 14 * v.scale);
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,150,90,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      }

      // The rover: archive traverse (dim, always), last known area, and wheel tracks once seen (gone in a storm).
      const poly = (pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.stroke(); };
      ctx.strokeStyle = 'rgba(255,107,214,0.45)'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
      for (const seg of P.archiveTraverse ?? []) poly(seg);
      ctx.setLineDash([]);
      if (P.searchArea) {
        const c = S(P.searchArea.at), r = P.searchArea.r * v.scale;
        ctx.setLineDash([10, 6]); ctx.strokeStyle = 'rgba(255,107,214,0.7)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,107,214,0.9)'; ctx.font = 'bold 10px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
        ctx.fillText('ROVER: LAST KNOWN AREA', c.x, c.y - r - 6);
      }
      if (!P.storm) {
        ctx.strokeStyle = 'rgba(255,107,214,0.95)'; ctx.lineWidth = 2;
        for (const seg of P.roverTracks ?? []) {
          for (let i = 1; i < seg.length; i++) {
            if (!isSeen(P.explored, seg[i]) && !lay.allItems) continue;
            const a = S(seg[i - 1]), b = S(seg[i]);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }

      // Night: the land goes dark except around the astronaut's lamp.
      if (P.night) {
        let nc = nightCvRef.current;
        if (!nc) { nc = document.createElement('canvas'); nightCvRef.current = nc; }
        if (nc.width !== pw || nc.height !== ph) { nc.width = pw; nc.height = ph; }
        const n = nc.getContext('2d');
        if (n) {
          n.setTransform(dpr, 0, 0, dpr, 0, 0);
          n.globalCompositeOperation = 'source-over';
          n.clearRect(0, 0, sz.w, sz.h);
          n.fillStyle = 'rgba(3,6,22,0.68)'; n.fillRect(0, 0, sz.w, sz.h);
          const a = S(astronaut), rad = Math.max(26, sightM * v.scale * 1.8);
          const g = n.createRadialGradient(a.x, a.y, 0, a.x, a.y, rad);
          g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.55, 'rgba(0,0,0,0.85)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          n.globalCompositeOperation = 'destination-out';
          n.fillStyle = g; n.beginPath(); n.arc(a.x, a.y, rad, 0, Math.PI * 2); n.fill();
          ctx.drawImage(nc, 0, 0, sz.w, sz.h);
        }
      }

      // Dust storm: brown haze and blowing dust.
      if (P.storm) {
        ctx.fillStyle = 'rgba(150,84,38,0.42)'; ctx.fillRect(v.ox, v.oy, mapW, mapH);
        const motes = motesRef.current;
        while (motes.length < 420) motes.push({ x: Math.random() * sz.w, y: Math.random() * sz.h, v: 2 + Math.random() * 5, len: 8 + Math.random() * 22 });
        ctx.strokeStyle = 'rgba(225,165,110,0.28)'; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const m of motes) {
          m.x -= m.v; m.y += m.v * 0.25;
          if (m.x < -30) { m.x = sz.w + 10; m.y = Math.random() * sz.h; }
          if (m.y > sz.h + 10) m.y = -10;
          ctx.moveTo(m.x, m.y); ctx.lineTo(m.x + m.len, m.y - m.len * 0.25);
        }
        ctx.stroke();
      }

      if (lay.grid) {
        ctx.strokeStyle = 'rgba(77,255,136,0.12)'; ctx.fillStyle = 'rgba(77,255,136,0.55)';
        ctx.font = '10px ui-monospace, Consolas, monospace'; ctx.lineWidth = 1;
        for (let m = 500; m < Math.max(PW, PH); m += 500) {
          if (m < PW) { const a = S({ x: m, y: 0 }), b = S({ x: m, y: PH }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillText(`${m}`, a.x + 2, a.y + 11); }
          if (m < PH) { const a = S({ x: 0, y: m }), b = S({ x: PW, y: m }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillText(`${m}`, a.x + 2, a.y - 2); }
        }
      }

      // Safe-return edge (glowing) and one-way edge (dashed).
      if (lay.range && L.rangeEdges) {
        const edge = (segs: Segment[]) => { ctx.beginPath(); for (const [x0, y0, x1, y1] of segs) { const a = S({ x: x0, y: y0 }), b = S({ x: x1, y: y1 }); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); } ctx.stroke(); };
        ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,176,0,0.7)'; ctx.lineWidth = 1.2;
        edge(L.rangeEdges.reach);
        ctx.setLineDash([]);
        const glow = 0.75 + 0.25 * Math.sin(now / 420);
        ctx.shadowColor = '#4dff88'; ctx.shadowBlur = 10;
        ctx.strokeStyle = `rgba(77,255,136,${0.85 * glow})`; ctx.lineWidth = 2;
        edge(L.rangeEdges.safe);
        ctx.shadowBlur = 0;
      }
      ctx.restore();

      ctx.strokeStyle = 'rgba(77,255,136,0.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(v.ox + 0.5, v.oy + 0.5, mapW, mapH);

      // Footprints.
      const tracks = P.tracks ?? [];
      ctx.fillStyle = 'rgba(232,255,240,0.55)';
      for (let i = 0; i < tracks.length; i += 2) { const s = S(tracks[i]); ctx.fillRect(s.x - 1, s.y - 1, 2, 2); }

      // Route: legs coloured by status with moving dashes, path home faint.
      const line = (path: Pt[]) => { ctx.beginPath(); path.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); }); ctx.stroke(); };
      if (route) {
        if (route.legs.length) {
          ctx.setLineDash([2, 5]); ctx.lineWidth = 1.5;
          ctx.strokeStyle = route.home.ok ? 'rgba(77,255,136,0.55)' : 'rgba(255,77,77,0.85)';
          line(route.home.path);
        }
        route.legs.forEach((leg, i) => {
          ctx.setLineDash([]); ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 5; line(leg.path);
          ctx.strokeStyle = STATUS_COLOR[leg.status]; ctx.lineWidth = 2.5;
          const past = route.pnrIndex !== null && i > route.pnrIndex;
          ctx.setLineDash(past ? [8, 6] : [14, 6]); ctx.lineDashOffset = -now / 45;
          line(leg.path);
        });
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
        // Sim's point of no return: the route turns red after it.
        const tb = route.turnBackByMin;
        if (tb !== null && tb < route.minutes - 0.5) {
          const k = route.samples.findIndex((p) => p.t >= tb);
          if (k >= 0) {
            ctx.strokeStyle = 'rgba(255,77,77,0.9)'; ctx.lineWidth = 3;
            line(route.samples.slice(k).map((p) => p.at));
            const s = S(route.samples[k].at);
            ctx.fillStyle = '#ff4d4d'; ctx.strokeStyle = '#070b08'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.font = 'bold 10px ui-monospace, Consolas, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            const label = `TURN BACK BY ${Math.round(tb)} MIN`;
            const tw = ctx.measureText(label).width + 8;
            ctx.fillStyle = 'rgba(7,11,8,0.85)'; ctx.fillRect(s.x + 9, s.y - 8, tw, 16);
            ctx.fillStyle = '#ff4d4d'; ctx.fillText(label, s.x + 13, s.y);
          }
        }
      }

      ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      waypoints.forEach((p, i) => {
        const s = S(p);
        const st: Status = route?.legs[i]?.status ?? 'nominal';
        ctx.fillStyle = '#070b08'; ctx.strokeStyle = STATUS_COLOR[st]; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = STATUS_COLOR[st]; ctx.fillText(String(i + 1), s.x, s.y + 0.5);
        if (route?.pnrIndex === i) {
          ctx.fillStyle = '#ff4d4d';
          ctx.beginPath(); ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x - 8, s.y - 13); ctx.lineTo(s.x + 8, s.y - 13); ctx.closePath(); ctx.fill();
          ctx.font = 'bold 10px ui-monospace, Consolas, monospace'; ctx.fillText('NO RETURN', s.x, s.y - 33);
          ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
        }
      });

      // Items. In a storm, shelters still reachable pulse (proposal §6.3).
      ctx.font = 'bold 9px ui-monospace, Consolas, monospace';
      for (const it of items) {
        const shown = !it.hidden || found.has(it.id);
        if (!shown && !lay.allItems) continue;
        const s = S(it.at);
        const st = it.required ? { code: 'COMMS', color: '#ffffff' } : ITEM_STYLE[it.kind];
        if (it.kind === 'sample') {
          ctx.fillStyle = 'rgba(7,11,8,0.8)'; ctx.strokeStyle = st.color; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(s.x, s.y, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          continue;
        }
        if (P.storm && shown && (it.kind === 'shelter' || it.kind === 'base') && P.range && P.range.reach[cellOf(P.pack.elevation, it.at)] >= 0) {
          const k = (now % 1400) / 1400;
          ctx.strokeStyle = `rgba(255,176,0,${1 - k})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(s.x, s.y, 10 + k * 22, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = shown ? 1 : 0.35;
        ctx.strokeStyle = st.color; ctx.fillStyle = 'rgba(7,11,8,0.85)'; ctx.lineWidth = 1.5;
        if (it.kind === 'base') {
          ctx.fillRect(s.x - 8, s.y - 8, 16, 16); ctx.strokeRect(s.x - 8, s.y - 8, 16, 16);
          ctx.beginPath(); ctx.moveTo(s.x - 4, s.y); ctx.lineTo(s.x + 4, s.y); ctx.moveTo(s.x, s.y - 4); ctx.lineTo(s.x, s.y + 4); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(s.x, s.y - 8); ctx.lineTo(s.x + 8, s.y); ctx.lineTo(s.x, s.y + 8); ctx.lineTo(s.x - 8, s.y); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        const tw = ctx.measureText(st.code).width + 6;
        ctx.fillStyle = 'rgba(7,11,8,0.8)'; ctx.fillRect(s.x - tw / 2, s.y + 11, tw, 12);
        ctx.fillStyle = st.color; ctx.fillText(st.code, s.x, s.y + 17.5);
        ctx.globalAlpha = 1;
      }

      // Find pings.
      for (const pg of P.pings ?? []) {
        const k = (now - pg.t0) / 1600;
        if (k < 0 || k > 1) continue;
        const s = S(pg.at);
        ctx.strokeStyle = `rgba(232,255,240,${1 - k})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, 8 + k * 40, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 8 + k * 22, 0, Math.PI * 2); ctx.stroke();
      }

      // Astronaut: sight ring with a radar sweep.
      const a = S(astronaut), sr = Math.max(6, sightM * v.scale);
      const cg = ctx.createConicGradient((now / 1000) * 1.8, a.x, a.y);
      cg.addColorStop(0, 'rgba(77,255,136,0.30)'); cg.addColorStop(0.1, 'rgba(77,255,136,0.0)'); cg.addColorStop(1, 'rgba(77,255,136,0.0)');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(a.x, a.y, sr, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(77,255,136,0.75)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(a.x, a.y, sr, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      const beat = (now % 1600) / 1600;
      ctx.strokeStyle = `rgba(77,255,136,${0.6 * (1 - beat)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(a.x, a.y, 6 + beat * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e8fff0'; ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // Scale bar, north arrow and the safe-zone key.
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const len = niceLength(140 / v.scale);
      const bx = 16, by = sz.h - 18, bw = len * v.scale;
      ctx.fillStyle = 'rgba(7,11,8,0.75)'; ctx.fillRect(bx - 6, by - 18, bw + 12, 26);
      ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 4); ctx.stroke();
      ctx.fillStyle = '#4dff88'; ctx.font = '11px ui-monospace, Consolas, monospace';
      ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx, by - 7);
      const nx = sz.w - 28, ny = 30;
      ctx.fillStyle = 'rgba(7,11,8,0.75)'; ctx.beginPath(); ctx.arc(nx, ny, 17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4dff88';
      ctx.beginPath(); ctx.moveTo(nx, ny - 12); ctx.lineTo(nx + 6, ny + 6); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 6, ny + 6); ctx.closePath(); ctx.fill();
      ctx.font = 'bold 9px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 14);
      if (lay.range && P.range) {
        ctx.textAlign = 'left'; ctx.font = '10px ui-monospace, Consolas, monospace';
        const kx = sz.w - 196, ky = sz.h - 44;
        ctx.fillStyle = 'rgba(7,11,8,0.8)'; ctx.fillRect(kx - 8, ky - 14, 192, 40);
        ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(kx, ky - 4); ctx.lineTo(kx + 16, ky - 4); ctx.stroke();
        ctx.fillStyle = '#4dff88'; ctx.fillText(`SAFE RETURN (≥${Math.round(L.reserve * 100)}% left)`, kx + 22, ky);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(kx, ky + 12); ctx.lineTo(kx + 16, ky + 12); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ffb000'; ctx.fillText('ONE-WAY LIMIT', kx + 22, ky + 16);
      }
    };
    const frame = (now: number) => { draw(now); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const onWheel = (e: RWheelEvent) => {
    const v = getView();
    const s = local(e);
    const fit = Math.min(size.w / W, size.h / H) * 0.94;
    const scale = Math.min(fit * 12, Math.max(fit * 0.8, v.scale * Math.exp(-e.deltaY * 0.0015)));
    viewRef.current = { scale, ox: s.x - ((s.x - v.ox) * scale) / v.scale, oy: s.y - ((s.y - v.oy) * scale) / v.scale };
    userMovedRef.current = true;
  };
  const onMouseDown = (e: RMouseEvent) => { if (e.button === 0) dragRef.current = { ...local(e), moved: false }; };
  const onMouseMove = (e: RMouseEvent) => {
    const s = local(e);
    const d = dragRef.current;
    if (d && (d.moved || Math.hypot(s.x - d.x, s.y - d.y) > 4)) {
      const v = getView();
      viewRef.current = { ...v, ox: v.ox + s.x - d.x, oy: v.oy + s.y - d.y };
      userMovedRef.current = true;
      dragRef.current = { ...s, moved: true };
    }
    const p = toMap(s.x, s.y);
    setHover(p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H ? p : null);
  };
  const onMouseUp = (e: RMouseEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.moved || e.button !== 0) return;
    const p = toMap(local(e).x, local(e).y);
    if (p.x >= 0 && p.y >= 0 && p.x <= W && p.y <= H) props.onAddWaypoint?.(p);
  };
  const onContextMenu = (e: RMouseEvent) => {
    e.preventDefault();
    const s = local(e), v = getView();
    const idx = props.waypoints.findIndex((p) => Math.hypot(v.ox + p.x * v.scale - s.x, v.oy + p.y * v.scale - s.y) < 12);
    if (idx >= 0) props.onRemoveWaypoint?.(idx);
  };
  const onDoubleClick = () => { viewRef.current = null; userMovedRef.current = false; };

  const readout = hover && (() => {
    const ll = toLatLon(pack.area, hover);
    const z = zoneAt(props.zones, hover);
    const sl = slopeAt(el, hover);
    const ci = cellOf(el, hover);
    const safe = range?.safe[ci], reach = range?.reach[ci];
    return (
      <div className="mv-readout">
        <span>{ll.lat.toFixed(4)}°N {ll.lon.toFixed(4)}°E</span>
        <span>elev {heightAt(el, hover).toFixed(0)} m</span>
        <span style={{ color: sl > SLOPE_BLOCKED ? 'var(--critical)' : sl > SLOPE_CAUTION ? 'var(--warning)' : undefined }}>slope {sl.toFixed(1)}°{sl > SLOPE_BLOCKED ? ' BLOCKED' : ''}</span>
        <span>{z ? z.label : 'firm ground'}</span>
        <span>{(dist(hover, props.base) / 1000).toFixed(2)} km to base</span>
        {safe !== undefined && reach !== undefined && (
          safe >= reserve ? <span>return margin {(safe * 100).toFixed(0)}%</span>
            : reach >= 0 ? <span style={{ color: 'var(--warning)' }}>ONE-WAY: no safe return</span>
              : <span style={{ color: 'var(--critical)' }}>out of reach</span>
        )}
      </div>
    );
  })();

  return (
    <div ref={wrapRef} className="mv-wrap">
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h, display: 'block', cursor: 'crosshair' }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => { dragRef.current = null; setHover(null); }}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
      />
      {readout}
    </div>
  );
}
