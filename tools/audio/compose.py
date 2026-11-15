"""Compose and render AER's two desert-epic music tracks from scratch: no samples, no recordings, only code.

  aer_title.wav  "Jezero"  - title theme, ~1:40 at 80 BPM: wind and a throat-singing drone, a lone voice, taiko,
                             a build, a high wailing cry over brass and drums, then back to the drone (loops).
  aer_storm.wav  "Haboob"  - storm music, ~1:17 at 100 BPM: driving frame drums and taiko, a low ostinato,
                             rising brass swells and short falling cries.

Original music in the style of desert film scores (phrygian dominant on D, voice, drums, drones). The melodies are
written here; nothing is copied from any film score.

Everything is synthesized with NumPy/SciPy at 48 kHz stereo:
- Voice: additive synthesis of a glottal source shaped by three vowel formants, with glides, vibrato, jitter and
  breath noise.
- Throat singing: a low drone whose harmonics pass a narrow resonance that moves, so single overtones whistle.
- Taiko and frame drums: pitch-dropping sines with skin noise.
- Brass swells: detuned saws through an opening low-pass.
- Wind: filtered noise.
- Space: convolution reverb with a synthetic hall impulse.

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


def voice(notes, vowels, vib=0.35, breath=0.05, growl=0.0, base_amp=1.0):
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
        amp = env * k ** -0.9 * (fk < SR / 2 - 2000)
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


def braam(seconds=4.0, notes=(26, 33, 38), open_s=1.4):
    """A brass-and-synth swell: the filter opens, holds, and closes."""
    n = int(seconds * SR)
    t = secs(n)
    cut = 150 + 2600 * np.clip(t / open_s, 0, 1) ** 1.5 * np.exp(-np.clip(t - open_s, 0, None) / (seconds * 0.5))
    out = np.zeros(n)
    for m in notes:
        for det in (-0.09, -0.03, 0.04, 0.1):
            f = midi_hz(m + det)
            ph = 2 * np.pi * f * t + rng.uniform(0, 6.28)
            for k in range(1, int(3200 / f)):
                out += (1 / k) * np.sin(k * ph) / (1 + (k * f / cut) ** 4)
    env = np.clip(t / 0.25, 0, 1) * np.clip((seconds - t) / 1.2, 0, 1)
    out = np.tanh(out / np.max(np.abs(out)) * 2.2) * env
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


# ---------------------------------------------------------------- pieces

# D phrygian dominant: D Eb F# G A Bb C. MIDI: D4 62, Eb4 63, F#4 66, G4 67, A4 69, Bb4 70, C5 72, D5 74, Eb5 75.

def title():
    beat = 60 / 80
    bar = beat * 4
    L = 34 * bar  # 102 s
    m = Mix(L)
    m.add(wind(L), 0, 0.22, 0, 0.2)
    m.add(drone(L, (26, 38, 45), 420), 0, 0.33, 0, 0.35)
    m.add(throat_drone(L * 0.55, 38, ((0, 6), (0.2, 8), (0.4, 9), (0.55, 8), (0.75, 10), (1, 8))), 2, 0.30, -0.25, 0.45)
    m.add(throat_drone(L * 0.3, 38, ((0, 8), (0.5, 6), (1, 8))), L * 0.68, 0.26, -0.25, 0.45)

    # Taiko: a lone boom every bar from bar 4, then the build.
    for b in range(4, 30):
        at = b * bar
        size = 1.0 if b % 2 == 0 else 0.8
        m.add(taiko(size), at, 0.8 if b < 12 else 0.85, 0.0, 0.35)
        if b >= 12:  # second hit
            m.add(taiko(0.7), at + beat * 2.5, 0.6, 0.15, 0.35)
        if b >= 16:  # frame drums in a slow maqsum-like pattern
            for off, s in ((0, doum), (1, tek), (1.5, tek), (2, doum), (3, tek), (3.5, tek)):
                m.add(s(), at + off * beat, 0.32, -0.35 if s is doum else 0.35, 0.25)
        if b >= 20:  # shakers on eighths
            for e in range(8):
                m.add(shaker(), at + e * beat / 2, 0.10 + 0.05 * (e % 2 == 0), 0.6, 0.2)
        if b >= 22:  # the climax: double taiko
            for off in (0.75, 1.0, 3.0, 3.25):
                m.add(taiko(0.6), at + off * beat, 0.55, -0.2, 0.35)

    # Voice. Phrase 1: low and searching (bar 6).
    p1 = [(62, 1.8, 0.1), (63, 1.0, 0.35), (62, 0.8, 0.25), (66, 1.4, 0.3), (67, 0.7, 0.2), (69, 3.2, 0.45),
          (67, 0.6, 0.2), (66, 2.2, 0.5)]
    m.add(voice(p1, [(0, "u"), (3, "o"), (8, "a"), (12, "o")], vib=0.3, breath=0.06), 6 * bar, 0.6, 0.1, 0.55)
    # Phrase 2: higher, answering (bar 13).
    p2 = [(69, 1.2, 0.1), (70, 1.2, 0.4), (69, 0.6, 0.2), (67, 0.6, 0.15), (66, 0.6, 0.15), (67, 1.0, 0.2),
          (69, 1.5, 0.3), (74, 2.6, 0.7), (72, 0.5, 0.2), (70, 0.5, 0.15), (69, 3.0, 0.5)]
    m.add(voice(p2, [(0, "o"), (4, "a"), (14, "o")], vib=0.35, breath=0.05), 13 * bar, 0.62, -0.1, 0.55)
    # The cry (bar 21): rises to D5, ornaments around it, climbs to F#5, falls a fifth.
    cry = [(69, 0.8, 0.1), (74, 2.2, 0.9), (75, 0.18, 0.06), (74, 0.18, 0.06), (73, 0.18, 0.06), (74, 1.8, 0.08),
           (78, 2.6, 0.55), (77, 0.25, 0.1), (75, 0.25, 0.1), (74, 1.2, 0.15), (67, 3.2, 1.6)]
    m.add(voice(cry, [(0, "a"), (13, "a"), (14.5, "o")], vib=0.45, breath=0.04, growl=0.25), 21 * bar, 0.8, 0.0, 0.6)
    cry2 = [(70, 0.6, 0.1), (74, 1.6, 0.6), (75, 0.2, 0.06), (74, 0.2, 0.06), (72, 0.2, 0.06), (70, 0.2, 0.06),
            (69, 1.4, 0.1), (81, 2.4, 0.9), (79, 0.3, 0.12), (78, 0.3, 0.1), (74, 3.6, 1.2)]
    m.add(voice(cry2, [(0, "a"), (9, "a"), (11, "o")], vib=0.5, breath=0.04, growl=0.3), 25.5 * bar, 0.82, 0.05, 0.62)
    # Phrase 3: the voice alone again, low, as it all falls away (bar 30).
    p3 = [(69, 1.6, 0.1), (67, 0.8, 0.3), (66, 0.8, 0.2), (63, 1.4, 0.4), (62, 4.0, 0.5)]
    m.add(voice(p3, [(0, "o"), (5, "u")], vib=0.3, breath=0.07), 30 * bar, 0.55, 0.1, 0.6)

    # Brass swells at the build and the climax.
    for b, notes in ((16, (26, 33, 38)), (20, (27, 34, 39)), (22, (26, 33, 38, 45)), (24, (26, 33, 38)),
                     (26, (24, 31, 36, 43)), (28, (26, 33, 38, 45))):
        m.add(braam(bar * 2, notes, 1.2), b * bar, 0.48, 0.0, 0.4)
    return m.render(rt=4.0, wet=0.6)


def storm():
    beat = 60 / 100
    bar = beat * 4
    L = 32 * bar  # 76.8 s
    m = Mix(L)
    m.add(wind(L, 0.6), 0, 0.2, 0, 0.15)
    m.add(drone(L, (26, 33, 38), 300), 0, 0.3, 0, 0.3)
    # Low ostinato, eighths: D D Eb D D F D Eb (one bar), in the bass.
    riff = [26, 26, 27, 26, 26, 29, 26, 27]
    for b in range(2, 31):
        for e, note in enumerate(riff):
            n = int(beat / 2 * 0.9 * SR)
            t = secs(n)
            f = midi_hz(note + (12 if b >= 18 and e % 4 == 3 else 0))
            s = sum(np.sin(2 * np.pi * k * f * t) / k for k in range(1, 12)) * np.exp(-t / 0.12)
            s = lowpass(s, 900)
            m.add(s / np.max(np.abs(s)), b * bar + e * beat / 2, 0.3, -0.15, 0.15)
    for b in range(0, 31):
        at = b * bar
        m.add(taiko(1.0), at, 0.95, 0, 0.3)
        m.add(taiko(0.8), at + beat * 2, 0.75, 0.1, 0.3)
        if b >= 4:
            for s16 in range(16):  # driving frame drums
                pat = "D.tkD.tk.tD.tkt."[s16]
                if pat == "D":
                    m.add(doum(), at + s16 * beat / 4, 0.32, -0.3, 0.2)
                elif pat in "tk":
                    m.add(tek(pat == "t"), at + s16 * beat / 4, 0.18 if pat == "t" else 0.12, 0.35, 0.2)
        if b >= 8:
            for e in range(16):
                m.add(shaker(), at + e * beat / 4, 0.045, 0.6, 0.15)
        if b >= 16 and b % 2 == 1:  # taiko roll into the next bar
            for i in range(6):
                m.add(taiko(0.5), at + beat * 2.5 + i * beat / 4, 0.3 + 0.08 * i, -0.2, 0.3)
    for b in range(4, 30, 4):  # brass swells, climbing each time
        step = (b - 4) // 4
        m.add(braam(bar * 2.5, tuple(x + (0, 1, 3, 1, 0, 1, 0)[step % 7] for x in (26, 33, 38)), 2.0), b * bar, 0.5, 0, 0.35)
    # Short cries, falling, like wind through rock.
    for b, top in ((9, 74), (17, 77), (21, 75), (25, 78)):
        cry = [(top - 5, 0.3, 0.05), (top, 1.4, 0.35), (top + 1, 0.2, 0.06), (top, 0.4, 0.06), (top - 7, 1.6, 1.2)]
        m.add(voice(cry, [(0, "a"), (2, "a"), (3.5, "o")], vib=0.5, breath=0.05, growl=0.35), b * bar, 0.72, 0.05, 0.6)
    return m.render(rt=3.2, wet=0.45)


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, fn in (("aer_title.wav", title), ("aer_storm.wav", storm)):
        x = fn()
        wavfile.write(out / name, SR, (x.T * 0.95).astype(np.float32))
        print(name, f"{x.shape[1] / SR:.1f} s")


if __name__ == "__main__":
    main(sys.argv[1])
