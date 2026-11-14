import { describe, expect, it } from 'vitest';
import type { Elevation } from './geo';
import { HAZARD_EFFECT, SLOPE_BLOCKED, type HazardZone, type MapItem } from './layout';
import type { RangeField } from './pathfind';
import { groundStep, itemsInView, returnStatus } from './world';

// A 10 x 10 grid of 10 m cells, and a soft-sand square in its north-west corner.
const el: Elevation = { cols: 10, rows: 10, cellM: 10, heightsM: new Array(100).fill(0) };
const sand: HazardZone = {
  id: 'sand-test', kind: 'sand', label: 'Soft sand',
  poly: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }],
  speedFactor: HAZARD_EFFECT.sand.speedFactor, extraSlopeDeg: HAZARD_EFFECT.sand.extraSlopeDeg,
};

describe('3D free-walking rules (same as the route planner)', () => {
  it('slows walking and adds effort in soft sand, not on open ground', () => {
    const inSand = groundStep([sand], { x: 20, y: 20 }, 3);
    expect(inSand.speedFactor).toBe(HAZARD_EFFECT.sand.speedFactor);
    expect(inSand.effortSlopeDeg).toBe(3 + HAZARD_EFFECT.sand.extraSlopeDeg);
    expect(inSand.zone?.id).toBe('sand-test');
    const open = groundStep([sand], { x: 80, y: 80 }, 3);
    expect(open).toMatchObject({ blocked: false, speedFactor: 1, effortSlopeDeg: 3 });
  });

  it('blocks slopes steeper than the planner allows, uphill or down', () => {
    expect(groundStep([], { x: 80, y: 80 }, SLOPE_BLOCKED + 1)).toMatchObject({ blocked: true, speedFactor: 0 });
    expect(groundStep([], { x: 80, y: 80 }, -(SLOPE_BLOCKED + 1)).blocked).toBe(true);
    expect(groundStep([], { x: 80, y: 80 }, SLOPE_BLOCKED).blocked).toBe(false);
  });

  it('reads the green / amber lines: safe, one-way, out of reach', () => {
    const range: RangeField = { safe: new Float32Array(100).fill(-Infinity), reach: new Float32Array(100).fill(-Infinity) };
    range.safe[0] = 0.4; range.reach[0] = 0.7;   // cell (0,0): home with 40% left
    range.safe[1] = 0.05; range.reach[1] = 0.3;  // cell (1,0): can get there, not back with the 10% reserve
    expect(returnStatus(range, el, { x: 5, y: 5 }, 0.1)).toBe('safe');
    expect(returnStatus(range, el, { x: 15, y: 5 }, 0.1)).toBe('one-way');
    expect(returnStatus(range, el, { x: 95, y: 95 }, 0.1)).toBe('out');
    expect(returnStatus(null, el, { x: 5, y: 5 }, 0.1)).toBe('unknown');
  });

  it('shows hidden items only once seen or within sight', () => {
    const items: MapItem[] = [
      { id: 'a', kind: 'o2', label: 'A', at: { x: 10, y: 0 }, hidden: true },
      { id: 'b', kind: 'o2', label: 'B', at: { x: 500, y: 0 }, hidden: true },
      { id: 'c', kind: 'o2', label: 'C', at: { x: 900, y: 0 }, hidden: false },
      { id: 'd', kind: 'o2', label: 'D', at: { x: 800, y: 0 }, hidden: true },
    ];
    const seen = itemsInView({ items, found: new Set(['d']), sightM: 50 }, { x: 0, y: 0 }).map((i) => i.id);
    expect(seen).toEqual(['a', 'c', 'd']);
  });
});
