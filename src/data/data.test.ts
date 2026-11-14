import { describe, expect, it } from 'vitest';
import creditsRaw from '../../public/data/credits.json?raw';
import contentRaw from '../../public/data/content.json?raw';
import dustRaw from '../../public/data/dust.json?raw';
import devilsRaw from '../../public/data/dustdevils.json?raw';
import packRaw from '../../public/data/jezero_pack.json?raw';
import layersRaw from '../../public/data/layers_20m.json?raw';
import poisRaw from '../../public/data/pois.json?raw';
import referenceRaw from '../../public/data/reference.json?raw';
import relayRaw from '../../public/data/relay.json?raw';
import sunRaw from '../../public/data/sunlight.json?raw';
import patchRaw from '../../public/data/terrain_patch_2m.json?raw';
import weatherRaw from '../../public/data/weather.json?raw';
import type {
  ContentFile, CreditsFile, DustDevilFile, DustFile, PoiFile, RelayFile, SunlightTable, TerrainLayers, TerrainPatchMeta, WeatherFile,
} from './files';
import { distanceFactor, solarWm2, sunElevationDeg } from './sunlight';
import { decodeTerrainPatch, patchHeightAt } from './terrainPatch';
import type { DataPack } from './types';

const raw: Record<string, string> = {
  'content.json': contentRaw, 'credits.json': creditsRaw, 'dust.json': dustRaw, 'dustdevils.json': devilsRaw, 'jezero_pack.json': packRaw, 'layers_20m.json': layersRaw,
  'pois.json': poisRaw, 'reference.json': referenceRaw, 'relay.json': relayRaw, 'sunlight.json': sunRaw, 'terrain_patch_2m.json': patchRaw, 'weather.json': weatherRaw,
};
const load = <T>(name: string): T => JSON.parse(raw[name]) as T;

const pack = load<DataPack>('jezero_pack.json');
const sun = load<SunlightTable>('sunlight.json');

describe('baked data pack', () => {
  it('elevation grid matches its size and covers the area', () => {
    const e = pack.elevation;
    expect(e.heightsM).toHaveLength(e.cols * e.rows);
    expect(e.cols * e.cellM).toBe(pack.area.widthM);
    expect(e.rows * e.cellM).toBe(pack.area.heightM);
    expect(e.heightsM.every((h) => h > -2700 && h < -2400)).toBe(true);
  });

  it('landing site height matches the rover record (-2569.9 m)', () => {
    const e = pack.elevation;
    const col = Math.floor((0 - pack.area.eMin!) / e.cellM);
    const row = Math.floor((pack.area.nMax! - 0) / e.cellM);
    expect(e.heightsM[row * e.cols + col]).toBeCloseTo(-2569.9, 0);
  });

  it('every scenario sol is real MEDA weather', () => {
    const weather = load<WeatherFile>('weather.json');
    for (const s of pack.sols) {
      const w = weather.sols.find((x) => x.sol === s.sol);
      expect(w, `sol ${s.sol}`).toBeDefined();
      expect(s.pressureKPa).toBeCloseTo(w!.pressurePa![1] / 1000, 3);
    }
  });

  it('layers and POIs line up with the map', () => {
    const layers = load<TerrainLayers>('layers_20m.json');
    expect(layers.cols * layers.cellM).toBe(pack.area.widthM);
    expect(layers.terrainClass).toHaveLength(layers.cols * layers.rows);
    const pois = load<PoiFile>('pois.json');
    for (const p of pois.pois) {
      expect(p.xM).toBeGreaterThanOrEqual(0);
      expect(p.xM).toBeLessThanOrEqual(pack.area.widthM);
      expect(p.yM).toBeGreaterThanOrEqual(0);
      expect(p.yM).toBeLessThanOrEqual(pack.area.heightM);
    }
  });

  it('the 2022 storm peaks at sol 316', () => {
    const dust = load<DustFile>('dust.json');
    const peak = dust.jezeroStorm2022.daily.reduce((a, b) => ((b.tau ?? 0) > (a.tau ?? 0) ? b : a));
    expect(peak.sol).toBe(316);
  });
});

