// Intro sound, made in the browser with the Web Audio API (no audio files): engine rumble, the meteor strike,
// the master alarm, radio static and squelch, re-entry roar, the impact, the hatch, and Mars wind.
// The radio voice is the browser's speech synthesis; captions are always shown as well.

export type IntroCue = 'cruise' | 'meteor' | 'fault' | 'crash' | 'door';

export interface RadioLine {
  /** Caption label, e.g. who is calling. */
  from: string;
  text: string;
}

/** The two radio calls in the intro (story: proposal §1, the lander radio dies and Perseverance is the way home). */
export const RADIO: Record<'mayday' | 'rover', RadioLine> = {
  mayday: {
    from: 'AER CONTROL · EARTH',
    text: "Mayday, mayday. AER-1, this is Control. A meteor has hit your engine. You can't make it home. Divert to Mars, the nearest planet, and prepare for an emergency landing.",
  },
  rover: {
    from: 'SUIT RADIO · STORED MESSAGE',
    text: "AER-1, if you hear this, you made it down. Your ship's radio is gone. NASA's Perseverance rover is about two kilometres west of you. Find it, and use its radio to call Earth. Control out.",
  },
};

/** Roughly how long a caption takes to read, for when sound is off. */
export const readingMs = (text: string) => 1200 + text.split(/\s+/).length * 300;

/** Novelty voices on macOS and elsewhere that would spoil the radio call. */
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|hysterical|deranged|pipe|junior|ralph|fred|kathy|princess|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;
const PREFERRED = ['Daniel', 'Samantha', 'Alex', 'Karen', 'Moira', 'Google UK English Male', 'Google US English', 'Microsoft Guy', 'Microsoft David', 'Microsoft Mark'];

/** A clear English voice for the radio, or null to use the browser's default. */
export function pickVoice<V extends { name: string; lang: string }>(voices: readonly V[]): V | null {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en') && !NOVELTY.test(v.name));
  for (const name of PREFERRED) {
    const v = english.find((x) => x.name.startsWith(name));
    if (v) return v;
  }
  return english[0] ?? null;
}

export interface IntroAudio {
  /** Sounds for the start of an intro phase. */
  cue(phase: IntroCue): void;
  /** Play a radio call: squelch, static under the voice, roger beep. `onEnd` runs once when it is over. */
  radio(text: string, onEnd: () => void): void;
  /** Cut the radio off mid-sentence (the impact). */
  cutRadio(): void;
  /** Fade everything out and release the audio device. */
  stop(fadeSec?: number): void;
}

