// LOCAL DRAFT (Aiman, not pushed): physics for the intro crash (entry, descent and landing, "EDL").
// A point-mass capsule falls into Mars' atmosphere: gravity pulls it down, air drag slows it, and the air is
// thin high up and thicker lower down (exponential atmosphere), so the drag and the heating peak in between.
// Heating grows with the square root of air density times speed cubed (Sutton–Graves form): the capsule
// becomes a ball of fire high up, then cools as it slows. The parachute opens below about Mach 2, then (in the
// story) tears; the retro-rockets sputter, and the capsule hits the ground hard but survivably.
// Numbers are typical of NASA Mars landers (Perseverance: entry ~5.4 km/s at ~125 km, peak deceleration
// ~10 g); the failures are game fiction.

export const MARS_G = 3.71;          // m/s², surface gravity
export const MARS_R = 3_389_500;     // m, mean radius
export const RHO0 = 0.02;            // kg/m³, surface air density (about 1% of Earth's)
export const SCALE_H = 11_100;       // m, atmospheric scale height
const G0 = 9.81;                     // m/s², one Earth g (deceleration is quoted in Earth g)

export interface EdlSample {
  t: number; h: number; x: number; vx: number; vh: number; v: number;
  /** Drag deceleration in Earth g. */
  gLoad: number;
  /** Heating rate, 0..1 of its peak. */
  heat: number;
  chute: 'stowed' | 'open' | 'torn';
  thrust: boolean;
}
export interface EdlRun {
  samples: EdlSample[];
  /** Simulated seconds of each event. */
  events: { chute: number; tear: number; retro: number; impact: number; peakHeat: number; peakG: number };
}

export interface EdlOptions {
  h0?: number; v0?: number; gammaDeg?: number;
  /** Ballistic coefficient, kg/m² (mass ÷ drag area): capsule alone, and with the parachute open. */
  beta?: number; betaChute?: number;
  /** Seconds the parachute holds before tearing. */
  chuteHoldS?: number;
  /** Retro-rocket start height (m) and thrust (m/s² while firing). */
  retroH?: number; retroAcc?: number;
  /** Seconds after lighting that the damaged retros die for good. */
  retroS?: number;
  dt?: number;
}

/** Run the descent until the capsule hits the ground. Deterministic (the sputter pattern is fixed). */
export function simulateEdl(o: EdlOptions = {}): EdlRun {
  const dt = o.dt ?? 0.05;
  const beta = o.beta ?? 120, betaChute = o.betaChute ?? 14;
  const g = ((o.gammaDeg ?? -10.5) * Math.PI) / 180;
  let h = o.h0 ?? 125_000, x = 0, t = 0;
  let vx = (o.v0 ?? 5400) * Math.cos(g), vh = (o.v0 ?? 5400) * Math.sin(g);
  let chute: EdlSample['chute'] = 'stowed';
  const ev = { chute: NaN, tear: NaN, retro: NaN, impact: NaN, peakHeat: 0, peakG: 0 };
  const raw: EdlSample[] = [];
  let maxQ = 0, maxG = 0;
  const retroH = o.retroH ?? 1500, retroAcc = o.retroAcc ?? 24, hold = o.chuteHoldS ?? 9, retroS = o.retroS ?? 17;
  while (h > 0 && t < 2000) {
    const v = Math.hypot(vx, vh), rho = RHO0 * Math.exp(-h / SCALE_H);
    if (chute === 'stowed' && v < 450 && h < 15_000) { chute = 'open'; ev.chute = t; }
    if (chute === 'open' && t - ev.chute > hold) { chute = 'torn'; ev.tear = t; }
    const b = chute === 'open' ? betaChute : beta;
    const drag = (rho * v * v) / (2 * b);
    // Retro-rockets: they fire on and off (engine damage), a fixed stutter so every run looks the same.
    const firing = (h < retroH || !Number.isNaN(ev.retro)) && chute === 'torn' && vh < -5 && Math.floor(t * 3) % 3 !== 2
      && (Number.isNaN(ev.retro) || t - ev.retro < retroS);
    if (firing && Number.isNaN(ev.retro)) ev.retro = t;
    const thrust = firing ? retroAcc : 0;
    // Acceleration: drag against the velocity, gravity down, the retro thrust up, and the curve of the planet
    // (fast sideways motion "falls around" Mars a little: vx² / r).
    // The retros push against the direction of travel, like a real lander's descent engines.
    const ax = -(drag + thrust) * (vx / v);
    const ah = -(drag + thrust) * (vh / v) - MARS_G + (vx * vx) / (MARS_R + h);
    const q = Math.sqrt(rho) * v * v * v;
    maxQ = Math.max(maxQ, q);
    const gLoad = drag / G0;
    if (gLoad > maxG) { maxG = gLoad; ev.peakG = t; }
    if (q >= maxQ) ev.peakHeat = t;
    raw.push({ t, h, x, vx, vh, v, gLoad, heat: q, chute, thrust: firing });
    vx += ax * dt; vh += ah * dt; x += vx * dt; h += vh * dt; t += dt;
  }
  ev.impact = t;
  const v = Math.hypot(vx, vh);
  raw.push({ t, h: 0, x, vx, vh, v, gLoad: 0, heat: 0, chute, thrust: false });
  for (const s of raw) s.heat = maxQ ? s.heat / maxQ : 0;
  return { samples: raw, events: ev };
}

/** The state at simulated time `t` (linear between samples). */
export function edlAt(run: EdlRun, t: number): EdlSample {
  const S = run.samples, dt = S.length > 1 ? S[1].t - S[0].t : 1;
  const i = Math.max(0, Math.min(S.length - 2, Math.floor(t / dt)));
  const a = S[i], b = S[i + 1] ?? a, f = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-9, b.t - a.t)));
  const L = (p: number, q: number) => p + (q - p) * f;
  return { ...a, t, h: L(a.h, b.h), x: L(a.x, b.x), vx: L(a.vx, b.vx), vh: L(a.vh, b.vh), v: L(a.v, b.v), gLoad: L(a.gLoad, b.gLoad), heat: L(a.heat, b.heat) };
}

/** The intro's run, and how its stretches map onto animation seconds (the real descent takes ~5½ minutes). */
export const CRASH_RUN = simulateEdl();
const RUN = CRASH_RUN;
const E = RUN.events;
/** Animation seconds for each stretch of the simulated run (the real descent takes ~5½ minutes). */
export const CRASH_SEG = [
  { from: 0, to: E.chute, s: 3.4, label: 'ATMOSPHERIC ENTRY' },
  { from: E.chute, to: E.tear, s: 1.1, label: 'PARACHUTE DEPLOYED' },
  { from: E.tear, to: E.retro, s: 0.9, label: '▲ PARACHUTE FAILURE' },
  { from: E.retro, to: E.impact, s: 1.6, label: '▲ RETRO-ROCKETS: THRUST LOST' },
];
export const FLY_S = CRASH_SEG.reduce((a, b) => a + b.s, 0);
export const AFTER_S = 1.8;
/** Total length, for the intro timeline. */
export const CRASH_MS = Math.round((FLY_S + AFTER_S) * 1000);

/** Animation time → simulated time and which stretch we are in. */
export function crashTime(T: number): { t: number; seg: number; f: number } {
  let acc = 0;
  for (let i = 0; i < CRASH_SEG.length; i++) {
    const s = CRASH_SEG[i];
    if (T <= acc + s.s) { const f = (T - acc) / s.s; return { t: s.from + (s.to - s.from) * f, seg: i, f }; }
    acc += s.s;
  }
  return { t: E.impact, seg: CRASH_SEG.length, f: 1 };
}

