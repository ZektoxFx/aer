"""Compose and render AER's two music tracks from scratch: no samples, no recordings, only code.

  aer_title.wav  "Jezero"  - title theme, ~1:48 at 80 BPM: wind and a soft drone, warm chords, a voice singing a
                             hopeful hook, taiko and frame drums building to a big brass climax that resolves to
                             D major, then back to the quiet start (loops).
  aer_storm.wav  "Haboob"  - storm music, ~1:17 at 100 BPM: driving taiko and frame drums, a pulsing bass riff,
                             the same chords and hook, tense but heroic rather than frightening.

Original music in the style of epic desert film scores, written to feel majestic and hopeful, not scary: D minor
with the classic uplifting progression Dm - Bb - F - C, warm major chords, and a resolution to D major at the
climax. The melodies are written here; nothing is copied from any film score.

Everything is synthesized with NumPy/SciPy at 48 kHz stereo:
- Voice: additive synthesis of a glottal source shaped by three vowel formants, with short glides, gentle vibrato,
  jitter and breath noise.
- Pads and brass: detuned saws through low-passes (brass swells open the filter).
- Throat singing (intro only, quiet): a drone whose moving resonance makes single overtones whistle.
- Taiko and frame drums: pitch-dropping sines with skin noise.
- Wind: filtered noise. Space: convolution reverb with a synthetic hall impulse.

Usage: python compose.py OUT_DIR   (then tools/audio/bake_audio.py levels and encodes them)
"""
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, lfilter, sosfilt

SR = 48000
rng = np.random.default_rng(1985)


def midi_hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def secs(n):
    return np.arange(n) / SR


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)


class Mix:
    """Stereo dry bus plus a reverb send."""

    def __init__(self, seconds):
        self.n = int(seconds * SR)
        self.dry = np.zeros((2, self.n))
        self.send = np.zeros((2, self.n))

    def add(self, sig, at, gain=1.0, pan=0.0, verb=0.3):
        i = int(at * SR)
        if i >= self.n:
            return
        s = sig[: self.n - i] * gain
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        self.dry[0, i:i + len(s)] += s * l * (1 - verb * 0.5)
        self.dry[1, i:i + len(s)] += s * r * (1 - verb * 0.5)
        self.send[0, i:i + len(s)] += s * l * verb
        self.send[1, i:i + len(s)] += s * r * verb

    def render(self, rt=3.6, wet=0.55):
        ir_n = int(rt * 1.3 * SR)
        t = secs(ir_n)
        decay = np.exp(-6.9 * t / rt)
        ir = []
        for _ in range(2):
            raw = rng.standard_normal(ir_n)
            dark = lowpass(raw, 2500)
            mix = np.clip(t / rt, 0, 1)  # the tail gets darker
            ir_c = (raw * (1 - mix) + dark * mix * 1.6) * decay
            ir_c[: int(0.025 * SR)] = 0  # pre-delay
            ir.append(ir_c / np.sqrt(np.sum(ir_c ** 2)))
        out = self.dry.copy()
        for c in range(2):
            out[c] += fftconvolve(self.send[c], ir[c])[: self.n] * wet
        out = highpass(out, 25)
        peak = np.max(np.abs(out))
        out = np.tanh(out / peak * 1.4) / np.tanh(1.4)  # gentle glue
        return out


# ---------------------------------------------------------------- instruments

VOWELS = {  # formant centre (Hz) and bandwidth (Hz), female voice
    "a": ((850, 90), (1220, 110), (2810, 160)),
    "o": ((500, 80), (880, 100), (2700, 150)),
    "u": ((350, 70), (800, 90), (2550, 150)),
    "e": ((480, 80), (1900, 120), (2850, 160)),
}