describe('sunlight', () => {
  it('matches the NASA table for overhead sun at tau 0.5 (~0.9 of 590 W/m²)', () => {
    expect(solarWm2(sun, 0.5, 90)).toBeGreaterThan(500);
    expect(solarWm2(sun, 0.5, 90)).toBeLessThan(560);
  });

  it('drops with dust and is zero at night', () => {
    expect(solarWm2(sun, 3, 60)).toBeLessThan(solarWm2(sun, 0.5, 60));
    expect(solarWm2(sun, 0.5, -5)).toBe(0);
  });

  it('is stronger near perihelion (Ls 251) than aphelion (Ls 71)', () => {
    expect(distanceFactor(251)).toBeGreaterThan(1.15);
    expect(distanceFactor(71)).toBeLessThan(0.85);
  });

  it('puts the noon sun high at Jezero in northern summer', () => {
    expect(sunElevationDeg(18.4, 90, 12)).toBeCloseTo(90 - (25.19 - 18.4), 1);
  });
});

describe('game content', () => {
  const content = load<ContentFile>('content.json');
  const materials = new Set(content.materials.map((m) => m.id));
  const recipes = new Set(content.recipes.map((r) => r.id));

  it('recipes and rocket pieces only use known materials', () => {
    for (const r of content.recipes) for (const m of Object.keys(r.needs)) expect(materials, `${r.id}: ${m}`).toContain(m);
    for (const p of content.rocketPieces) for (const m of Object.keys(p.yields)) expect(materials, `${p.id}: ${m}`).toContain(m);
  });

  it('every manual build has a page, and every page unlocks a real build', () => {
    const pages = pack.fieldManualPages ?? [];
    for (const r of content.recipes.filter((x) => x.knowledge !== 'training')) {
      const page = pages.find((p) => p.pageNumber === r.manualPage);
      expect(page?.unlocksRecipe, r.id).toBe(r.id);
    }
    for (const p of pages) if (p.unlocksRecipe) expect(recipes).toContain(p.unlocksRecipe);
  });

  it('the rover comms link (needed to win) cannot be improvised', () => {
    expect(content.recipes.find((r) => r.id === 'rover_comms_link')?.knowledge).toBe('manual_required');
  });

  it('history cards and the science target point at real map places', () => {
    const ids = new Set(load<PoiFile>('pois.json').pois.map((p) => p.id));
    for (const h of content.historyCards) expect(ids, h.title).toContain(h.poiId);
    expect(ids).toContain(content.scienceTarget.poiId);
  });
});

describe('rocks and credits', () => {
  it('rock oxides are only given where a source is named', () => {
    for (const r of pack.rockFormations ?? []) {
      if (Object.keys(r.elementsOxidesWtPercent).length > 0) expect(r.description, r.id).toMatch(/Source: /);
    }
  });

  it('Séítah is far richer in magnesium than Máaz (Wiens et al. 2022)', () => {
    const rock = (id: string) => pack.rockFormations!.find((r) => r.id === id)!.elementsOxidesWtPercent;
    expect(rock('formation-seitah').MgO).toBeGreaterThan(5 * rock('formation-maaz').MgO);
  });

  it('credits name every data source, and every chart label says archived or names its model', () => {
    const credits = load<CreditsFile>('credits.json');
    expect(credits.dataSources.length).toBeGreaterThanOrEqual(8);
    for (const s of credits.dataSources) expect(s.citation.length, s.what).toBeGreaterThan(5);
    for (const [k, v] of Object.entries(credits.chartLabels)) {
      if (k !== 'map' && k !== 'sunlight') expect(v, k).toMatch(/sol \{sol\} \(archived\)/);
    }
  });
});

describe('scenario weather', () => {
  it('no scenario sol reports 0 m/s wind (missing wind is filled and noted, never shown as calm air)', () => {
    for (const s of pack.sols) {
      expect(s.windMS, `sol ${s.sol}`).toBeGreaterThan(0);
      if (/No wind data this sol/.test(s.notes ?? '')) expect(s.windMS).toBeCloseTo(3.3, 1);
    }
  });
});

