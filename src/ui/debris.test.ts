import { describe, expect, it } from 'vitest';
import contentJson from '../../public/data/content.json';
import type { ContentFile } from '../data/files';
import { debrisItems } from './debris';
import { EMPTY_PACK, packEntryFor, pickUp } from './inventory';
import { STORAGE_ROOM_ID, STORAGE_ROOM_JOB, SUIT_PATCH_JOB } from './ship';

const content = contentJson as unknown as ContentFile;
const base = { x: 3060, y: 2170 };
const area = { widthM: 6400, heightM: 4000 };

describe("AER-1's scattered parts", () => {
  const items = debrisItems(base, area);
  it('lie behind the lander along the crash path, within a short walk', () => {
    for (const it of items) {
      const d = Math.hypot(it.at.x - base.x, it.at.y - base.y);
      expect(d).toBeGreaterThan(30);
      expect(d).toBeLessThan(400);
      expect(it.at.x).toBeLessThan(base.x); // behind = west of the lander
    }
  });
  it('break down into enough material for the storage room and the suit patch', () => {
    const got: Record<string, number> = {};
    for (const it of items) for (const [m, kg] of Object.entries(packEntryFor(it, content).yields ?? {})) got[m] = (got[m] ?? 0) + kg;
    for (const job of [STORAGE_ROOM_JOB, SUIT_PATCH_JOB]) for (const [m, kg] of Object.entries(job.materials)) expect(got[m] ?? 0).toBeGreaterThanOrEqual(kg);
    expect(got.metal).toBeGreaterThanOrEqual(STORAGE_ROOM_JOB.materials.metal + 6); // and the hull repair
  });
  it('include the storage-room blueprint, which weighs nothing and can be picked up', () => {
    const bp = items.find((i) => i.id === `blueprint:${STORAGE_ROOM_ID}`)!;
    const entry = packEntryFor(bp, content);
    expect(entry.blueprint).toBe(STORAGE_ROOM_ID);
    expect(entry.massKg).toBe(0);
    expect(pickUp(EMPTY_PACK, bp, content).ok).toBe(true);
    expect(packEntryFor(items[0], content).name).toMatch(/^AER-1/);
  });
});
