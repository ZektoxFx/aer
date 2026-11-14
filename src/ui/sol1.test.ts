import { describe, expect, it } from 'vitest';
import { forecast } from '../sim/game';
import { FULL_SUIT, simulate } from '../sim/simulate';
import type { Environment, SuitState } from '../sim/types';
import {
  SOL1_START_LIOH_KG, canSwap, isHolding, sol1Act, sol1Advance, sol1Begin, sol1Diagnose, sol1Posture, sol1Start,
  type ActionId, type Sol1State,
} from './sol1';

// Sol 312 at Jezero, mean of the day's MEDA min and max.
const ENV: Environment = { pressureKPa: 0.626, tempC: -42.7, windMS: 3.06, tau: 0.328 };

/** Play the scenario minute by minute through the real suit sim. `onAlarm` picks the recovery actions. */
function play(onAlarm: (s: Sol1State) => ActionId[]) {
  let suit: SuitState = { ...FULL_SUIT, liohKg: SOL1_START_LIOH_KG };
  let s = sol1Begin(sol1Start(0), 0);
  let alarmAt: Sol1State | null = null;
  for (let t = 1; t < 600 && !['won', 'survived', 'lost'].includes(s.phase); t++) {
    const { activity } = sol1Posture(s);
    suit = simulate(suit, ENV, activity, 1).state;
    s = sol1Advance(s, t, suit, forecast(suit, ENV, activity));
    if (s.alarm === 'diagnose') {
      alarmAt = s;
      s = sol1Diagnose(s, 'canister');
      for (const a of onAlarm(s)) {
        const r = sol1Act(s, a);
        s = r.state;
        suit = { ...suit, liohKg: suit.liohKg + r.addLiohKg };
      }
      if (s.alarm === 'recover') s = { ...s, alarm: 'done' };
    }
  }
  return { s, alarmAt };
}

describe('Sol 1: Scrubber Saturation', () => {
  it('starts on a briefing with the clock held', () => {
    const s = sol1Start(0);
    expect(s.phase).toBe('briefing');
    expect(isHolding(s)).toBe(true);
  });

  it('raises the scrubber alarm while salvaging, after the supply crate is in hand', () => {
    const { alarmAt } = play(() => ['swap']);
    expect(alarmAt?.phase).toBe('salvage');
    expect(alarmAt?.piecesSalvaged).toBe(2);
    expect(canSwap(alarmAt!)).toBe(true);
  });

  it('is won by swapping in the spare canister', () => {
    const { s } = play(() => ['swap']);
    expect(s.phase).toBe('won');
    expect(s.piecesSalvaged).toBe(3);
  });

  it('is lost by ignoring the alarm', () => {
    const { s } = play(() => []);
    expect(s.phase).toBe('lost');
    expect(s.lostReason).toMatch(/CO₂/);
  });

  it('breathing harder is a trap: it changes nothing and is recorded', () => {
    const s = sol1Diagnose(sol1Begin(sol1Start(0), 0), 'canister');
    const r = sol1Act(s, 'breathe');
    expect(r.state.trapPicked).toBe(true);
    expect(r.state.alarm).toBe('recover');
    expect(r.addLiohKg).toBe(0);
  });

  it('aborting heads home and keeps what was salvaged', () => {
    const s: Sol1State = { ...sol1Begin(sol1Start(0), 0), phase: 'salvage', piecesSalvaged: 1, alarm: 'recover' };
    const r = sol1Act(s, 'abort').state;
    expect(r.phase).toBe('walkBack');
    expect(r.piecesSalvaged).toBe(1);
    expect(r.progressMin).toBe(0);
  });
});