describe('cited values', () => {
  it('no data file still carries a [verify] tag or an open verify flag', () => {
    for (const [name, text] of Object.entries(raw)) {
      expect(text, name).not.toMatch(/\[verify/);
      expect(text, name).not.toMatch(/"verify":\s*true/);
    }
  });

  it('the sunlight table uses the MEDA-measured Jezero albedo', () => {
    const ref = load<{ jezeroMeasured: { surfaceAlbedo: { value: number; noonRange: [number, number] } } }>('reference.json');
    const a = ref.jezeroMeasured.surfaceAlbedo;
    expect(sun.albedo).toBe(a.value);
    expect(a.value).toBeGreaterThanOrEqual(a.noonRange[0]);
    expect(a.value).toBeLessThanOrEqual(a.noonRange[1]);
  });
});

describe('terrain tile, relay passes and dust devils', () => {
  const meta = load<TerrainPatchMeta>('terrain_patch_2m.json');

  it('the 2 m tile agrees with the 10 m grid and is centred on the AER-1 cabin', async () => {
    // Read the binary from disk (Node, test only). The string specifier keeps node types out of the app build.
    const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as { readFileSync(p: URL): Uint8Array };
    const u8 = fs.readFileSync(new URL('../../public/data/terrain_patch_2m.bin', import.meta.url));
    const patch = decodeTerrainPatch(meta, u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer);
    const e = pack.elevation;
    const cab = pack.crashedLander!.cabinLocation;
    expect(meta.centre.eastM).toBe(cab.eastingM);
    // Compare 5 x 5 blocks with 10 m cells over the whole tile.
    let worst = 0;
    for (let r = 0; r < meta.rows / 5; r++) {
      for (let c = 0; c < meta.cols / 5; c++) {
        let sum = 0;
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) sum += patch.heightsM[(r * 5 + i) * meta.cols + c * 5 + j];
        const ref = e.heightsM[(meta.y0M / 10 + r) * e.cols + meta.x0M / 10 + c];
        worst = Math.max(worst, Math.abs(sum / 25 - ref));
      }
    }
    expect(worst).toBeLessThan(0.1);
    // The landing site (3700, 2400) is inside the tile and matches the rover's recorded height.
    expect(patchHeightAt(patch, 3700, 2400)).toBeCloseTo(-2569.9, 0);
    expect(patchHeightAt(patch, 0, 0)).toBeNull();
  });

  it('relay windows use the handbook node times and leave MAVEN out', () => {
    const relay = load<RelayFile>('relay.json');
    const nodes = new Map(relay.orbiters.map((o) => [o.id, o.nodesLMST]));
    expect(nodes.get('MRO')).toEqual(['15:09', '03:09']);
    expect(nodes.get('ODY')).toEqual(['06:11', '18:11']);
    expect(relay.orbiters.some((o) => o.id === 'MAVEN')).toBe(false);
    for (const w of relay.gameWindowsLTST.windows) {
      const [h, m] = w.centre.split(':').map(Number);
      expect((w.fromHour + w.toHour) / 2).toBeCloseTo(h + m / 60, 1);
    }
  });

  it('dust devils: 309 real encounters, 4.9 per sol, peak at noon matching the published 1.5 per hour', () => {
    const dd = load<DustDevilFile>('dustdevils.json');
    expect(dd.hourlyLTST).toHaveLength(24);
    expect(dd.hourlyLTST.reduce((a, h) => a + h.vortices, 0)).toBe(309);
    expect(dd.hourlyLTST.reduce((a, h) => a + h.expectedPerSol, 0)).toBeCloseTo(dd.perSol, 1);
    const peak = dd.hourlyLTST.reduce((a, h) => (h.expectedPerSol > a.expectedPerSol ? h : a));
    expect(peak.hour).toBe(12);
    expect(Math.abs(peak.expectedPerSol - dd.peakPerHourNoon)).toBeLessThan(0.2);
    expect(dd.hourlyLTST.filter((h) => h.hour < 8 || h.hour >= 20).every((h) => h.vortices === 0)).toBe(true);
  });
});
