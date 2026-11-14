import type { SuitState } from '../sim/types';
import type { Pt } from './geo';
import { rangeField, type Grid, type RangeField, type WalkModel } from './pathfind';

/**
 * The safe-return zone, computed in a Web Worker so the game never freezes while it updates. Falls back to
 * computing it here (same result) where workers are not available, such as in tests.
 */
interface Job { grid: Grid; model: WalkModel; at: Pt; base: Pt; suit: SuitState; done: (r: RangeField) => void }

let worker: Worker | null | undefined;
let sentGrid: Grid | null = null;
let nextId = 0;
const waiting = new Map<number, Job>();

function fallBack() {
  worker = null;
  for (const j of waiting.values()) j.done(rangeField(j.grid, j.model, j.at, j.base, j.suit));
  waiting.clear();
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./rangeWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  worker?.addEventListener('message', (e: MessageEvent) => {
    const j = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    j?.done({ safe: e.data.safe, reach: e.data.reach });
  });
  worker?.addEventListener('error', fallBack);
  return worker;
}

export function rangeFieldAsync(grid: Grid, model: WalkModel, at: Pt, base: Pt, suit: SuitState): Promise<RangeField> {
  const w = getWorker();
  if (!w) return Promise.resolve(rangeField(grid, model, at, base, suit));
  if (sentGrid !== grid) { w.postMessage({ grid }); sentGrid = grid; }
  const id = ++nextId;
  return new Promise((done) => {
    waiting.set(id, { grid, model, at, base, suit, done });
    w.postMessage({ id, model, at, base, suit });
  });
}
