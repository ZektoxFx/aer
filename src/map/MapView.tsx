// The Mars map canvas: terrain, hazards, explored ground, items, route and astronaut.
// Click = add waypoint, right-click a waypoint = remove it, wheel = zoom, drag = pan.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as RMouseEvent, WheelEvent as RWheelEvent } from 'react';
import type { DataPack } from '../data/types';
import type { Pt } from './geo';
import { dist, heightAt, slopeAt, toLatLon } from './geo';
import type { HazardZone, ItemKind, MapItem } from './layout';
import { SLOPE_BLOCKED, SLOPE_CAUTION, SLOPE_STEEP, zoneAt } from './layout';
import type { RouteResult, Status } from './route';
import type { Explored } from './visibility';

export interface MapLayers { slope: boolean; hazards: boolean; fog: boolean; grid: boolean; allItems: boolean }

export interface MapViewProps {
  pack: DataPack;
  zones: HazardZone[];
  /** All items; hidden ones are drawn only when found (or when layers.allItems is on). */
  items: MapItem[];
  found: ReadonlySet<string>;
  explored: Explored;
  /** Bump this when `explored` changes so the fog redraws. */
  exploredVersion: number;
  base: Pt;
  astronaut: Pt;
  sightM: number;
  waypoints: Pt[];
  route: RouteResult | null;
  layers: MapLayers;
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
  scrap: { code: 'PART', color: '#ff9a5c' },
  manual: { code: 'PAGE', color: '#e8f5ec' },
  shelter: { code: 'SHLT', color: '#9fe0b4' },
  rover: { code: 'ROVER', color: '#ff6bd6' },
};

