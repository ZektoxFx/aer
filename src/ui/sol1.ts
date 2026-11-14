import type { Activity, Forecast, Shelter, SuitState } from '../sim/types';

// Sol 1: Scrubber Saturation (proposal §6.2). Plan → commit → triage → diagnose → recover.
// All times, loads and amounts here are design values for pacing until Map gives real distances [verify].

/** LiOH left in the canister after the crash (≈2 h of walking; the submission's "about 2 hours"). */
export const SOL1_START_LIOH_KG = 0.25;
/** A fresh spare canister from the supply crate. */
export const SPARE_LIOH_KG = 0.25;
/** The alarm fires when the scrubber forecast drops below this, before CO₂ starts climbing. */
export const SCRUBBER_ALARM_MIN = 20;

const WALK_OUT_MIN = 40;
const SALVAGE_MIN = 20;
const WALK_BACK_MIN = 40;
const PIECE_KG = 10;
export const SLOW_PACE = 0.6; // fraction of normal progress per game minute when slowed down

export const PIECES = [
  { name: 'Hull panel', note: 'Aluminium skin for builds' },
  { name: 'Supply crate', note: 'Contains a spare LiOH canister' },
  { name: 'Antenna mast', note: 'Metal tube and cable' },
] as const;

export type Sol1Phase = 'briefing' | 'walkOut' | 'salvage' | 'walkBack' | 'won' | 'survived' | 'lost';
/** none → diagnose (pick a cause) → recover (pick an action) → done (actions stay available). */
export type AlarmStage = 'none' | 'diagnose' | 'recover' | 'done';

export const CAUSES = [
  { id: 'canister', label: 'SATURATED CANISTER', correct: true,
    why: 'Right: the LiOH is nearly used up. Every breath adds CO₂ and only the scrubber removes it.' },
  { id: 'fan', label: 'FAILED FAN', correct: false,
    why: 'Not this time: the fan is running normally. The scrubber itself is almost out of LiOH.' },
  { id: 'exertion', label: 'OVEREXERTION', correct: false,
    why: 'Part of it: hard work makes more CO₂, but the root cause is a canister that is almost used up.' },
] as const;
export type CauseId = (typeof CAUSES)[number]['id'];

export type ActionId = 'slow' | 'swap' | 'abort' | 'breathe';

export const BREATHE_HARDER_WHY =
  'Breathing harder does not help. Your lungs can never push CO₂ below the level in the gas you inhale, ' +
  'and the extra effort makes more CO₂. Slowing down is what helps.';

export interface Sol1State {
  phase: Sol1Phase;
  /** Progress through the current phase, in normal-pace minutes. */
  progressMin: number;
  lastClockMin: number;
  startClockMin: number;
  piecesSalvaged: number;
  slow: boolean;
  spareUsed: boolean;
  alarm: AlarmStage;
  diagnosis: CauseId | null;
  trapPicked: boolean;
  lostReason: string | null;
}

export function sol1Start(clockMin: number): Sol1State {
  return {
    phase: 'briefing', progressMin: 0, lastClockMin: clockMin, startClockMin: clockMin, piecesSalvaged: 0,
    slow: false, spareUsed: false, alarm: 'none', diagnosis: null, trapPicked: false, lostReason: null,
  };
}

/** Leave the briefing and start walking to the debris field. */
export function sol1Begin(s: Sol1State, clockMin: number): Sol1State {
  return { ...s, phase: 'walkOut', progressMin: 0, lastClockMin: clockMin, startClockMin: clockMin };
}

export const isOver = (s: Sol1State) => s.phase === 'won' || s.phase === 'survived' || s.phase === 'lost';
/** The clock holds while the player reads the briefing or deals with the alarm. */
export const isHolding = (s: Sol1State) => s.phase === 'briefing' || s.alarm === 'diagnose' || s.alarm === 'recover';

function phaseLength(s: Sol1State): number {
  if (s.phase === 'walkOut') return WALK_OUT_MIN;
  if (s.phase === 'salvage') return SALVAGE_MIN;
  if (s.phase === 'walkBack') return WALK_BACK_MIN;
  return Infinity;
}

