import { describe, expect, it } from 'vitest';
import { FULL_SUIT } from '../sim/simulate';
import { SHELTER_CHOICES, chooseShelter, flowPosture, summarize, updateFlow } from './shelterFlow';

const choice = (id: string) => SHELTER_CHOICES.find((c) => c.id === id)!;

describe('shelter flow', () => {
  it('offers the four choices from the proposal', () => {
    expect(SHELTER_CHOICES.map((c) => c.id)).toEqual(['cabin', 'wreck', 'build', 'search']);
  });

  it('travels outside until the travel time is up, then rests under cover', () => {
    let flow = chooseShelter(choice('wreck'), 100, FULL_SUIT);
    expect(flowPosture(flow).shelter).toBe('none');
    expect(flowPosture(flow).activity.speedMS).toBeGreaterThan(0);

    flow = updateFlow(flow, 119, FULL_SUIT);
    expect(flow.arrived).toBe(false);
    flow = updateFlow(flow, 120, FULL_SUIT);
    expect(flow.arrived).toBe(true);
    expect(flowPosture(flow)).toEqual({ activity: { speedMS: 0, slopeDeg: 0, loadKg: 0 }, shelter: 'wreck' });
  });

  it('keeps searching outside on foot', () => {
    const flow = chooseShelter(choice('search'), 0, FULL_SUIT);
    expect(flow.arrived).toBe(true);
    expect(flowPosture(flow).shelter).toBe('none');
    expect(flowPosture(flow).activity.speedMS).toBeGreaterThan(0);
  });

  it('summarizes what the storm cost', () => {
    let flow = chooseShelter(choice('cabin'), 0, FULL_SUIT);
    const later = { ...FULL_SUIT, o2Kg: FULL_SUIT.o2Kg - 0.2, waterKg: FULL_SUIT.waterKg - 1, batteryWh: FULL_SUIT.batteryWh - 100, coreTempC: 36.2 };
    flow = updateFlow(flow, 300, later);
    const s = summarize(flow, 300, later);
    expect(s.hours).toBe(5);
    expect(s.o2UsedG).toBeCloseTo(200);
    expect(s.waterUsedKg).toBeCloseTo(1);
    expect(s.batteryUsedWh).toBeCloseTo(100);
    expect(s.minCoreTempC).toBe(36.2);
    expect(s.maxCoreTempC).toBe(37);
  });
});
