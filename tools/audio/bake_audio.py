"""Turn the downloaded music and the NASA Mars wind recording into the files the game plays (public/audio/).

Every source is listed in SOURCES with its page and licence (also in public/data/credits.json audioCredits and
docs/DATA_SOURCES.md). Needs ffmpeg on PATH and NumPy.

What it does:
- Music: evens out loudness (to TARGET_LUFS integrated, peaks limited to -1 dBTP) and encodes MP3 at 192 kbit/s
  (plays in every browser, Safari included). The game crossfades each track into itself to loop it.
- Mars wind: resamples NASA's 100 kHz SuperCam recording to 48 kHz, evens out loudness, and bakes a seamless loop
  (the end crossfades into the start). The file carries PAD_S of extra audio on each side so the game can loop the
  inner part exactly (loopStart = PAD_S, loopEnd = PAD_S + loop length), clear of MP3 encoder padding.

Usage: python compose.py DOWNLOAD_DIR, then python bake_audio.py DOWNLOAD_DIR REPO_DIR
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

TARGET_LUFS = -20.0
WIND_LUFS = -22.0
SR = 48000
PAD_S = 0.25
XFADE_S = 3.0

# file in DOWNLOAD_DIR -> output name, page, author, licence
SOURCES = {
    # title and storm are original, composed in code by tools/audio/compose.py (run it into DOWNLOAD_DIR first).
    "title": ("aer_title.wav", "Jezero (title theme)", "AER team, composed in code",
              "https://github.com/ZektoxFx/aer/blob/main/tools/audio/compose.py"),
    "explore": ("OutThere_0.ogg", "Space Music: Out There", "yd",
                "https://opengameart.org/content/space-music-out-there"),
    "storm": ("aer_storm.wav", "Haboob (storm)", "AER team, composed in code",
              "https://github.com/ZektoxFx/aer/blob/main/tools/audio/compose.py"),
    "won": ("ending_scene_orchestral.wav", "Ending Scene (orchestral version)", "nene",
            "https://opengameart.org/content/ending-scene"),
    "lost": ("transmission_1.mp3", "Transmission (Dark Sci-Fi Audio Pack)", "SRG774",
             "https://opengameart.org/node/188336"),
}
WIND = ("nasa_wind_sol4.wav", "https://science.nasa.gov/resource/perseverance-rovers-supercam-records-wind-on-mars/")


def ff(*args, capture=False):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-y", *args], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    return r.stderr if capture else None


def loudness(path):
    err = ff("-i", str(path), "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-", capture=True)
    i = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", err)[-1])
    peak = float(re.findall(r"Peak:\s+(-?[\d.inf]+) dBFS", err)[-1])
    return i, peak


def music(src, out):
    i, _ = loudness(src)
    gain = TARGET_LUFS - i
    ff("-i", str(src), "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=false", "-c:a", "libmp3lame",
       "-b:a", "192k", str(out))
    return {"sourceLufs": round(i, 1), "gainDb": round(gain, 1), "lufs": round(loudness(out)[0], 1)}


def wind(src, out, tmp):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af", "highpass=f=20", "-ar", str(SR),
                          "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype="<f4").astype(np.float64)
    n = int(XFADE_S * SR)
    # Loop = all but the last XFADE_S; the last XFADE_S fades into the first XFADE_S (equal-power).
    body = x[:-n].copy()
    t = np.linspace(0, np.pi / 2, n)
    body[:n] = x[:n] * np.sin(t) + x[-n:] * np.cos(t)
    p = int(PAD_S * SR)
    padded = np.concatenate([body[-p:], body, body[:p]])
    wav = Path(tmp) / "wind_loop.wav"
    pcm = (np.clip(padded, -1, 1) * 32767).astype("<i2")
    subprocess.run(["ffmpeg", "-hide_banner", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", str(wav)],
                   input=pcm.tobytes(), capture_output=True, check=True)
    i, _ = loudness(wav)
    ff("-i", str(wav), "-af", f"volume={WIND_LUFS - i:.2f}dB,alimiter=limit=0.89:level=false", "-c:a", "libmp3lame",
       "-b:a", "128k", str(out))
    return {"loopStartS": PAD_S, "loopEndS": round(PAD_S + len(body) / SR, 4), "sampleRate": SR,
            "sourceLufs": round(i, 1)}


def main(dl, repo):
    dl, out = Path(dl), Path(repo) / "public/audio"
    out.mkdir(parents=True, exist_ok=True)
    report = {}
    for key, (f, title, author, page) in SOURCES.items():
        report[key] = {"title": title, "author": author, "page": page, **music(dl / f, out / f"{key}.mp3")}
        print(key, report[key])
    report["wind"] = {"page": WIND[1], **wind(dl / WIND[0], out / "mars-wind.mp3", dl)}
    print("wind", report["wind"])
    (out / "audio.json").write_text(json.dumps({
        "about": "Built by tools/audio/bake_audio.py. title and storm are original music composed in code (tools/audio/compose.py); explore, won and lost are CC0 (OpenGameArt); mars-wind.mp3 is NASA's "
                 "Perseverance SuperCam microphone recording from sol 4 (credit NASA/JPL-Caltech/LANL/CNES/CNRS/"
                 "ISAE-Supaero), resampled, levelled and looped.",
        "tracks": report}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2])
