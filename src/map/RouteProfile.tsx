// Route profile strip chart: elevation along the route (coloured by slope) with the O₂ forecast on top.
import { useEffect, useRef, useState } from 'react';
import type { SuitState } from '../sim/types';
import type { Elevation } from './geo';
import { dist, heightAt } from './geo';
import { SLOPE_BLOCKED, SLOPE_CAUTION, SLOPE_STEEP } from './layout';
import type { RouteResult } from './route';

export interface RouteProfileProps {
  el: Elevation;
  route: RouteResult;
  /** Full suit, to draw O₂ as a percentage. */
  full: SuitState;
  /** Chart title naming the data source and sol (team rule: every chart names its source and sol). */
  title: string;
  /** Index into route.samples of the walking astronaut, if a walk is running. */
  progress?: number;
}

export function RouteProfile({ el, route, full, title, progress }: RouteProfileProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(600);
  const H = 150;

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = cvRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);

    const s = route.samples;
    const d: number[] = [0];
    for (let i = 1; i < s.length; i++) d.push(d[i - 1] + dist(s[i - 1].at, s[i].at));
    const z = s.map((p) => heightAt(el, p.at));
    const total = Math.max(1, d[d.length - 1]);
    let lo = Math.min(...z), hi = Math.max(...z);
    const pad = Math.max(4, (hi - lo) * 0.15);
    lo -= pad; hi += pad;
    const L = 42, R = 40, T = 22, B = 20, PW = w - L - R, PH = H - T - B;
    const X = (m: number) => L + (m / total) * PW;
    const Y = (h: number) => T + (1 - (h - lo) / (hi - lo)) * PH;
    const YO = (f: number) => T + (1 - f) * PH;

    // Frame and grid.
    ctx.strokeStyle = '#1c2a20'; ctx.lineWidth = 1;
    ctx.strokeRect(L + 0.5, T + 0.5, PW, PH);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#5f7a66';
    for (let k = 0; k <= 4; k++) {
      const y = T + (k / 4) * PH;
      ctx.beginPath(); ctx.moveTo(L, y + 0.5); ctx.lineTo(L + PW, y + 0.5); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText((hi - (k / 4) * (hi - lo)).toFixed(0), L - 4, y + 3);
      ctx.textAlign = 'left'; ctx.fillText(`${100 - k * 25}%`, L + PW + 4, y + 3);
    }
    const stepKm = total > 4000 ? 1000 : total > 1500 ? 500 : 250;
    ctx.textAlign = 'center';
    for (let m = 0; m <= total; m += stepKm) ctx.fillText(`${(m / 1000).toFixed(m % 1000 ? 2 : 0)} km`, X(m), H - 6);

    // Elevation area, each slice coloured by its slope.
    for (let i = 1; i < s.length; i++) {
      const run = d[i] - d[i - 1] || 1;
      const slope = Math.abs((Math.atan((z[i] - z[i - 1]) / run) * 180) / Math.PI);
      ctx.fillStyle = slope > SLOPE_BLOCKED ? 'rgba(255,77,77,0.75)' : slope > SLOPE_STEEP ? 'rgba(255,140,0,0.6)' : slope > SLOPE_CAUTION ? 'rgba(255,176,0,0.45)' : 'rgba(168,101,58,0.55)';
      ctx.beginPath();
      ctx.moveTo(X(d[i - 1]), T + PH); ctx.lineTo(X(d[i - 1]), Y(z[i - 1])); ctx.lineTo(X(d[i]), Y(z[i])); ctx.lineTo(X(d[i]), T + PH);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#e0a070'; ctx.lineWidth = 1.5;
    ctx.beginPath(); s.forEach((_, i) => (i ? ctx.lineTo(X(d[i]), Y(z[i])) : ctx.moveTo(X(d[i]), Y(z[i])))); ctx.stroke();

    // Waypoint ticks (end of each leg) and the point of no return.
    let acc = 0;
    route.legs.forEach((leg, i) => {
      acc += leg.distM;
      const x = X(Math.min(acc, total));
      const pnr = route.pnrIndex !== null && i === route.pnrIndex;
      ctx.strokeStyle = pnr ? '#ff4d4d' : 'rgba(77,255,136,0.5)';
      ctx.setLineDash(pnr ? [] : [2, 3]); ctx.lineWidth = pnr ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(x + 0.5, T); ctx.lineTo(x + 0.5, T + PH); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = pnr ? '#ff4d4d' : '#4dff88';
      ctx.fillText(pnr ? `${i + 1} · NO RETURN` : String(i + 1), x, T - 4);
    });

    // O₂ forecast line (right axis).
    ctx.strokeStyle = '#7fd7ff'; ctx.lineWidth = 2;
    ctx.beginPath();
    s.forEach((p, i) => { const y = YO(Math.max(0, p.state.o2Kg / full.o2Kg)); if (i) ctx.lineTo(X(d[i]), y); else ctx.moveTo(X(d[i]), y); });
    ctx.stroke();

    // Walking cursor.
    if (progress !== undefined && progress > 0) {
      const x = X(d[Math.min(progress, d.length - 1)]);
      ctx.strokeStyle = '#e8fff0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + PH); ctx.stroke();
    }

    // Titles.
    ctx.textAlign = 'left'; ctx.fillStyle = '#4dff88';
    ctx.font = 'bold 10px ui-monospace, Consolas, monospace';
    ctx.fillText('ROUTE PROFILE', L, 12);
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.fillStyle = '#5f7a66';
    ctx.fillText(title, L + 96, 12);
    // Legend inside the plot, top right.
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(7,11,8,0.75)'; ctx.fillRect(L + PW - 178, T + 2, 176, 14);
    ctx.fillStyle = '#7fd7ff'; ctx.fillText('— O₂ forecast (%)', L + PW - 4, T + 12);
    ctx.fillStyle = '#e0a070'; ctx.fillText('elevation (m) —', L + PW - 112, T + 12);
  }, [el, route, full, title, progress, w]);

  return (
    <div ref={wrapRef} style={{ width: '100%', height: H }}>
      <canvas ref={cvRef} style={{ width: w, height: H, display: 'block' }} />
    </div>
  );
}
