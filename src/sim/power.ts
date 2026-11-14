import type { Environment, Load, PowerResult, PowerState } from './types';

// Power model (§3.5): P_solar = S · A · η · f(τ, sun angle) · (1 − soiling).
// env.solarWm2 already carries S · f(τ, sun angle); this file applies area, efficiency and dust.
const PANEL_EFFICIENCY = 0.25;            // a little under the ~27% triple-junction cells on Mars rovers, for wear
const MARS_SOLAR_CONSTANT_WM2 = 586;      // top of atmosphere at Mars' mean distance from the Sun

/** Starting power system in the crashed cabin. Design values to tune in playtesting [verify]. */
export const CABIN_POWER: PowerState = { batteryWh: 5000, capacityWh: 10000, panelAreaM2: 4, soiling: 0.1 };

/** Loads the player can switch on. Watts from the proposal §4 where given, otherwise design values [verify]. */
export const BASE_LOADS = {
  suitCharger: { id: 'suitCharger', watts: 200 },
  shelterHeat: { id: 'shelterHeat', watts: 300 },
  moxie: { id: 'moxie', watts: 300 },          // makes 6–12 g/h O₂ (§4)
  sorbentRegen: { id: 'sorbentRegen', watts: 200 },
  regolithOven: { id: 'regolithOven', watts: 500 },
} satisfies Record<string, Load>;

/**
 * Rough surface sunlight from dust τ and sun elevation.
 * shortcut: one exponential fit (≈84% at τ 0.5, ≈2% at τ 10.8). The game uses NASA's table (data/sunlight.ts) when it has
 * one; this remains the fallback without data and the extrapolation beyond the table's largest τ.
 */
export function approxSolarWm2(tau: number, sunElevationDeg: number): number {
  if (sunElevationDeg <= 0) return 0;
  const sinH = Math.sin((sunElevationDeg * Math.PI) / 180);
  return MARS_SOLAR_CONSTANT_WM2 * sinH * Math.exp((-0.35 * tau) / sinH);
}

export function panelW(p: PowerState, env: Environment): number {
  return (env.solarWm2 ?? 0) * p.panelAreaM2 * PANEL_EFFICIENCY * (1 - p.soiling);
}

/**
 * Run the power system for `minutes`. Pure: returns a new state.
 * Each minute, sunlight feeds the loads first and the battery takes any surplus (up to capacity).
 * When sun plus battery can't cover every load, loads are cut from the end of the list until the rest fit.
 * A cut load comes back whenever the battery can cover it again, so on weak sun it runs in bursts.
 */
export function powerStep(start: PowerState, env: Environment, loads: Load[], minutes: number): PowerResult {
  const s = { ...start };
  const solarW = panelW(s, env);
  const deliveredWh: Record<string, number> = Object.fromEntries(loads.map((l) => [l.id, 0]));
  const shed = new Set<string>();

  // 1-minute substeps so the battery running flat mid-step cuts loads at the right time
  for (let done = 0; done < minutes; ) {
    const hours = Math.min(1, minutes - done) / 60;
    let running = loads;
    for (;;) {
      const netWh = (solarW - running.reduce((sum, l) => sum + l.watts, 0)) * hours;
      if (netWh >= 0 || s.batteryWh >= -netWh) {
        s.batteryWh = Math.min(s.capacityWh, s.batteryWh + netWh);
        break;
      }
      shed.add(running[running.length - 1].id);
      running = running.slice(0, -1);
    }
    for (const l of running) deliveredWh[l.id] += l.watts * hours;
    done += hours * 60;
  }

  return { state: s, solarW, deliveredWh, shed: [...shed] };
}
