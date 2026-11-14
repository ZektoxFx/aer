import type { Activity, Environment, SimWarning, StepResult, SuitState } from './types';

// Rates from the proposal §3.4 (NASA BVAD baselines). Values marked [verify] are listed in proposal §9.
export const O2_G_PER_WH = 0.255;   // g O₂ per hour per watt of metabolic rate
export const CO2_PER_O2 = 1.19;     // kg CO₂ made per kg O₂ used (RQ ≈ 0.87)
export const LIOH_PER_CO2 = 1.09;   // kg LiOH used per kg CO₂ scrubbed
export const AVIONICS_W = 150;
const EVAP_J_PER_KG = 2.45e6;       // heat carried away per kg of evaporated water
const SUIT_GAS_L = 50;              // free gas volume of the suit loop [verify]
// Ideal gas at body temperature: kPa added per gram of CO₂ left in the suit loop.
const KPA_PER_G_CO2 = (8.314 * 310) / 44.01 / SUIT_GAS_L;
const SCRUBBED_PCO2_KPA = 0.1;

// Heat balance (§3.3). Insulation, radiation and convection are lumped into one conductance.
// Values marked [verify] are design values chosen so "work hot, rest cold" happens at Jezero temperatures.
const SUIT_UA_W_PER_K = 3.3;          // heat leak from body to Mars per K difference (~300 W at −55 °C) [verify]
const SUIT_SUN_ABSORPTANCE = 0.2;     // white outer layer [verify]
const SUIT_SUN_AREA_M2 = 0.7;         // area facing the sun [verify]
const EVAP_MAX_W = 550;               // membrane evaporator capacity [verify]
const BODY_HEAT_CAP_J_PER_K = 75 * 3470; // 75 kg × tissue specific heat
const CORE_SETPOINT_C = 37;

/** Starting suit for a fresh excursion. Design values to tune in playtesting [verify]. */
export const FULL_SUIT: SuitState = {
  o2Kg: 0.6, liohKg: 0.5, waterKg: 3.6, batteryWh: 1200,
  inspiredPCO2KPa: SCRUBBED_PCO2_KPA, coreTempC: 37, elapsedMin: 0,
};

export function metabolicW(a: Activity): number {
  // shortcut: linear in speed, load and uphill slope; replace with a validated suited-walking model (proposal §9)
  const uphill = 1 + Math.max(0, a.slopeDeg) / 10;
  return 100 + a.speedMS * (200 + 6 * a.loadKg) * uphill;
}

/** Alveolar CO₂ (kPa) from inspired CO₂, CO₂ output (mL/min STPD) and alveolar ventilation (L/min BTPS). §3.1 */
export function alveolarPCO2(inspiredKPa: number, vco2MlMin: number, vaLMin: number): number {
  return inspiredKPa + (0.115 * vco2MlMin) / vaLMin;
}

/** Alveolar O₂ (kPa) in a pure-O₂ suit. §3.1 */
export function alveolarPO2PureO2(suitKPa: number, arterialPCO2KPa: number): number {
  return suitKPa - 6.3 - arterialPCO2KPa;
}

const CO2_TIERS = [
  { above: 8, level: 'critical', message: 'CO₂ critical: unconsciousness within about 10 min' },
  { above: 6, level: 'critical', message: 'CO₂ above venous level: lungs can no longer clear it' },
  { above: 5, level: 'critical', message: 'CO₂ high: panic, blurred vision, rapid pulse' },
  { above: 3, level: 'warning', message: 'CO₂ rising: visual disturbance, slowed thinking' },
  { above: 1, level: 'warning', message: 'CO₂ elevated: mild headache, short of breath' },
] as const;

/** Symptom tier for an inspired pCO₂ (kPa), or null when harmless. §3.1 table */
export function co2Effect(inspiredKPa: number): SimWarning | null {
  const tier = CO2_TIERS.find((t) => inspiredKPa > t.above);
  return tier ? { code: 'CO2', level: tier.level, message: tier.message } : null;
}

