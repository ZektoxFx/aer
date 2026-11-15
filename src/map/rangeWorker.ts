/// <reference lib="webworker" />
import { rangeField, type Grid } from './pathfind';

// Map: the safe-return zone off the main thread. It walks the whole 640 × 400 grid twice (about 0.2-0.5 s), which
// froze the game every time the astronaut stopped; here it runs beside the game instead.
let grid: Grid | null = null;

self.onmessage = (e: MessageEvent) => {
  const d = e.data;
  if (d.grid) { grid = d.grid as Grid; return; }
  if (!grid) return;
  const r = rangeField(grid, d.model, d.at, d.base, d.suit);
  (self as unknown as Worker).postMessage({ id: d.id, safe: r.safe, reach: r.reach }, [r.safe.buffer, r.reach.buffer]);
};