def voice(notes, vowels, vib=0.22, breath=0.03, growl=0.0, base_amp=1.0, tilt=1.2):
    """A sung line. notes: [(midi, dur_s, slide_s)], legato. vowels: [(t, vowel)] keyframes."""
    total = sum(d for _, d, _ in notes) + 1.2
    n = int(total * SR)
    t = secs(n)
    # Pitch keyframes: each note slides in from the previous over `slide`.
    kt, km = [0.0], [notes[0][0]]
    at = 0.0
    for m, d, s in notes:
        kt += [at + max(0.001, min(s, d * 0.9)), at + d]
        km += [m, m]
        at += d
    kt.append(total)
    km.append(notes[-1][0])
    pitch = np.interp(t, kt, km)
    pitch = lfilter([0.004], [1, -0.996], pitch - pitch[0]) + pitch[0]  # soften the corners
    # Vibrato grows through each held note.
    since = np.zeros(n)
    at = 0.0
    for m, d, s in notes:
        a, b = int(at * SR), int((at + d) * SR)
        since[a:b] = secs(b - a)
        at += d
    vib_depth = vib * np.clip((since - 0.35) / 0.8, 0, 1)
    rate = 5.3 + 0.4 * np.sin(2 * np.pi * 0.21 * t)
    vphase = 2 * np.pi * np.cumsum(rate) / SR
    jitter = lfilter([0.002], [1, -0.998], rng.standard_normal(n)) * 0.6
    f0 = midi_hz(pitch + vib_depth * np.sin(vphase) + jitter)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    # Formants, interpolated between vowel keyframes.
    vt = [v[0] for v in vowels]
    fm = [[np.interp(t, vt, [VOWELS[v][i][j] for _, v in vowels]) for j in range(2)] for i in range(3)]
    # Brighter (more open) when louder: raise F1 a little on high notes.
    lift = np.clip((pitch - 67) / 10, 0, 1)
    fm[0][0] = fm[0][0] * (1 + 0.15 * lift)
    out = np.zeros(n)
    for k in range(1, 48):
        fk = k * f0
        if np.min(fk) > SR / 2 - 2000:
            break
        env = 0.02
        for (fc, bw), g in zip(fm, (1.0, 0.55, 0.3)):
            env = env + g / (1 + ((fk - fc) / (bw / 2)) ** 2)
        amp = env * k ** -tilt * (fk < SR / 2 - 2000)
        out += amp * np.sin(k * phase)
    if growl:
        out += growl * np.sin(phase * 0.5) * np.abs(np.sin(phase)) * 0.4  # subharmonic roughness
    out += breath * bandpass(rng.standard_normal(n), 900, 5000) * (0.5 + 0.5 * np.abs(np.sin(phase)))
    # Phrase envelope: swell in, swell out, plus a little shimmer.
    amp = np.clip(t / 0.35, 0, 1) * np.clip((total - 1.2 - t) / 1.0 + 1, 0, 1)
    amp *= 1 + 0.06 * lfilter([0.003], [1, -0.997], rng.standard_normal(n))
    amp *= 0.75 + 0.25 * np.clip((pitch - 60) / 15, 0, 1)  # high notes ring out
    sig = out * amp * base_amp
    return sig / (np.max(np.abs(sig)) + 1e-9)


def throat_drone(seconds, root=38, path=((0, 8), (1, 8))):
    """Overtone singing on `root` (MIDI). path: [(t_fraction, harmonic)] the whistling overtone follows."""
    n = int(seconds * SR)
    t = secs(n)
    f0 = midi_hz(root) * (1 + 0.002 * np.sin(2 * np.pi * 0.13 * t))
    phase = 2 * np.pi * np.cumsum(f0) / SR
    target = np.interp(t / seconds, [p[0] for p in path], [p[1] for p in path])
    target = lfilter([0.0005], [1, -0.9995], target - target[0]) + target[0]
    peak_f = target * f0
    out = np.zeros(n)
    for k in range(1, 40):
        fk = k * f0
        body = 1 / (1 + ((fk - 300) / 200) ** 2)  # chest resonance
        whistle = 3.5 / (1 + ((fk - peak_f) / 25) ** 2)  # the narrow, moving resonance
        out += (body + whistle) * k ** -1.0 * np.sin(k * phase)
    env = np.clip(t / 4, 0, 1) * np.clip((seconds - t) / 4, 0, 1)
    return out * env / np.max(np.abs(out))


def drone(seconds, notes=(26, 38, 45), bright=500):
    """Deep string-and-synth bed: detuned saws through a low-pass that breathes."""
    n = int(seconds * SR)
    t = secs(n)
    out = np.zeros(n)
    for m in notes:
        for det in (-0.06, 0.0, 0.07):
            f = midi_hz(m + det)
            ph = 2 * np.pi * f * t + rng.uniform(0, 6.28)
            for k in range(1, int(bright * 2 / f) + 2):
                out += (1 / k) * np.sin(k * ph) / (1 + (k * f / bright) ** 2)
    out *= 0.85 + 0.15 * np.sin(2 * np.pi * 0.07 * t)
    env = np.clip(t / 6, 0, 1) * np.clip((seconds - t) / 6, 0, 1)
    return out * env / np.max(np.abs(out))


