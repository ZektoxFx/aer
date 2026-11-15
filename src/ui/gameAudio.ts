// In-game sound, synthesized in the browser with Web Audio (no audio files), like the intro (introAudio.ts).
//
// Two kinds of sound:
// - Inside the helmet (clear): the suit's fan, your breathing (faster and heavier with effort and CO₂), the suit's
//   chimes and alarms, and footsteps felt through the boots.
// - Outside (muffled): Mars' air is about 1% as dense as Earth's, so sound outside is quiet and loses its highs
//   (Perseverance's microphones recorded this). The wind follows MEDA's wind speed, a dust storm adds roar and grit
//   on the visor, and the cabin walls muffle it further.
// Levels and timings are design values for the game.

export type GameCue =
  | 'pickup' | 'drop' | 'store' | 'use-o2' | 'use-lioh' | 'use-water' | 'use-battery'
  | 'done' | 'rover' | 'call' | 'storm-warning' | 'blocked';

export interface GameSoundState {
  /** Outdoor wind, m/s (weather data). */
  windMS: number;
  /** Storm strength 0..1 (cover.ts stormStrength). */
  storm: number;
  night: boolean;
  /** Inside the lander's cabin (outside sounds muffled more). */
  inCabin: boolean;
  /** Metabolic rate, W: sets the breathing rate and depth. */
  effortW: number;
  /** Inspired CO₂, kPa: high CO₂ makes breathing faster. */
  co2KPa: number;
  /** The game is paused or holding (menus, cards): the scene goes quieter. */
  paused: boolean;
}

export interface GameAudio {
  update: (s: GameSoundState) => void;
  step: (run: boolean) => void;
  cue: (c: GameCue) => void;
  /** Repeating O₂ alarm: 'low' every few seconds, 'critical' fast; null stops it. */
  alarm: (level: 'low' | 'critical' | null) => void;
  /** Welding crackle while a repair or build plays. */
  work: (on: boolean) => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
}

/** Breaths per minute for a metabolic rate (W) and inspired CO₂ (kPa): about 12 at rest, up to 30 working hard. */
export function breathsPerMin(effortW: number, co2KPa: number): number {
  const base = 12 + Math.max(0, effortW - 100) * 0.045;
  const co2 = co2KPa > 1 ? 1 + Math.min(0.6, (co2KPa - 1) * 0.12) : 1;
  return Math.min(32, Math.max(10, base * co2));
}

/** Wind loudness 0..1 from wind speed (m/s) and storm strength. */
export function windLevel(windMS: number, storm: number): number {
  return Math.min(1, 0.12 + Math.min(1, windMS / 20) * 0.45 + storm * 0.55);
}

