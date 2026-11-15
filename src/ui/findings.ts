import type { Pt } from '../map';

/**
 * Act 5 of docs/STORY.md: while waiting for help, the astronaut learns how people could live on Mars. Each finding is a
 * short journal card, unlocked by doing something in the game, and each one cites the data it rests on.
 * Pure: no React, no DOM.
 */
export type FindingId = 'air' | 'build' | 'storm' | 'cold' | 'lake' | 'cache';

export interface Finding {
  id: FindingId;
  title: string;
  /** What the player did to unlock it (shown while it is still locked). */
  how: string;
  /** The finding itself, in plain words. */
  text: string;
  /** Where the numbers come from. */
  source: string;
}

export const FINDINGS: readonly Finding[] = [
  {
    id: 'air', title: 'Air from the air', how: 'Refill the suit with oxygen.',
    text: 'Mars air is 95% CO₂. MOXIE on Perseverance split it into oxygen: 122 g in total, at 6–12 g an hour for about 300 W. '
      + 'One person breathes about 0.84 kg a day, so one unit covers only a fraction. An outpost needs a bigger plant and steady power.',
    source: 'reference.json: hardware.moxieO2GramsPerHour, human.o2KgPerDay; MOXIE total from NASA (proposal §4)',
  },
  {
    id: 'build', title: 'Where to build', how: 'Shelter under a rock overhang.',
    text: 'Rock holds heat. Jezero bedrock has a thermal inertia near 605, dune sand about 180, so rock stays warmer through the night '
      + 'and gives firm footing. Build against bedrock, not on sand.',
    source: 'reference.json: designValues.softSandThermalInertia (MEDA, Martinez et al. 2023)',
  },
  {
    id: 'storm', title: 'Power through a storm', how: 'Outlast a dust storm.',
    text: 'In a dust storm the sky turns brown and solar panels lose most of their light for days. Perseverance runs on a nuclear '
      + 'source (MMRTG, about 110 W) day and night. An outpost needs power that does not depend on the Sun.',
    source: 'dust.json (Mastcam-Z tau record), sunlight.json; reference.json: hardware.perseveranceMmrtgW',
  },
  {
    id: 'cold', title: 'The cold', how: 'Get through a night below −70 °C.',
    text: 'Jezero nights measured by MEDA: median low −75 °C, coldest −84 °C. Daytime highs reach about −15 °C. Heating, not oxygen, '
      + 'is the biggest power cost of staying alive at night.',
    source: 'reference.json: jezeroMeasured.airTempC (Perseverance MEDA)',
  },
  {
    id: 'lake', title: 'Signs of an old lake', how: 'Reach the science target, Wildcat Ridge.',
    text: 'Jezero was a lake about 3.5 billion years ago. At Wildcat Ridge, Perseverance found organic molecules in fine mudstone laid '
      + 'down in that lake: the kind of rock where signs of past life would keep best.',
    source: 'content.json: scienceTarget (sample_12, Wildcat Ridge); pois.json',
  },
  {
    id: 'cache', title: 'The sample cache', how: 'Secure the tubes at Three Forks.',
    text: 'Perseverance left 10 sealed tubes at Three Forks between sol 653 and 690 as a backup for a future sample return. '
      + 'Carrying them home brings Mars rock to Earth labs years early.',
    source: 'pois.json: three_forks_depot',
  },
];

/** How close (m) to the science target counts as reaching it. */
export const LAKE_REACH_M = 30;
/** A night this cold (°C) unlocks "The cold". */
export const COLD_C = -70;
/** The salvage site that holds the tubes. */
export const CACHE_SITE = 'three_forks_depot';

/** What the game saw this frame, for unlocking findings. */
export interface FindingSignals {
  /** The suit took on O₂ this frame (a supply, the ship or the rover). */
  o2Refilled?: boolean;
  /** Standing under a rock overhang. */
  underCover?: boolean;
  /** A dust storm just ended with the astronaut alive. */
  stormOver?: boolean;
  /** Air temperature now, °C. */
  tempC?: number;
  /** Where the astronaut is, and where the science target is. */
  pos?: Pt | null;
  lakeAt?: Pt | null;
  /** NASA sites salvaged so far. */
  salvaged?: readonly string[];
}

/** The findings unlocked by these signals that are not in `have` yet, in journal order. */
export function newFindings(have: readonly FindingId[], s: FindingSignals): FindingId[] {
  const hit: Record<FindingId, boolean> = {
    air: !!s.o2Refilled,
    build: !!s.underCover,
    storm: !!s.stormOver,
    cold: typeof s.tempC === 'number' && s.tempC <= COLD_C,
    lake: !!s.pos && !!s.lakeAt && Math.hypot(s.pos.x - s.lakeAt.x, s.pos.y - s.lakeAt.y) <= LAKE_REACH_M,
    cache: !!s.salvaged?.includes(CACHE_SITE),
  };
  return FINDINGS.map((f) => f.id).filter((id) => hit[id] && !have.includes(id));
}

export const findingById = (id: FindingId) => FINDINGS.find((f) => f.id === id)!;

/** The take-home report: what the astronaut brings back for the next mission. */
export interface TakeHome {
  /** Metres walked on Mars. */
  walkedM: number;
  /** Suit O₂ breathed, kg. */
  o2UsedKg: number;
  findings: number;
  of: number;
  /** Sample tubes carried home (0 or 10). */
  tubes: number;
  /** Real NASA sites visited (salvaged or reached). */
  sites: number;
}

export function takeHome(stats: { walkedM: number; o2UsedKg: number }, have: readonly FindingId[], salvaged: readonly string[]): TakeHome {
  return {
    walkedM: Math.round(stats.walkedM),
    o2UsedKg: Math.round(stats.o2UsedKg * 100) / 100,
    findings: have.length,
    of: FINDINGS.length,
    tubes: salvaged.includes(CACHE_SITE) ? 10 : 0,
    sites: salvaged.length,
  };
}
