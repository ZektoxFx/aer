import type { DustDevilFile, SunlightTable, WeatherFile } from '../data/files';
import type { DataPack, SolWeather } from '../data/types';
import type { GameState } from '../sim/types';

/** Everything the UI reads from public/data. */
export interface GameData {
  pack: DataPack;
  sunlight: SunlightTable | null;
  weather: WeatherFile | null;
  /** MEDA dust-devil timing and size (Data role's dustdevils.json); optional. */
  devils?: DustDevilFile | null;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/**
 * Loads the baked NASA Jezero pack. Sunlight and weather are extras: without them the sim falls back
 * to its built-in sun shortcut, so a failure there doesn't block the game.
 */
export async function loadGameData(): Promise<GameData> {
  const [pack, sunlight, weather, devils] = await Promise.all([
    getJson<DataPack>('/data/jezero_pack.json'),
    getJson<SunlightTable>('/data/sunlight.json').catch(() => null),
    getJson<WeatherFile>('/data/weather.json').catch(() => null),
    getJson<DustDevilFile>('/data/dustdevils.json').catch(() => null),
  ]);
  return { pack, sunlight, weather, devils };
}

/** NASA sun position and sunlight for this sol's season, or undefined when the data isn't there. */
export function skyFor(data: GameData, sol: SolWeather): GameState['sky'] {
  const ls = data.weather?.sols.find((w) => w.sol === sol.sol)?.ls;
  if (!data.sunlight || ls === undefined) return undefined;
  return { table: data.sunlight, latDeg: data.sunlight.sunElevation.jezeroLatDeg, lsDeg: ls };
}

/**
 * Short chart caption naming mission, instrument and sol (team rule). The pack's full `source`
 * string is long, so real data gets the short form; fake data keeps its own label.
 */
export function dataCaption(pack: DataPack, sol: SolWeather): string {
  if (pack.source.startsWith('FAKE')) return `Simulated suit · inputs: ${pack.source} · Sol ${sol.sol}`;
  return `Simulated suit · weather: Perseverance MEDA · dust τ: Perseverance Mastcam-Z · archived Sol ${sol.sol}`;
}