export function createGameAudio(): GameAudio | null {
  const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return null; }
  // Browsers start audio only after a click or key press: resume on the next one.
  const unlock = () => { void ctx.resume(); };
  void ctx.resume();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const now = () => ctx.currentTime;
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;
  };
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noiseSrc = (loop = true) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = loop; return s; };
  const env = (g: GainNode, t: number, peak: number, attack: number, release: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };
  const smooth = (p: AudioParam, v: number, tc = 0.4) => p.setTargetAtTime(v, now(), tc);

  // ---- Mixing: master → speakers; the scene (paused ducking); outside sounds through the "thin air" filter ----
  const master = gain(0.85);
  master.connect(ctx.destination);
  const scene = gain(1);
  scene.connect(master);
  const air = filter('lowpass', 1800, 0.5); // Mars' thin CO₂ air: quiet, few highs
  const outside = gain(1);
  air.connect(outside).connect(scene);

  // ---- Wind: two bands of noise with slow gusts ----
  const windSrc = noiseSrc();
  const windLow = filter('bandpass', 220, 0.8), windHigh = filter('bandpass', 650, 1.2);
  const windLowG = gain(0), windHighG = gain(0);
  windSrc.connect(windLow).connect(windLowG).connect(air);
  windSrc.connect(windHigh).connect(windHighG).connect(air);
  windSrc.start();
  // Storm: dust grit ticking on the visor (contact, so not muffled by the air) and a deep roar.
  const gritSrc = noiseSrc();
  const grit = filter('highpass', 2600, 0.6), gritG = gain(0);
  gritSrc.connect(grit).connect(gritG).connect(scene);
  gritSrc.start();
  const roar = filter('lowpass', 140, 0.9), roarG = gain(0);
  windSrc.connect(roar).connect(roarG).connect(air);

  // ---- Inside the suit: life-support fan hum ----
  const fanSrc = noiseSrc();
  const fanF = filter('lowpass', 380, 0.6), fanG = gain(0.035);
  fanSrc.connect(fanF).connect(fanG).connect(scene);
  fanSrc.start();
  const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 118;
  const humG = gain(0.006);
  hum.connect(humG).connect(scene);
  hum.start();

  // ---- Breathing: scheduled inhale/exhale, rate and depth from effort and CO₂ ----
  let nextBreath = now() + 1;
  let breathRate = 12, breathDepth = 0.05;
  const breath = (t: number, inhale: boolean, len: number) => {
    const n = noiseSrc(false);
    const f = filter('bandpass', inhale ? 1100 : 700, inhale ? 1.4 : 1.0);
    const g = gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(breathDepth * (inhale ? 0.8 : 1), t + len * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    n.connect(f).connect(g).connect(scene);
    n.start(t, Math.random() * 1.5); n.stop(t + len + 0.05);
  };
  const scheduleBreaths = () => {
    // Never let a bad number stop the breathing for good (NaN times would never come round).
    if (!Number.isFinite(nextBreath) || nextBreath > now() + 10) nextBreath = now() + 0.2;
    while (nextBreath < now() + 0.3) {
      const cycle = 60 / breathRate;
      const t = Math.max(nextBreath, now() + 0.02);
      breath(t, true, cycle * 0.38);
      breath(t + cycle * 0.45, false, cycle * 0.45);
      nextBreath = t + cycle;
    }
  };

  // ---- One-shot sounds ----
  const tone = (t: number, freq: number, dur: number, peak: number, type: OscillatorType = 'sine', to?: number) => {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = gain(); env(g, t, peak, 0.006, dur);
    o.connect(g).connect(scene); o.start(t); o.stop(t + dur + 0.05);
  };
  const burst = (t: number, type: BiquadFilterType, freq: number, dur: number, peak: number, dest: AudioNode = scene, q = 0.8) => {
    const n = noiseSrc(false); const f = filter(type, freq, q); const g = gain(); env(g, t, peak, 0.004, dur);
    n.connect(f).connect(g).connect(dest); n.start(t, Math.random() * 1.5); n.stop(t + dur + 0.05);
  };
  const thud = (t: number, peak: number) => tone(t, 95, 0.18, peak, 'sine', 40);

  const cue = (c: GameCue) => {
    const t = now() + 0.01;
    switch (c) {
      case 'pickup': burst(t, 'bandpass', 900, 0.06, 0.12); tone(t + 0.04, 660, 0.09, 0.06); tone(t + 0.12, 990, 0.12, 0.05); break;
      case 'drop': thud(t, 0.35); burst(t, 'lowpass', 500, 0.25, 0.1, air); break;
      case 'store': thud(t, 0.25); thud(t + 0.16, 0.2); tone(t + 0.3, 520, 0.1, 0.04); break;
      case 'use-o2': burst(t, 'highpass', 2200, 0.9, 0.12); tone(t + 0.85, 880, 0.15, 0.05); break; // gas hiss
      case 'use-lioh': thud(t, 0.3); burst(t + 0.05, 'bandpass', 1800, 0.05, 0.12); tone(t + 0.25, 740, 0.12, 0.05); break; // canister clunk, latch
      case 'use-water': {
        for (let i = 0; i < 6; i++) tone(t + i * 0.07, 260 + Math.random() * 160, 0.08, 0.06, 'sine', 180);
        break;
      }
      case 'use-battery': burst(t, 'bandpass', 2400, 0.03, 0.15); tone(t + 0.05, 420, 0.45, 0.05, 'triangle', 980); break;
      case 'done': tone(t, 523, 0.18, 0.06); tone(t + 0.12, 659, 0.18, 0.06); tone(t + 0.24, 784, 0.3, 0.06); break;
      case 'rover': {
        burst(t, 'bandpass', 1500, 0.7, 0.08, scene, 0.5); // radio static
        tone(t + 0.55, 1200, 0.1, 0.05, 'square'); tone(t + 0.7, 1500, 0.14, 0.05, 'square');
        break;
      }
      case 'call': {
        burst(t, 'bandpass', 1500, 0.4, 0.06, scene, 0.5);
        for (let i = 0; i < 14; i++) tone(t + 0.35 + i * 0.09, 900 + ((i * 337) % 900), 0.07, 0.035, 'square'); // data burst
        tone(t + 1.7, 784, 0.25, 0.06); tone(t + 1.95, 1046, 0.4, 0.06);
        break;
      }
      case 'storm-warning': tone(t, 880, 0.22, 0.05, 'square'); tone(t + 0.3, 660, 0.22, 0.05, 'square'); tone(t + 0.6, 440, 0.4, 0.05, 'square'); break;
      case 'blocked': tone(t, 220, 0.15, 0.05, 'triangle'); break;
      default: break;
    }
  };

  const step = (run: boolean) => {
    const t = now() + 0.005;
    // Felt through the boots (a soft low thump) plus regolith crunch, muffled by the thin air.
    tone(t, run ? 75 : 65, 0.09, run ? 0.07 : 0.05, 'sine', 40);
    burst(t, 'bandpass', 700 + Math.random() * 300, run ? 0.09 : 0.07, run ? 0.16 : 0.11, air, 1.1);
  };

  // ---- Alarm (O₂) ----
  let alarmTimer: ReturnType<typeof setInterval> | null = null;
  let alarmLevel: 'low' | 'critical' | null = null;
  const alarm = (level: 'low' | 'critical' | null) => {
    if (level === alarmLevel) return;
    alarmLevel = level;
    if (alarmTimer) { clearInterval(alarmTimer); alarmTimer = null; }
    if (!level) return;
    const beep = () => {
      const t = now() + 0.01;
      if (level === 'critical') { tone(t, 1400, 0.12, 0.07, 'square'); }
      else { tone(t, 1000, 0.1, 0.05, 'square'); tone(t + 0.18, 1000, 0.1, 0.05, 'square'); }
    };
    beep();
    alarmTimer = setInterval(beep, level === 'critical' ? 650 : 4500);
  };

  // ---- Repair / build: welding crackle ----
  let workTimer: ReturnType<typeof setInterval> | null = null;
  const work = (on: boolean) => {
    if (workTimer) { clearInterval(workTimer); workTimer = null; }
    if (!on) return;
    workTimer = setInterval(() => {
      const t = now() + 0.005;
      if (Math.random() < 0.7) burst(t, 'bandpass', 2500 + Math.random() * 2000, 0.04 + Math.random() * 0.08, 0.08 + Math.random() * 0.08, scene, 1.5);
      if (Math.random() < 0.15) tone(t, 120, 0.2, 0.03, 'sawtooth');
    }, 70);
  };

  // ---- Continuous update from the game state (about 15 times a second) ----
  let gust = 0, gustTarget = 0.5, nextGust = 0;
  const update = (s: GameSoundState) => {
    if (now() > nextGust) { gustTarget = 0.35 + Math.random() * 0.65; nextGust = now() + 1.5 + Math.random() * 3; }
    gust += (gustTarget - gust) * 0.08;
    const w = windLevel(s.windMS, s.storm) * (s.night ? 0.8 : 1) * (0.6 + 0.4 * gust);
    smooth(windLowG.gain, 0.22 * w, 0.5);
    smooth(windHighG.gain, 0.09 * w * (0.4 + s.storm), 0.5);
    smooth(roarG.gain, 0.5 * s.storm, 0.8);
    smooth(gritG.gain, s.inCabin ? 0 : 0.035 * s.storm * (0.5 + gust), 0.3);
    smooth(air.frequency, s.inCabin ? 520 : 1800 - 500 * s.storm, 0.6);
    smooth(outside.gain, s.inCabin ? 0.35 : 1, 0.6);
    smooth(scene.gain, s.paused ? 0.35 : 1, 0.3);
    const effort = Number.isFinite(s.effortW) ? s.effortW : 100, co2 = Number.isFinite(s.co2KPa) ? s.co2KPa : 0;
    breathRate = breathsPerMin(effort, co2);
    breathDepth = 0.035 + Math.min(0.06, Math.max(0, effort - 100) / 6000);
    scheduleBreaths();
  };

  let muted = false;
  const setMuted = (m: boolean) => { muted = m; smooth(master.gain, muted ? 0 : 0.85, 0.1); };

  const dispose = () => {
    alarm(null); work(false);
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    master.gain.setTargetAtTime(0, now(), 0.15);
    setTimeout(() => { void ctx.close(); }, 400);
  };

  return { update, step, cue, alarm, work, setMuted, dispose };
}