/** Create the intro audio. Call from a click (browsers only allow sound after the player interacts). */
export function createIntroAudio(): IntroAudio | null {
  const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext;
  try { ctx = new AC(); } catch { return null; }
  void ctx.resume();
  const synth = typeof window.speechSynthesis !== 'undefined' ? window.speechSynthesis : null;

  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  // Two seconds of white noise, looped wherever noise is needed.
  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const now = () => ctx.currentTime;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (sec: number, fn: () => void) => { timers.push(setTimeout(fn, sec * 1000)); };
  let stopped = false;

  const noiseSrc = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; return s; };
  const filter = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;
  };
  const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  /** Envelope: up to `peak` in `attack`, then down to silence over `release`. */
  const env = (g: GainNode, t: number, peak: number, attack: number, release: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  };

  /** A bang: a falling low thump and a burst of filtered noise. `big` for the crash. */
  const bang = (at: number, big: boolean) => {
    const t = now() + at, len = big ? 2.4 : 0.9;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(big ? 95 : 160, t);
    o.frequency.exponentialRampToValueAtTime(big ? 24 : 45, t + len * 0.6);
    const og = gain(); env(og, t, big ? 1 : 0.7, 0.005, len);
    o.connect(og).connect(master); o.start(t); o.stop(t + len + 0.1);
    const n = noiseSrc(); const f = filter('lowpass', big ? 2400 : 3200);
    f.frequency.setValueAtTime(big ? 2400 : 3200, t);
    f.frequency.exponentialRampToValueAtTime(big ? 120 : 300, t + len);
    const ng = gain(); env(ng, t, big ? 0.9 : 0.6, 0.004, len * 0.8);
    n.connect(f).connect(ng).connect(master); n.start(t); n.stop(t + len + 0.1);
  };

  /** A rushing sweep of noise; `pan` moves it across the stereo field. */
  const whoosh = (at: number, dur: number, from: number, to: number, peak: number, pan?: [number, number]) => {
    const t = now() + at;
    const n = noiseSrc(); const f = filter('bandpass', from, 1.4);
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = gain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = g;
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.setValueAtTime(pan[0], t); p.pan.linearRampToValueAtTime(pan[1], t + dur);
      g.connect(p); out = p;
    }
    n.connect(f).connect(g); out.connect(master); n.start(t); n.stop(t + dur + 0.05);
  };

  /** A steady sound that can be faded out later. */
  const held: { g: GainNode; stop: (t: number) => void }[] = [];
  const hold = (g: GainNode, stop: (t: number) => void) => { held.push({ g, stop }); return { g, stop }; };
  const release = (h: { g: GainNode; stop: (t: number) => void } | null, sec: number) => {
    if (!h) return;
    const t = now();
    h.g.gain.cancelScheduledValues(t); h.g.gain.setValueAtTime(Math.max(0.0001, h.g.gain.value), t);
    h.g.gain.exponentialRampToValueAtTime(0.0001, t + sec);
    h.stop(t + sec + 0.05);
  };

  // Engine rumble while cruising (low brown-ish noise).
  let rumble: ReturnType<typeof hold> | null = null;
  const startRumble = () => {
    const n = noiseSrc(); const f = filter('lowpass', 140); const g = gain(0.0001);
    g.gain.setValueAtTime(0.0001, now()); g.gain.exponentialRampToValueAtTime(0.35, now() + 0.8);
    n.connect(f).connect(g).connect(master); n.start();
    rumble = hold(g, (t) => n.stop(t));
  };

  // Master alarm: a rising "whoop", repeated.
  let alarm: ReturnType<typeof hold> | null = null;
  const startAlarm = () => {
    const o = ctx.createOscillator(); o.type = 'square';
    const f = filter('lowpass', 1800); const g = gain(0.0001);
    const t0 = now();
    for (let i = 0; i < 40; i++) {
      const t = t0 + i * 0.62;
      o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(980, t + 0.42);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.04);
      g.gain.setValueAtTime(0.09, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    }
    o.connect(f).connect(g).connect(master); o.start();
    alarm = hold(g, (t) => o.stop(t));
  };

  // Mars wind: low noise with a slow gust; muffled inside the cabin, opened up once the hatch is open.
  let wind: (ReturnType<typeof hold> & { f: BiquadFilterNode }) | null = null;
  const startWind = () => {
    const n = noiseSrc(); const f = filter('lowpass', 220); const g = gain(0.0001);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
    const depth = gain(90); lfo.connect(depth).connect(f.frequency); lfo.start();
    g.gain.setValueAtTime(0.0001, now()); g.gain.exponentialRampToValueAtTime(0.12, now() + 1.5);
    n.connect(f).connect(g).connect(master); n.start();
    wind = { ...hold(g, (t) => { n.stop(t); lfo.stop(t); }), f };
  };

  /** Ringing ears after the impact. */
  const tinnitus = () => {
    const t = now(); const o = ctx.createOscillator(); o.frequency.value = 4100;
    const g = gain(); env(g, t, 0.035, 0.3, 4.5);
    o.connect(g).connect(master); o.start(t); o.stop(t + 5);
  };

  /** Short beep. */
  const beep = (at: number, freq: number, dur: number, vol = 0.12) => {
    const t = now() + at; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = gain(); g.gain.setValueAtTime(vol, t); g.gain.setValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  /** Radio squelch: a crackle of band-limited noise. */
  const squelch = (at: number) => {
    const t = now() + at; const n = noiseSrc(); const f = filter('bandpass', 2600, 0.9);
    const g = gain(); env(g, t, 0.28, 0.005, 0.16);
    n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.25);
  };

  // Radio static under the voice, crackling at random.
  let radioBed: ReturnType<typeof hold> | null = null;
  let radioDone: (() => void) | null = null;
  const startStatic = () => {
    const n = noiseSrc(); const hp = filter('highpass', 400); const bp = filter('bandpass', 1900, 0.6);
    const g = gain(0.0001); const t0 = now();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.1);
    for (let i = 0; i < 160; i++) { // crackles over ~25 s
      const t = t0 + 0.2 + i * 0.16 + Math.random() * 0.1;
      const v = Math.random() < 0.18 ? 0.14 : 0.04 + Math.random() * 0.03;
      g.gain.setValueAtTime(v, t);
    }
    n.connect(hp).connect(bp).connect(g).connect(master); n.start();
    radioBed = hold(g, (t) => n.stop(t));
  };
  const endRadio = (cut: boolean) => {
    release(radioBed, cut ? 0.05 : 0.25); radioBed = null;
    if (!cut) { squelch(0.05); beep(0.22, 1250, 0.09); }
    const done = radioDone; radioDone = null; done?.();
  };

  return {
    cue(phase) {
      if (stopped) return;
      if (phase === 'cruise') startRumble();
      if (phase === 'meteor') {
        whoosh(0, 1.15, 500, 3200, 0.5, [0.8, -0.1]); // the meteor coming in from the right
        bang(1.1, false); // it hits the rocket
        later(1.1, () => { if (rumble) { rumble.g.gain.cancelScheduledValues(now()); rumble.g.gain.setTargetAtTime(0.12, now(), 0.3); } });
      }
      if (phase === 'fault') startAlarm();
      if (phase === 'crash') {
        release(rumble, 0.6); rumble = null;
        whoosh(0, 1.25, 180, 1400, 0.7); // re-entry roar
        later(1.25, () => {
          bang(0, true);
          release(alarm, 0.05); alarm = null;
          if (radioBed || radioDone) { if (synth) synth.cancel(); endRadio(true); }
          tinnitus();
        });
      }
      if (phase === 'door') {
        startWind();
        later(1.0, () => { // hatch release: clunk and the hiss of the last air going out
          bang(0, false); beep(0.1, 880, 0.12, 0.08);
          whoosh(0.05, 1.5, 6000, 2500, 0.3);
        });
        later(1.25, () => { // the hatch motor
          const t = now(); const o = ctx.createOscillator(); o.type = 'sawtooth';
          o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(130, t + 1.8);
          const f = filter('lowpass', 520); const g = gain(); env(g, t, 0.1, 0.15, 1.8);
          o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 2.1);
        });
        later(3.1, () => { bang(0, false); if (wind) wind.f.frequency.setTargetAtTime(650, now(), 0.6); });
      }
    },
    radio(text, onEnd) {
      if (stopped) { onEnd(); return; }
      radioDone = onEnd;
      squelch(0); beep(0.12, 1250, 0.09);
      startStatic();
      if (!synth) { later(readingMs(text) / 1000, () => endRadio(false)); return; }
      later(0.35, () => {
        if (stopped || !radioDone) return;
        const u = new SpeechSynthesisUtterance(text);
        const voice = pickVoice(synth.getVoices());
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = 1.12; u.pitch = 0.9; u.volume = 1;
        u.onend = () => endRadio(false);
        u.onerror = () => endRadio(false);
        synth.cancel();
        synth.speak(u);
        // Some browsers never fire onend; don't let the intro wait for ever.
        later(readingMs(text) / 1000 + 6, () => { if (radioDone) endRadio(false); });
      });
    },
    cutRadio() {
      if (synth) synth.cancel();
      if (radioBed || radioDone) endRadio(true);
    },
    stop(fadeSec = 0.6) {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearTimeout);
      radioDone = null;
      if (synth) synth.cancel();
      const t = now();
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0, t + fadeSec);
      setTimeout(() => { held.forEach((h) => { try { h.stop(0); } catch { /* already stopped */ } }); void ctx.close(); }, fadeSec * 1000 + 100);
    },
  };
}
