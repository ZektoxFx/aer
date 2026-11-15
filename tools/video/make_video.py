"""Cut the take from record.js into the 30-second Space Apps demo (docs/VIDEO.md), with captions at the top.

Run: python tools/video/make_video.py   (needs ffmpeg with libx264)
Reads video-out/rec/*.webm and public/data/jezero_base_2m.jpg. Writes video-out/AER_demo_30s.mp4 and a smaller copy
under 7 MB for uploading, video-out/AER_demo_30s_small.mp4.

SHOTS holds source times from the 15 November take. After a new recording, check them against a contact sheet and
video-out/timeline.json, and update them.
"""
import glob
import os
import platform
import subprocess

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO, "video-out")
CLIPS = os.path.join(OUT_DIR, "clips")
STILL = os.path.join(REPO, "public", "data", "jezero_base_2m.jpg")
OUT = os.path.join(OUT_DIR, "AER_demo_30s.mp4")
OUT_SMALL = os.path.join(OUT_DIR, "AER_demo_30s_small.mp4")
MAX_S = 30.0

# Fonts for the captions: bold for the main line, regular for the small line.
FONTS = {
    "Windows": ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/segoeui.ttf"),
    "Darwin": ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"),
}.get(platform.system(), ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))

# (source start s, source end s, main caption, small caption). Rows 3 and 4 are two shots each with one caption.
ROW3 = ("Real NASA data: HiRISE terrain and Perseverance weather\n(MEDA, sol 312) set what every step costs.",
        "Orbit map: HiRISE, Mars Reconnaissance Orbiter · archived data, not live")
ROW4 = ("Plan each walk: the map shows what it costs\nand when you must turn back.",
        "Scavenge, salvage NASA hardware, repair your lander. Every kilogram costs oxygen.")
SHOTS = [
    (8.5, 12.5, "PerformativeLarper · NASA Space Apps 2026\nInterplanetary Survival Guide: Martian Map", ""),
    (51.5, 56.5, "AER: plan a Marswalk you can survive.", ""),
    (79.0, 81.5, *ROW3),
    (112.0, 115.5, *ROW3),
    (119.5, 122.5, *ROW4),
    (127.0, 130.0, *ROW4),
    (136.8, 141.8, "Dust storm in 5:00. Pick your shelter.",
     "Game storm is stronger than Jezero's real 2022 storm (τ 1.38)."),
]
END = ("From one walk today to the first human missions.", "github.com/ZektoxFx/aer  ·  aer-black.vercel.app")
END_S = 3.9  # keeps the total under 30.0 s


def ff_path(p):
    """A path as ffmpeg's filter syntax wants it (forward slashes, escaped drive colon)."""
    return p.replace("\\", "/").replace(":", "\\:")


def textfile(name, text):
    p = os.path.join(CLIPS, name)
    with open(p, "w", encoding="utf-8", newline="\n") as f:  # \r\n would render as an extra line break
        f.write(text)
    return ff_path(p)


def captions(i, main, small):
    bold, regular = (ff_path(f) for f in FONTS)
    parts = []
    if main:
        parts.append(f"drawtext=fontfile='{bold}':textfile='{textfile(f'cap{i}_main.txt', main)}':fontsize=34:"
                     "fontcolor=white:line_spacing=8:box=1:boxcolor=black@0.62:boxborderw=16:x=(w-text_w)/2:y=34")
    if small:
        y = 152 if "\n" in main else 104
        parts.append(f"drawtext=fontfile='{regular}':textfile='{textfile(f'cap{i}_small.txt', small)}':fontsize=22:"
                     f"fontcolor=white@0.92:box=1:boxcolor=black@0.55:boxborderw=10:x=(w-text_w)/2:y={y}")
    return ",".join(parts)


def run(*args):
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)


def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def encode(src_args, vf, d, out):
    run(*src_args, "-f", "lavfi", "-t", str(d), "-i", "anullsrc=r=48000:cl=stereo", "-vf", vf,
        "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-t", str(d), out)


def main():
    takes = sorted(glob.glob(os.path.join(OUT_DIR, "rec", "*.webm")), key=os.path.getmtime)
    if not takes:
        raise SystemExit("No recording in video-out/rec/. Run: node tools/video/record.js")
    src = takes[-1]
    os.makedirs(CLIPS, exist_ok=True)
    total = sum(e - s for s, e, *_ in SHOTS) + END_S
    if total > MAX_S:
        raise SystemExit(f"The cut list adds up to {total:.2f} s; it must be {MAX_S} s or less.")

    parts = []
    for i, (s, e, main_cap, small_cap) in enumerate(SHOTS):
        d = e - s
        vf = (f"fps=30,scale=1280:720,fade=t=in:st=0:d=0.15,fade=t=out:st={d - 0.15:.2f}:d=0.15,"
              f"{captions(i, main_cap, small_cap)}")
        out = os.path.join(CLIPS, f"c{i}.mp4")
        encode(["-ss", str(s), "-t", str(d), "-i", src], vf, d, out)
        parts.append(out)

    # End card: the HiRISE base map of Jezero, dimmed, with a slow zoom.
    vf = ("scale=2560:-2,zoompan=z='1+0.0008*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1280x720:fps=30,"
          f"eq=brightness=-0.28:saturation=0.8,fade=t=in:st=0:d=0.3,{captions(99, *END)}")
    out = os.path.join(CLIPS, "end.mp4")
    encode(["-loop", "1", "-t", str(END_S), "-i", STILL], vf, END_S, out)
    parts.append(out)

    lst = os.path.join(CLIPS, "list.txt")
    with open(lst, "w", encoding="utf-8", newline="\n") as f:
        f.writelines(f"file '{p.replace(os.sep, '/')}'\n" for p in parts)
    run("-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", "-movflags", "+faststart", OUT)
    # A smaller copy for uploading (Google Drive's upload tool takes up to ~7 MB of video).
    run("-i", OUT, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-c:a", "copy",
        "-movflags", "+faststart", OUT_SMALL)

    for p in (OUT, OUT_SMALL):
        d = duration(p)
        if d > MAX_S:
            raise SystemExit(f"{p} is {d:.2f} s: over the {MAX_S} s limit.")
        print(f"{p}  {d:.2f} s  {os.path.getsize(p) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
