import { describe, expect, it } from 'vitest';
import { CACHE_SITE, COLD_C, FINDINGS, LAKE_REACH_M, newFindings, takeHome } from './findings';

describe('findings journal', () => {
  it('has six findings, each with a source', () => {
    expect(FINDINGS).toHaveLength(6);
    for (const f of FINDINGS) expect(f.source.length).toBeGreaterThan(5);
  });

  it('unlocks nothing without a signal', () => {
    expect(newFindings([], {})).toEqual([]);
  });

  it('unlocks each finding from its own signal', () => {
    expect(newFindings([], { o2Refilled: true })).toEqual(['air']);
    expect(newFindings([], { underCover: true })).toEqual(['build']);
    expect(newFindings([], { stormOver: true })).toEqual(['storm']);
    expect(newFindings([], { tempC: COLD_C })).toEqual(['cold']);
    expect(newFindings([], { tempC: COLD_C + 1 })).toEqual([]);
    expect(newFindings([], { salvaged: [CACHE_SITE] })).toEqual(['cache']);
  });

  it('unlocks the lake only within reach of the science target', () => {
    const lakeAt = { x: 100, y: 100 };
    expect(newFindings([], { pos: { x: 100 + LAKE_REACH_M, y: 100 }, lakeAt })).toEqual(['lake']);
    expect(newFindings([], { pos: { x: 100 + LAKE_REACH_M + 1, y: 100 }, lakeAt })).toEqual([]);
    expect(newFindings([], { pos: { x: 0, y: 0 }, lakeAt: null })).toEqual([]);
  });

  it('never repeats a finding already in the journal', () => {
    expect(newFindings(['air'], { o2Refilled: true, underCover: true })).toEqual(['build']);
  });
});

describe('take-home report', () => {
  it('counts the tubes only when the cache was secured', () => {
    expect(takeHome({ walkedM: 1234.4, o2UsedKg: 0.4567 }, ['air'], []).tubes).toBe(0);
    const r = takeHome({ walkedM: 1234.4, o2UsedKg: 0.4567 }, ['air', 'cache'], [CACHE_SITE, 'heat_shield']);
    expect(r).toEqual({ walkedM: 1234, o2UsedKg: 0.46, findings: 2, of: 6, tubes: 10, sites: 2 });
  });
});