/** Advance the suit by `minutes` of one activity. Pure: returns a new state. */
export function simulate(start: SuitState, env: Environment, activity: Activity, minutes: number): StepResult {
  const w = metabolicW(activity);
  const o2KgPerMin = (O2_G_PER_WH * w) / 1000 / 60;
  const co2KgPerMin = o2KgPerMin * CO2_PER_O2;
  const batteryWhPerMin = AVIONICS_W / 60;
  const solarW = SUIT_SUN_ABSORPTANCE * SUIT_SUN_AREA_M2 * (env.solarWm2 ?? 0);

  const s = { ...start };
  // 1-minute substeps so a canister or water running out mid-leg is caught at the right time
  for (let done = 0; done < minutes; ) {
    const dt = Math.min(1, minutes - done);
    const seconds = dt * 60;
    s.o2Kg = Math.max(0, s.o2Kg - o2KgPerMin * dt);
    s.batteryWh = Math.max(0, s.batteryWh - batteryWhPerMin * dt);

    // Heat: the evaporator works as a thermostat, pulling the core back to 37 °C.
    // It can only cool, is capped by its capacity, and stops when the water runs out.
    const surplusW = w + AVIONICS_W + solarW - SUIT_UA_W_PER_K * (s.coreTempC - env.tempC);
    const wantedW = surplusW + ((s.coreTempC - CORE_SETPOINT_C) * BODY_HEAT_CAP_J_PER_K) / seconds;
    const waterLimitW = (s.waterKg * EVAP_J_PER_KG) / seconds;
    const evapW = Math.max(0, Math.min(wantedW, EVAP_MAX_W, waterLimitW));
    s.waterKg = Math.max(0, s.waterKg - (evapW * seconds) / EVAP_J_PER_KG);
    s.coreTempC += ((surplusW - evapW) * seconds) / BODY_HEAT_CAP_J_PER_K;

    const co2Kg = co2KgPerMin * dt;
    const liohNeeded = co2Kg * LIOH_PER_CO2;
    if (s.liohKg >= liohNeeded) {
      s.liohKg -= liohNeeded;
      s.inspiredPCO2KPa = SCRUBBED_PCO2_KPA;
    } else {
      const unscrubbedKg = co2Kg - s.liohKg / LIOH_PER_CO2;
      s.liohKg = 0;
      s.inspiredPCO2KPa += unscrubbedKg * 1000 * KPA_PER_G_CO2;
    }
    s.elapsedMin += dt;
    done += dt;
  }

  const warnings: SimWarning[] = [];
  const o2MinLeft = s.o2Kg / o2KgPerMin;
  if (s.o2Kg <= 0) warnings.push({ code: 'O2_OUT', level: 'critical', message: 'O₂ exhausted' });
  else if (o2MinLeft < 30) warnings.push({ code: 'O2_LOW', level: 'warning', message: `O₂ out in ${Math.floor(o2MinLeft)} min at this pace` });

  const co2 = co2Effect(s.inspiredPCO2KPa);
  if (co2) warnings.push(co2);

  if (s.waterKg <= 0) warnings.push({ code: 'WATER_OUT', level: 'warning', message: 'Cooling water exhausted: overheating risk' });

  // Core temperature tiers [verify against clinical thresholds]
  const t = s.coreTempC;
  if (t > 39) warnings.push({ code: 'CORE_TEMP', level: 'critical', message: `Core ${t.toFixed(1)} °C: heat exhaustion` });
  else if (t > 38) warnings.push({ code: 'CORE_TEMP', level: 'warning', message: `Core ${t.toFixed(1)} °C: overheating, slow down` });
  else if (t < 35) warnings.push({ code: 'CORE_TEMP', level: 'critical', message: `Core ${t.toFixed(1)} °C: hypothermia` });
  else if (t < 36) warnings.push({ code: 'CORE_TEMP', level: 'warning', message: `Core ${t.toFixed(1)} °C: getting cold, find shelter or move` });

  const batteryMinLeft = s.batteryWh / batteryWhPerMin;
  if (s.batteryWh <= 0) warnings.push({ code: 'BATTERY_OUT', level: 'critical', message: 'Suit battery dead' });
  else if (batteryMinLeft < 30) warnings.push({ code: 'BATTERY_LOW', level: 'warning', message: `Battery out in ${Math.floor(batteryMinLeft)} min` });

  return { state: s, warnings, metabolicW: w };
}