def taiko(size=1.0):
    n = int(1.6 * SR)
    t = secs(n)
    f = (42 + 70 * np.exp(-t / 0.045)) * (1.15 - 0.15 * size)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.32 + 0.25 * size))
    skin = lowpass(rng.standard_normal(n), 1800) * np.exp(-t / 0.025) * 0.9
    shell = bandpass(rng.standard_normal(n), 120, 400) * np.exp(-t / 0.12) * 0.5
    s = body + skin + shell
    return np.tanh(s * 1.6) / np.tanh(1.6)


def doum():
    n = int(0.6 * SR)
    t = secs(n)
    f = 70 + 60 * np.exp(-t / 0.02)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18)
    s += lowpass(rng.standard_normal(n), 2500) * np.exp(-t / 0.01) * 0.6
    return s


def tek(open_=False):
    n = int(0.3 * SR)
    t = secs(n)
    s = bandpass(rng.standard_normal(n), 1800, 7000) * np.exp(-t / (0.05 if open_ else 0.022))
    s += np.sin(2 * np.pi * 420 * t) * np.exp(-t / 0.03) * 0.5
    return s


def shaker():
    n = int(0.12 * SR)
    t = secs(n)
    return bandpass(rng.standard_normal(n), 5000, 12000) * np.exp(-t / 0.03) * np.clip(t / 0.01, 0, 1)


def braam(seconds=4.0, notes=(26, 33, 38), open_s=1.4, drive=1.3, top=2200):
    """A brass-and-synth swell: the filter opens, holds, and closes."""
    n = int(seconds * SR)
    t = secs(n)
    cut = 150 + top * np.clip(t / open_s, 0, 1) ** 1.5 * np.exp(-np.clip(t - open_s, 0, None) / (seconds * 0.5))
    out = np.zeros(n)
    for m in notes:
        for det in (-0.09, -0.03, 0.04, 0.1):
            f = midi_hz(m + det)
            ph = 2 * np.pi * f * t + rng.uniform(0, 6.28)
            for k in range(1, int(3200 / f)):
                out += (1 / k) * np.sin(k * ph) / (1 + (k * f / cut) ** 4)
    env = np.clip(t / 0.25, 0, 1) * np.clip((seconds - t) / 1.2, 0, 1)
    out = np.tanh(out / np.max(np.abs(out)) * drive) * env
    return out / np.max(np.abs(out))


def wind(seconds, gusts=0.2):
    n = int(seconds * SR)
    t = secs(n)
    w = bandpass(rng.standard_normal(n), 180, 900) + 0.4 * bandpass(rng.standard_normal(n), 900, 3000)
    g = lfilter([0.00002], [1, -0.99998], rng.standard_normal(n))
    g = (g - g.min()) / (np.ptp(g) + 1e-9)
    w *= 0.4 + 0.6 * g * (1 + gusts * np.sin(2 * np.pi * 0.05 * t))
    env = np.clip(t / 5, 0, 1) * np.clip((seconds - t) / 5, 0, 1)
    return w * env / np.max(np.abs(w))


# ---------------------------------------------------------------- harmony

CHORDS = {  # warm voicings, MIDI
    "Dm": (38, 50, 53, 57, 62), "Bb": (34, 46, 50, 53, 58), "F": (41, 48, 53, 57, 60),
    "C": (36, 48, 52, 55, 60), "D": (38, 50, 54, 57, 62),
}
LOW = {k: v[:4] for k, v in CHORDS.items()}  # for brass


def pad(chords, bright=1300):
    """Sustained strings-and-synth chords. chords: [(start_s, dur_s, name)]. Each swells in and rings out."""
    total = max(s + d for s, d, _ in chords) + 3
    out = np.zeros(int(total * SR))
    for s, d, name in chords:
        n = int((d + 2.5) * SR)
        tt = secs(n)
        seg = np.zeros(n)
        for m in CHORDS[name]:
            for det in (-0.07, 0.0, 0.08):
                f = midi_hz(m + det)
                ph = 2 * np.pi * f * tt + rng.uniform(0, 6.28)
                for k in range(1, int(bright * 2 / f) + 2):
                    seg += (1 / k) * np.sin(k * ph) / (1 + (k * f / bright) ** 2)
        env = np.clip(tt / 1.2, 0, 1) * np.where(tt < d, 1.0, np.exp(-(tt - d) / 0.9))
        i = int(s * SR)
        out[i:i + n] += seg * env
    return out / np.max(np.abs(out))