/** Terrain image: rust colour by height, lit by hillshade. Rendered at `k`× the grid for smooth light. */
function renderTerrain(pack: DataPack, k = 3): HTMLCanvasElement {
  const el = pack.elevation;
  const w = el.cols * k, h = el.rows * k;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  let lo = Infinity, hi = -Infinity;
  for (const v of el.heightsM) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(1, hi - lo);
  const img = ctx.createImageData(w, h);
  const px = el.cellM / k;
  // Sun from the north-west, 35° up; heights exaggerated ×3 so gentle relief reads on screen.
  const L = { x: -0.5736 * 0.7071, y: -0.5736 * 0.7071, z: 0.8192 };
  const ex = 5;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const p = { x: (c + 0.5) * px, y: (r + 0.5) * px };
      const z = heightAt(el, p);
      const dzdx = ((heightAt(el, { x: p.x + px, y: p.y }) - heightAt(el, { x: p.x - px, y: p.y })) / (2 * px)) * ex;
      const dzdy = ((heightAt(el, { x: p.x, y: p.y + px }) - heightAt(el, { x: p.x, y: p.y - px })) / (2 * px)) * ex;
      const n = Math.hypot(dzdx, dzdy, 1);
      const shade = Math.max(0, (-dzdx * L.x - dzdy * L.y + L.z) / n);
      const t = (z - lo) / span;
      // Low ground deep rust, high ground pale ochre.
      const base = [62 + 120 * t, 30 + 70 * t, 20 + 42 * t];
      const s = 0.12 + 1.2 * shade;
      const i = (r * w + c) * 4;
      img.data[i] = Math.min(255, base[0] * s);
      img.data[i + 1] = Math.min(255, base[1] * s);
      img.data[i + 2] = Math.min(255, base[2] * s);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Slope bands as a transparent overlay, one pixel per grid cell. */
function renderSlope(pack: DataPack): HTMLCanvasElement {
  const el = pack.elevation;
  const cv = document.createElement('canvas');
  cv.width = el.cols; cv.height = el.rows;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(el.cols, el.rows);
  for (let r = 0; r < el.rows; r++) {
    for (let c = 0; c < el.cols; c++) {
      const s = slopeAt(el, { x: (c + 0.5) * el.cellM, y: (r + 0.5) * el.cellM });
      const rgba = s > SLOPE_BLOCKED ? [255, 60, 60, 170] : s > SLOPE_STEEP ? [255, 140, 0, 120] : s > SLOPE_CAUTION ? [255, 200, 0, 70] : [0, 0, 0, 0];
      img.data.set(rgba, (r * el.cols + c) * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function renderFog(ex: Explored): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = ex.cols; cv.height = ex.rows;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(ex.cols, ex.rows);
  for (let i = 0; i < ex.seen.length; i++) img.data.set(ex.seen[i] ? [0, 0, 0, 0] : [7, 11, 8, 150], i * 4);
  ctx.putImageData(img, 0, 0);
  return cv;
}

function makePattern(ctx: CanvasRenderingContext2D, kind: HazardZone['kind']): CanvasPattern | null {
  const p = document.createElement('canvas');
  p.width = p.height = 10;
  const g = p.getContext('2d');
  if (!g) return null;
  if (kind === 'sand') {
    g.fillStyle = 'rgba(255,176,0,0.55)';
    g.fillRect(2, 2, 1.5, 1.5); g.fillRect(7, 7, 1.5, 1.5);
  } else {
    g.strokeStyle = 'rgba(255,77,77,0.55)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(10, 0); g.stroke();
  }
  return ctx.createPattern(p, 'repeat');
}

/** A tidy scale-bar length (m) close to `target`. */
function niceLength(target: number): number {
  const pow = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 5, 10].map((m) => m * pow).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

export function MapView(props: MapViewProps) {
  const { pack, zones, items, found, explored, exploredVersion, base, astronaut, sightM, waypoints, route, layers } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<View | null>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  /** True once the user zooms or pans; until then the map re-fits when the window resizes. */
  const userMovedRef = useRef(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [viewTick, setViewTick] = useState(0);
  const [hover, setHover] = useState<Pt | null>(null);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);

  const terrain = useMemo(() => renderTerrain(pack), [pack]);
  const slope = useMemo(() => renderSlope(pack), [pack]);
  // exploredVersion is the signal that the grid inside `explored` changed.
  const fog = useMemo(() => renderFog(explored), [explored, exploredVersion]);

  // Real orbital photo from the Data role, when the pack names one.
  useEffect(() => {
    if (!pack.imageUrl) { setPhoto(null); return; }
    const img = new Image();
    img.onload = () => setPhoto(img);
    img.onerror = () => setPhoto(null);
    img.src = pack.imageUrl;
  }, [pack.imageUrl]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const W = pack.area.widthM, H = pack.area.heightM;
  // Fit the whole area on first draw and whenever the area changes.
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

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const v = getView();
    const S = (p: Pt) => ({ x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#070b08';
    ctx.fillRect(0, 0, size.w, size.h);

    // Terrain (or the real photo, with relief shading on top).
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (photo) {
      ctx.drawImage(photo, v.ox, v.oy, W * v.scale, H * v.scale);
      ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply';
    }
    ctx.drawImage(terrain, v.ox, v.oy, W * v.scale, H * v.scale);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

    if (layers.slope) ctx.drawImage(slope, v.ox, v.oy, W * v.scale, H * v.scale);

    if (layers.hazards) {
      for (const z of zones) {
        ctx.beginPath();
        z.poly.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
        ctx.closePath();
        const pat = makePattern(ctx, z.kind);
        if (pat) { ctx.fillStyle = pat; ctx.fill(); }
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = z.kind === 'sand' ? 'rgba(255,176,0,0.8)' : 'rgba(255,77,77,0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    if (layers.fog) {
      // Blur in screen pixels so the remembered-ground edge is soft, not stair-stepped.
      ctx.save();
      ctx.beginPath(); ctx.rect(v.ox, v.oy, W * v.scale, H * v.scale); ctx.clip();
      ctx.filter = `blur(${Math.max(2, Math.min(10, explored.cellM * v.scale * 0.6))}px)`;
      ctx.drawImage(fog, v.ox, v.oy, explored.cols * explored.cellM * v.scale, explored.rows * explored.cellM * v.scale);
      ctx.restore();
    }

    if (layers.grid) {
      ctx.strokeStyle = 'rgba(77,255,136,0.12)';
      ctx.fillStyle = 'rgba(77,255,136,0.55)';
      ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.lineWidth = 1;
      for (let m = 0; m <= Math.max(W, H); m += 500) {
        if (m <= W) { const a = S({ x: m, y: 0 }), b = S({ x: m, y: H }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.fillText(`${m}`, a.x + 2, a.y + 11); }
        if (m <= H) { const a = S({ x: 0, y: m }), b = S({ x: W, y: m }); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); if (m) ctx.fillText(`${m}`, a.x + 2, a.y - 2); }
      }
    }

    // Map frame.
    ctx.strokeStyle = 'rgba(77,255,136,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(v.ox, v.oy, W * v.scale, H * v.scale);

    // Route legs, coloured by status; legs past the point of no return are dashed.
    if (route) {
      const pnr = route.pnrIndex;
      route.legs.forEach((leg, i) => {
        const a = S(leg.from), b = S(leg.to);
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = STATUS_COLOR[leg.status]; ctx.lineWidth = 2.5;
        if (pnr !== null && i > pnr) ctx.setLineDash([8, 6]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      ctx.setLineDash([]);
      // Straight walk home from the last waypoint.
      if (route.legs.length) {
        const a = S(route.legs[route.legs.length - 1].to), b = S(base);
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = route.home.ok ? 'rgba(77,255,136,0.7)' : 'rgba(255,77,77,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Waypoints.
    ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    waypoints.forEach((p, i) => {
      const s = S(p);
      const st: Status = route?.legs[i]?.status ?? 'nominal';
      ctx.fillStyle = '#070b08'; ctx.strokeStyle = STATUS_COLOR[st]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = STATUS_COLOR[st];
      ctx.fillText(String(i + 1), s.x, s.y + 0.5);
      if (route?.pnrIndex === i) {
        ctx.fillStyle = '#ff4d4d';
        ctx.beginPath(); ctx.moveTo(s.x, s.y - 26); ctx.lineTo(s.x - 8, s.y - 13); ctx.lineTo(s.x + 8, s.y - 13); ctx.closePath(); ctx.fill();
        ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
        ctx.fillText('NO RETURN', s.x, s.y - 33);
        ctx.font = 'bold 11px ui-monospace, Consolas, monospace';
      }
    });

    // Items.
    ctx.font = 'bold 9px ui-monospace, Consolas, monospace';
    for (const it of items) {
      const shown = !it.hidden || found.has(it.id);
      if (!shown && !layers.allItems) continue;
      const s = S(it.at);
      const st = ITEM_STYLE[it.kind];
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

    // Astronaut and sight circle.
    const a = S(astronaut);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(77,255,136,0.75)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(4, sightM * v.scale), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(77,255,136,0.18)';
    ctx.beginPath(); ctx.arc(a.x, a.y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8fff0'; ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(a.x, a.y, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // Scale bar (bottom left) and north arrow (top right).
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const len = niceLength(140 / v.scale);
    const bx = 16, by = size.h - 18, bw = len * v.scale;
    ctx.fillStyle = 'rgba(7,11,8,0.75)'; ctx.fillRect(bx - 6, by - 18, bw + 12, 26);
    ctx.strokeStyle = '#4dff88'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 4); ctx.stroke();
    ctx.fillStyle = '#4dff88'; ctx.font = '11px ui-monospace, Consolas, monospace';
    ctx.fillText(len >= 1000 ? `${len / 1000} km` : `${len} m`, bx, by - 7);
    const nx = size.w - 28, ny = 30;
    ctx.fillStyle = 'rgba(7,11,8,0.75)'; ctx.beginPath(); ctx.arc(nx, ny, 17, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4dff88';
    ctx.beginPath(); ctx.moveTo(nx, ny - 12); ctx.lineTo(nx + 6, ny + 6); ctx.lineTo(nx, ny + 2); ctx.lineTo(nx - 6, ny + 6); ctx.closePath(); ctx.fill();
    ctx.font = 'bold 9px ui-monospace, Consolas, monospace'; ctx.textAlign = 'center';
    ctx.fillText('N', nx, ny + 14);
    // getView reads size and the view ref; viewTick redraws after zoom/pan.
  }, [size, viewTick, terrain, slope, fog, photo, zones, items, found, explored, base, astronaut, sightM, waypoints, route, layers, W, H]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const onWheel = (e: RWheelEvent) => {
    const v = getView();
    const s = local(e);
    const k = Math.exp(-e.deltaY * 0.0015);
    const fit = Math.min(size.w / W, size.h / H) * 0.94;
    const scale = Math.min(fit * 12, Math.max(fit * 0.8, v.scale * k));
    viewRef.current = { scale, ox: s.x - ((s.x - v.ox) * scale) / v.scale, oy: s.y - ((s.y - v.oy) * scale) / v.scale };
    userMovedRef.current = true;
    setViewTick((t) => t + 1);
  };

  const onMouseDown = (e: RMouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { ...local(e), moved: false };
  };
  const onMouseMove = (e: RMouseEvent) => {
    const s = local(e);
    const d = dragRef.current;
    if (d) {
      const dx = s.x - d.x, dy = s.y - d.y;
      if (d.moved || Math.hypot(dx, dy) > 4) {
        const v = getView();
        viewRef.current = { ...v, ox: v.ox + dx, oy: v.oy + dy };
        userMovedRef.current = true;
        dragRef.current = { ...s, moved: true };
        setViewTick((t) => t + 1);
      }
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
    const s = local(e);
    const v = getView();
    const idx = waypoints.findIndex((p) => Math.hypot(v.ox + p.x * v.scale - s.x, v.oy + p.y * v.scale - s.y) < 12);
    if (idx >= 0) props.onRemoveWaypoint?.(idx);
  };

  const readout = hover && (() => {
    const ll = toLatLon(pack.area, hover);
    const z = zoneAt(zones, hover);
    const sl = slopeAt(pack.elevation, hover);
    return (
      <div className="mv-readout">
        <span>{ll.lat.toFixed(4)}°N {ll.lon.toFixed(4)}°E</span>
        <span>elev {heightAt(pack.elevation, hover).toFixed(0)} m</span>
        <span style={{ color: sl > SLOPE_BLOCKED ? 'var(--critical)' : sl > SLOPE_CAUTION ? 'var(--warning)' : undefined }}>slope {sl.toFixed(1)}°{sl > SLOPE_BLOCKED ? ' BLOCKED' : ''}</span>
        <span>{z ? z.label : 'firm ground'}</span>
        <span>{(dist(hover, base) / 1000).toFixed(2)} km to base</span>
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
      />
      {readout}
    </div>
  );
}
