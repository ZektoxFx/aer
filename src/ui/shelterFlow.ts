import type { Activity, Shelter, SuitState } from '../sim/types';

export type ShelterChoiceId = 'cabin' | 'wreck' | 'build' | 'search';

export interface ShelterChoice {
  id: ShelterChoiceId;
  label: string;
  benefit: string;
  cost: string;
  /** Game minutes before the astronaut is under cover. Placeholder design values until Map gives real distances. */
  travelMin: number;
  /** What the astronaut does while getting there. */
  travel: Activity;
  /** Where they wait out the storm. 'none' = still outside. */
  shelter: Shelter;
}

const REST: Activity = { speedMS: 0, slopeDeg: 0, loadKg: 0 };

/** The four storm choices from the proposal §6.3. Travel times are design values to tune [verify]. */
export const SHELTER_CHOICES: ShelterChoice[] = [
  { id: 'cabin', label: 'RUN FOR THE CABIN', benefit: 'Best shelter, stored supplies', cost: 'Hard run burns O₂ and builds heat',
    travelMin: 60, travel: { speedMS: 2, slopeDeg: 0, loadKg: 10 }, shelter: 'cabin' },
  { id: 'wreck', label: 'REACH THE WRECK', benefit: 'Closer, scrap on site', cost: 'Weaker shelter',
    travelMin: 20, travel: { speedMS: 1, slopeDeg: 0, loadKg: 10 }, shelter: 'wreck' },
  // Building is modeled as steady work at about a slow walk's effort (design value).
  { id: 'build', label: 'BUILD A SHELTER HERE', benefit: 'Works anywhere', cost: 'Needs metal and fabric, plus build time',
    travelMin: 30, travel: { speedMS: 0.5, slopeDeg: 0, loadKg: 10 }, shelter: 'builtShelter' },
  { id: 'search', label: 'KEEP SEARCHING', benefit: 'Might reach the rover first', cost: 'Near-blind, tracks erased, no charging',
    travelMin: 0, travel: { speedMS: 1, slopeDeg: 0, loadKg: 10 }, shelter: 'none' },
];

/** One storm's shelter decision, from choosing until the summary is dismissed. */
export interface ShelterFlow {
  choice: ShelterChoice;
  chosenAtMin: number;
  arrived: boolean;
  start: SuitState;
  minCoreTempC: number;
  maxCoreTempC: number;
}

export function chooseShelter(choice: ShelterChoice, clockMin: number, suit: SuitState): ShelterFlow {
  return {
    choice, chosenAtMin: clockMin, arrived: choice.travelMin === 0, start: suit,
    minCoreTempC: suit.coreTempC, maxCoreTempC: suit.coreTempC,
  };
}

/** Activity and shelter the suit should have right now in this flow. */
export function flowPosture(flow: ShelterFlow): { activity: Activity; shelter: Shelter } {
  if (!flow.arrived) return { activity: flow.choice.travel, shelter: 'none' };
  // Keep searching = keep walking outside; everyone else rests under cover.
  return flow.choice.id === 'search' ? { activity: flow.choice.travel, shelter: 'none' } : { activity: REST, shelter: flow.choice.shelter };
}

/** Advance the flow to this moment: marks arrival and tracks the core temperature extremes. */
export function updateFlow(flow: ShelterFlow, clockMin: number, suit: SuitState): ShelterFlow {
  return {
    ...flow,
    arrived: flow.arrived || clockMin - flow.chosenAtMin >= flow.choice.travelMin,
    minCoreTempC: Math.min(flow.minCoreTempC, suit.coreTempC),
    maxCoreTempC: Math.max(flow.maxCoreTempC, suit.coreTempC),
  };
}

export interface ShelterSummary {
  label: string;
  hours: number;
  o2UsedG: number;
  waterUsedKg: number;
  batteryUsedWh: number;
  minCoreTempC: number;
  maxCoreTempC: number;
}

/** What the storm cost, for the card shown once it clears. */
export function summarize(flow: ShelterFlow, clockMin: number, suit: SuitState): ShelterSummary {
  return {
    label: flow.choice.label,
    hours: (clockMin - flow.chosenAtMin) / 60,
    o2UsedG: (flow.start.o2Kg - suit.o2Kg) * 1000,
    waterUsedKg: flow.start.waterKg - suit.waterKg,
    batteryUsedWh: flow.start.batteryWh - suit.batteryWh,
    minCoreTempC: flow.minCoreTempC,
    maxCoreTempC: flow.maxCoreTempC,
  };
}