def line(notes, beat):
    """[(midi, beats)] or [(midi, beats, slide_s)] -> voice() notes in seconds (short, sung slides)."""
    return [(n[0], n[1] * beat, n[2] if len(n) > 2 else 0.08) for n in notes]


PROG = ["Dm", "Bb", "F", "C"]

# The hook, in beats, one chord (two bars) per row. ANSWER lifts it; CLIMAX sings it up high.
HOOK = [(69, 2), (74, 2), (72, 1), (69, 1), (67, 2),
        (65, 2), (67, 1), (69, 1), (70, 4),
        (72, 2), (69, 2), (65, 2), (67, 2),
        (64, 2), (67, 2), (69, 4)]
ANSWER = [(69, 2), (74, 2), (76, 1), (74, 1), (72, 2),
          (70, 2), (72, 1), (74, 1), (77, 4),
          (77, 2), (76, 1), (74, 1), (72, 2), (69, 2),
          (72, 3), (74, 1), (76, 4)]
CLIMAX = [(74, 1), (77, 1), (81, 2), (79, 1), (77, 1), (76, 2),
          (74, 2), (77, 2), (79, 4),
          (81, 2), (79, 1), (77, 1), (76, 2), (77, 2),
          (79, 4), (76, 2), (79, 2)]
RESOLVE = [(77, 2), (79, 2), (76, 2), (79, 2), (78, 3, 0.12), (81, 5, 0.15)]  # Bb, C, then D major
OUTRO = [(69, 4), (67, 2), (65, 2), (62, 8)]


# ---------------------------------------------------------------- pieces

def title():
    beat = 60 / 80
    bar = beat * 4
    L = 36 * bar  # 108 s
    m = Mix(L)
    m.add(wind(L, 0.1), 0, 0.14, 0, 0.2)
    m.add(drone(L, (26, 38), 260), 0, 0.14, 0, 0.3)  # soft D pedal
    m.add(throat_drone(8 * bar, 38, ((0, 8), (0.4, 10), (0.7, 12), (1, 10))), 0, 0.12, -0.3, 0.5)

    # Chords: intro Dm, three times round Dm Bb F C, the resolution Bb C D, and the outro on Dm.
    plan = [(0, "Dm")]
    for cyc in range(3):
        for i, c in enumerate(PROG):
            plan.append((4 + cyc * 8 + i * 2, c))
    plan += [(28, "Bb"), (29, "C"), (30, "D"), (32, "Dm")]
    ends = [b for b, _ in plan[1:]] + [36]
    chords = [(b * bar, (e - b) * bar, c) for (b, c), e in zip(plan, ends)]
    m.add(pad(chords, 1200), 0, 0.42, 0, 0.45)
    m.add(pad([x for x in chords if x[0] >= 12 * bar], 2600), 0, 0.16, 0.3, 0.5)  # brighter layer later

    # Drums grow: soft taiko from bar 4, frame drums from 12, full from 20; quiet for the outro.
    for b in range(4, 32):
        at = b * bar
        m.add(taiko(1.0 if b % 2 == 0 else 0.8), at, 0.5 if b < 12 else 0.7 if b < 20 else 0.85, 0.0, 0.35)
        if b >= 12:
            m.add(taiko(0.7), at + beat * 2.5, 0.45, 0.15, 0.35)
            for off, s in ((0, doum), (1, tek), (1.5, tek), (2, doum), (3, tek), (3.5, tek)):
                m.add(s(), at + off * beat, 0.26, -0.35 if s is doum else 0.35, 0.25)
        if b >= 20:
            for e in range(8):
                m.add(shaker(), at + e * beat / 2, 0.05, 0.6, 0.2)
            for off in (0.75, 1.0, 3.0, 3.25):
                m.add(taiko(0.6), at + off * beat, 0.42, -0.2, 0.35)

    # Brass on each chord of the climax and the resolution.
    for b, c in [(20, "Dm"), (22, "Bb"), (24, "F"), (26, "C"), (28, "Bb"), (29, "C")]:
        m.add(braam(bar * 2.2 if b < 28 else bar * 1.2, LOW[c], 1.0), b * bar, 0.4, 0.0, 0.4)
    m.add(braam(bar * 2.6, LOW["D"], 0.8, drive=1.2, top=2600), 30 * bar, 0.5, 0.0, 0.45)

    # Voice: the hook (bar 4), the answer (bar 12), the climax and resolution (bar 20), the outro (bar 32).
    m.add(voice(line(HOOK, beat), [(0, "o"), (6, "a"), (20, "o")]), 4 * bar, 0.55, 0.1, 0.5)
    m.add(voice(line(ANSWER, beat), [(0, "a"), (14, "a"), (20, "o")]), 12 * bar, 0.6, -0.05, 0.5)
    m.add(voice(line(CLIMAX + RESOLVE, beat), [(0, "a"), (30, "a"), (34, "o")], vib=0.26), 20 * bar, 0.7, 0.0, 0.55)
    m.add(voice(line(OUTRO, beat), [(0, "o"), (6, "u")], vib=0.18, breath=0.04), 32 * bar, 0.42, 0.1, 0.55)
    return m.render(rt=3.4, wet=0.5)


