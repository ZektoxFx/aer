import { localHour } from '../sim/game';
import { MIN_PER_SOL } from '../sim/storm';
import type { ClockSpeed, Forecast } from '../sim/types';

export type Consumable = keyof Forecast;

export const CONSUMABLE_LABEL: Record<Consumable, string> = {
  o2Min: 'O₂',
  scrubberMin: 'SCRUBBER',
  waterMin: 'WATER',
  batteryMin: 'BATTERY',
};

/** Game minutes as H:MM ("4:07"). Infinity (not being used) shows as "--:--". */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min)) return '--:--';
  const total = Math.max(0, Math.floor(min));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The consumable that runs out first, or null when nothing is being used up. */
export function firstToRunOut(f: Forecast): { key: Consumable; min: number } | null {
  let best: { key: Consumable; min: number } | null = null;
  for (const key of Object.keys(CONSUMABLE_LABEL) as Consumable[]) {
    if (Number.isFinite(f[key]) && (best === null || f[key] < best.min)) best = { key, min: f[key] };
  }
  return best;
}

/** Sol number and local Mars time ("08:12") for the HUD clock. */
export function clockLabel(clockMin: number): { sol: number; time: string } {
  const mins = Math.floor(localHour(clockMin) * 60 + 1e-6); // nudge so 11:59.9999 float error reads 12:00
  const hh = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  return { sol: Math.floor(clockMin / MIN_PER_SOL), time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` };
}

export const SPEED_LABEL: Record<ClockSpeed, string> = {
  paused: '❚❚ PAUSED',
  traverse: '▶▶ 40×',
  storm: '▶ 24× STORM',
  emergency: '▶ 1× EMERGENCY',
};
