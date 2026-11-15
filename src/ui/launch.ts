// The intro's launch from Earth (Map/Aiman): an illustrative two-stage ascent to orbit, sped up.
// The profile is typical of a medium-lift rocket (max-Q near T+72 s at ~13 km, main engine cut-off near T+150 s at
// ~68 km and ~2.1 km/s, stage separation a few seconds later). It is not any one real vehicle. Pure, no three.js.

/** Mission seconds, altitude (m), speed (m/s). */
export const ASCENT: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [10, 150, 40], [30, 2_000, 180], [60, 10_000, 450], [72, 13_500, 560], [100, 30_000, 1_000],
  [150, 68_000, 2_100], [160, 75_000, 2_150], [200, 105_000, 2_600], [260, 140_000, 3_400],
];
export const EVENTS = { ignite: -3, liftoff: 0, maxQ: 72, meco: 150, sep: 155, ses: 162 };

/** Animation seconds for each stretch, and the mission-time span each covers. */
export const LAUNCH_SEG = [
  { stage: 'pad', s: 2.8, from: -10, to: -3 },
  { stage: 'ignite', s: 1.8, from: -3, to: 0 },
  { stage: 'rise', s: 3.6, from: 0, to: 25 },
  { stage: 'ascent', s: 5.6, from: 25, to: 200 },
] as const;
export type LaunchStage = (typeof LAUNCH_SEG)[number]['stage'];
export const LAUNCH_MS = Math.round(LAUNCH_SEG.reduce((a, b) => a + b.s, 0) * 1000);

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

/** Altitude and speed at mission time `t` (linear between the table's points; on the pad before liftoff). */
export function ascentAt(t: number): { alt: number; v: number } {
  if (t <= 0) return { alt: 0, v: 0 };
  const A = ASCENT;
  for (let i = 1; i < A.length; i++) {
    if (t <= A[i][0]) { const f = (t - A[i - 1][0]) / (A[i][0] - A[i - 1][0]); return { alt: lerp(A[i - 1][1], A[i][1], f), v: lerp(A[i - 1][2], A[i][2], f) }; }
  }
  const last = A[A.length - 1];
  return { alt: last[1], v: last[2] };
}

/** Pitch from vertical (degrees): straight up, then the gravity turn eases the rocket over toward the horizon. */
export function pitchAt(t: number): number {
  return t < 12 ? 0 : 68 * (1 - Math.exp(-(t - 12) / 80));
}

/** Distance flown downrange (m) by mission time t, integrated from the speed and pitch (0.25 s steps, cached). */
const DT = 0.25;
const DOWN: number[] = (() => {
  const out = [0];
  for (let t = DT; t <= 260; t += DT) {
    const { v } = ascentAt(t);
    out.push(out[out.length - 1] + v * Math.sin((pitchAt(t) * Math.PI) / 180) * DT);
  }
  return out;
})();
export function downrangeAt(t: number): number {
  if (t <= 0) return 0;
  const i = Math.min(DOWN.length - 2, Math.floor(t / DT)), f = Math.min(1, t / DT - i);
  return lerp(DOWN[i], DOWN[i + 1], f);
}

/** Animation time → mission time and the stretch it falls in. */
export function launchClock(T: number): { stage: LaunchStage; t: number; f: number } {
  let acc = 0;
  for (const s of LAUNCH_SEG) {
    if (T <= acc + s.s) { const f = Math.max(0, (T - acc) / s.s); return { stage: s.stage, t: lerp(s.from, s.to, f), f }; }
    acc += s.s;
  }
  const end = LAUNCH_SEG[LAUNCH_SEG.length - 1];
  return { stage: end.stage, t: end.to, f: 1 };
}

/** What is happening at mission time t, for the caption. */
export function launchEvent(t: number): string {
  if (t < EVENTS.ignite) return 'TERMINAL COUNT';
  if (t < EVENTS.liftoff) return 'ENGINE IGNITION';
  if (t < 12) return 'LIFTOFF';
  if (t > 60 && t < 84) return 'MAX-Q · PEAK AIR PRESSURE ON THE ROCKET';
  if (t >= EVENTS.meco - 4 && t < EVENTS.sep) return 'MAIN ENGINE CUT-OFF';
  if (t >= EVENTS.sep && t < EVENTS.ses) return 'STAGE SEPARATION';
  if (t >= EVENTS.ses) return 'SECOND STAGE IGNITION';
  return 'ASCENT · GRAVITY TURN';
}