def storm():
    beat = 60 / 100
    bar = beat * 4
    L = 32 * bar  # 76.8 s
    m = Mix(L)
    m.add(wind(L, 0.5), 0, 0.17, 0, 0.15)
    chords = [(b * bar, 2 * bar, PROG[(b // 2) % 4]) for b in range(0, 32, 2)]
    m.add(pad(chords, 1000), 0, 0.3, 0, 0.35)
    # Bass riff, eighths on the chord root: root, root, fifth, root, octave, root, fifth, root.
    for b in range(1, 31):
        root = CHORDS[PROG[(b // 2) % 4]][0] - 12
        for e, iv in enumerate((0, 0, 7, 0, 12, 0, 7, 0)):
            n = int(beat / 2 * 0.85 * SR)
            tt = secs(n)
            f = midi_hz(root + iv)
            s = sum(np.sin(2 * np.pi * k * f * tt) / k for k in range(1, 12)) * np.exp(-tt / 0.13)
            s = lowpass(s, 800)
            m.add(s / np.max(np.abs(s)), b * bar + e * beat / 2, 0.32, -0.15, 0.15)
    for b in range(0, 31):
        at = b * bar
        m.add(taiko(1.0), at, 0.85, 0, 0.3)
        m.add(taiko(0.8), at + beat * 2, 0.65, 0.1, 0.3)
        if b >= 4:
            for s16 in range(16):
                pat = "D.tkD.tk.tD.tkt."[s16]
                if pat == "D":
                    m.add(doum(), at + s16 * beat / 4, 0.28, -0.3, 0.2)
                elif pat in "tk":
                    m.add(tek(pat == "t"), at + s16 * beat / 4, 0.15 if pat == "t" else 0.1, 0.35, 0.2)
        if b >= 8:
            for e in range(8):
                m.add(shaker(), at + e * beat / 2, 0.04, 0.6, 0.15)
        if b >= 16 and b % 2 == 1:
            for i in range(6):
                m.add(taiko(0.5), at + beat * 2.5 + i * beat / 4, 0.25 + 0.06 * i, -0.2, 0.3)
    for b in range(8, 32, 2):
        m.add(braam(bar * 2, LOW[PROG[(b // 2) % 4]], 0.9), b * bar, 0.36, 0, 0.35)
    # The hook comes back, driven: the answer at bar 16, the climax at bar 24.
    m.add(voice(line(ANSWER, beat), [(0, "a"), (10, "a"), (13, "o")]), 16 * bar, 0.55, 0.05, 0.5)
    m.add(voice(line(CLIMAX, beat), [(0, "a"), (12, "a"), (19, "o")], vib=0.26), 24 * bar, 0.62, 0.0, 0.55)
    return m.render(rt=3.0, wet=0.42)


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in (("aer_title.wav", title), ("aer_storm.wav", storm)):
        x = fn()
        wavfile.write(out / name, SR, (x.T * 0.95).astype(np.float32))
        print(name, f"{x.shape[1] / SR:.1f} s")


if __name__ == "__main__":
    main(sys.argv[1])
