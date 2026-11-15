// Route replay for the end of the game (Map/Aiman): the path the astronaut really walked, recorded as a thinned
// breadcrumb trail, and the "camera rising" view used to replay it on the HiRISE map: it starts close over where
// the game ended and pulls back until the whole map is in frame, while the route draws itself from the start.
// Pure functions (no DOM): the drawing lives in RouteReplay.tsx (this file has another name: Windows ignores case).
import type { Pt } from './geo';

/** A breadcrumb is kept every this many metres (a 6 km walk is ~750 points). */
export const TRAIL_STEP_M = 8;
/** Upper bound on kept points; past it every other point is dropped, so long games still fit. */
export const TRAIL_MAX = 3000;

/** Add a position to the trail if it is far enough from the last kept point. Mutates and returns `trail`. */
export function trailAdd(trail: Pt[], p: Pt, stepM = TRAIL_STEP_M, max = TRAIL_MAX): Pt[] {
  const last = trail[trail.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < stepM) return trail;
  trail.push({ x: p.x, y: p.y });
  if (trail.length > max) {
    const keep = trail.filter((_, i) => i % 2 === 0 || i === trail.length - 1);
    trail.length = 0;
    trail.push(...keep);
  }
  return trail;
}

/** Total length of the trail, metres. */
export function trailLength(trail: Pt[]): number {
  let d = 0;
  for (let i = 1; i < trail.length; i++) d += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].y - trail[i - 1].y);
  return d;
}

/** The first `frac` (0..1) of the trail by distance, ending exactly at that point along the way. */
export function trailCut(trail: Pt[], frac: number): Pt[] {
  if (trail.length < 2 || frac >= 1) return trail.slice();
  if (frac <= 0) return trail.slice(0, 1);
  let left = trailLength(trail) * frac;
  const out: Pt[] = [trail[0]];
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= left) {
      const f = d > 0 ? left / d : 0;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      return out;
    }
    out.push(b);
    left -= d;
  }
  return out;
}

/** Seconds of the pull-back (the route draws during it); then the view holds on the whole map. */
export const REPLAY_S = 5.5;
/** Width of ground in view at the start, metres (close over the astronaut). */
export const START_VIEW_M = 260;

const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

/**
 * The view at replay time `t`: the map point at the centre of the frame and metres per screen pixel.
 * It starts START_VIEW_M wide centred on `end` and eases out to fit the whole `area` (zoom is interpolated in log
 * space, so the rise feels steady, like a camera climbing); the centre slides to the middle of the map.
 */
export function replayView(t: number, end: Pt, area: { widthM: number; heightM: number }, viewW: number, viewH: number) {
  const f = ease(t / REPLAY_S);
  const fit = Math.max(area.widthM / viewW, area.heightM / viewH);
  const near = START_VIEW_M / viewW;
  const mPerPx = Math.exp(Math.log(near) + (Math.log(fit) - Math.log(near)) * f);
  const mid = { x: area.widthM / 2, y: area.heightM / 2 };
  return { cx: end.x + (mid.x - end.x) * f, cy: end.y + (mid.y - end.y) * f, mPerPx, f };
}
