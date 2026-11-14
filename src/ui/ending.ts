import type { MapItem, MapWorldState, Pt } from '../map';
import type { SuitState } from '../sim/types';
import type { Pack } from './inventory';
import type { RelayPass } from './mission';
import { COMMS_LINK_ID } from './ship';

// The ending (proposal §1 and §6.2): plug the comms link into Perseverance's UHF radio and send the distress call
// while an orbiter is overhead. Perseverance relays through MRO, Odyssey or ESA's TGO to NASA's Deep Space
// Network (Mars Relay Network Handbook, relay.json). Also the other ending: the suit fails.

/** How close the astronaut must be to Perseverance to plug in, metres. */
export const ROVER_REACH_M = 15;
/** Earth–Mars radio time, one way, minutes (reference.json mars.lightTimeOneWayMin). */
export const LIGHT_TIME_MIN: [number, number] = [3, 22];
/**
 * Game minutes a fatal suit state can last before the run ends. The suit sim's own text says CO₂ above 8 kPa
 * means "unconsciousness within about 10 min"; the same grace is used for running out of O₂ (design value).
 */
export const FAIL_AFTER_MIN = 10;

/** Perseverance, if the map has found it and the astronaut is within reach. */
export function roverInReach(world: Pick<MapWorldState, 'items' | 'found'> | null, pos: Pt): MapItem | null {
  const rover = world?.items.find((i) => i.kind === 'rover');
  if (!rover || (rover.hidden && !world!.found.has(rover.id))) return null;
  return Math.hypot(rover.at.x - pos.x, rover.at.y - pos.y) <= ROVER_REACH_M ? rover : null;
}

export const hasCommsLink = (pack: Pack) => pack.entries.some((e) => e.id === COMMS_LINK_ID);

/** What the player can do at the rover: needs the link, can plug it in, waits for a pass, or can send. */
export type CallStage = 'need-link' | 'connect' | 'wait' | 'send';
export function callStage(linked: boolean, carryingLink: boolean, pass: RelayPass | null): CallStage {
  if (!linked) return carryingLink ? 'connect' : 'need-link';
  return pass && pass.inMin === 0 ? 'send' : 'wait';
}

/** Plug the link in: it leaves the backpack and stays on the rover. */
export const installLink = (pack: Pack): Pack => ({ ...pack, entries: pack.entries.filter((e) => e.id !== COMMS_LINK_ID) });

export type FailCause = 'o2' | 'co2';
/** A fatal suit state right now: no O₂ left, or CO₂ high enough for unconsciousness (sim's 8 kPa line). */
export function fatalState(suit: SuitState): FailCause | null {
  if (suit.o2Kg <= 0) return 'o2';
  if (suit.inspiredPCO2KPa > 8) return 'co2';
  return null;
}

export interface FailWatch {
  cause: FailCause;
  sinceMin: number;
}

/** Track how long a fatal state has lasted. Returns the new watch, and the cause once it has lasted too long. */
export function watchFailure(prev: FailWatch | null, suit: SuitState, clockMin: number): { watch: FailWatch | null; failed: FailCause | null } {
  const cause = fatalState(suit);
  if (!cause) return { watch: null, failed: null };
  const watch = prev && prev.cause === cause ? prev : { cause, sinceMin: clockMin };
  return { watch, failed: clockMin - watch.sinceMin >= FAIL_AFTER_MIN ? cause : null };
}