/** Minutes of normal-pace work left in the current phase. */
export function phaseMinLeft(s: Sol1State): number {
  return Math.max(0, phaseLength(s) - s.progressMin);
}

/** What the astronaut is doing right now. */
export function sol1Posture(s: Sol1State): { activity: Activity; shelter: Shelter } {
  const load = s.piecesSalvaged * PIECE_KG;
  const rest = { activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'cabin' as Shelter };
  switch (s.phase) {
    case 'walkOut':
      return { activity: { speedMS: s.slow ? 0.5 : 1, slopeDeg: 0, loadKg: 0 }, shelter: 'none' };
    case 'salvage':
      // Prying and lifting debris: modeled as hard walking effort while carrying what's already salvaged.
      return { activity: { speedMS: s.slow ? 0.8 : 1.5, slopeDeg: 0, loadKg: load + 10 }, shelter: 'none' };
    case 'walkBack':
      return { activity: { speedMS: s.slow ? 0.5 : 1, slopeDeg: 0, loadKg: load }, shelter: 'none' };
    default:
      return rest;
  }
}

/** Advance the scenario to `clockMin`: phase progress, the scrubber alarm, and win/lose. */
export function sol1Advance(s: Sol1State, clockMin: number, suit: SuitState, fc: Forecast): Sol1State {
  if (s.phase === 'briefing' || isOver(s)) return { ...s, lastClockMin: clockMin };
  if (suit.inspiredPCO2KPa > 8) return { ...s, phase: 'lost', lostReason: 'CO₂ above 8 kPa: you lost consciousness.' };
  if (suit.o2Kg <= 0) return { ...s, phase: 'lost', lostReason: 'Oxygen ran out.' };

  let next: Sol1State = { ...s, lastClockMin: clockMin };
  next.progressMin += (clockMin - s.lastClockMin) * (s.slow ? SLOW_PACE : 1);

  if (next.alarm === 'none' && (fc.scrubberMin < SCRUBBER_ALARM_MIN || suit.inspiredPCO2KPa > 1)) {
    next.alarm = 'diagnose';
  }

  if (next.progressMin >= phaseLength(next)) {
    if (next.phase === 'walkOut') next = { ...next, phase: 'salvage', progressMin: 0 };
    else if (next.phase === 'salvage') {
      const pieces = next.piecesSalvaged + 1;
      next = { ...next, piecesSalvaged: pieces, progressMin: 0, phase: pieces >= PIECES.length ? 'walkBack' : 'salvage' };
    } else if (next.phase === 'walkBack') {
      next = { ...next, phase: next.piecesSalvaged >= PIECES.length ? 'won' : 'survived' };
    }
  }
  return next;
}

export function sol1Diagnose(s: Sol1State, cause: CauseId): Sol1State {
  return { ...s, diagnosis: cause, alarm: 'recover' };
}

export const canSwap = (s: Sol1State) => s.piecesSalvaged >= 2 && !s.spareUsed;

/** Apply a recovery action. Returns the new state and any LiOH to add to the suit. */
export function sol1Act(s: Sol1State, action: ActionId): { state: Sol1State; addLiohKg: number } {
  const resume = s.alarm === 'recover' ? 'done' : s.alarm;
  switch (action) {
    case 'breathe':
      return { state: { ...s, trapPicked: true }, addLiohKg: 0 };
    case 'slow':
      return { state: { ...s, slow: !s.slow, alarm: resume }, addLiohKg: 0 };
    case 'swap':
      if (!canSwap(s)) return { state: s, addLiohKg: 0 };
      return { state: { ...s, spareUsed: true, alarm: resume }, addLiohKg: SPARE_LIOH_KG };
    case 'abort': {
      if (s.phase !== 'walkOut' && s.phase !== 'salvage') return { state: s, addLiohKg: 0 };
      // Head home from here: the way back is as long as the way out was (capped at the full walk).
      const walkedOut = s.phase === 'walkOut' ? s.progressMin : WALK_OUT_MIN;
      return { state: { ...s, phase: 'walkBack', progressMin: WALK_BACK_MIN - walkedOut, alarm: resume }, addLiohKg: 0 };
    }
  }
}
