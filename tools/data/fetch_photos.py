"""Pick and download one or two Perseverance/Ingenuity raw images for each point of interest.

Source: NASA Mars 2020 raw image feed (mars.nasa.gov/rss/api, feed=raw_images). Credit: NASA/JPL-Caltech (+ASU for Mastcam-Z).
Usage: python fetch_photos.py OUT_DIR
"""
import json
import sys
from pathlib import Path

import requests

API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=100&page={page}&sol={sol}"

# (poi id, sol, preferred instruments in order, how many images)
POIS = [
    ("landing_site", 4, ["NAVCAM_LEFT", "MCZ_LEFT", "FRONT_HAZCAM_LEFT_A"], 2),
    ("wright_brothers_field", 58, ["NAVCAM_LEFT", "MCZ_LEFT", "MCZ_RIGHT"], 2),
    ("backshell_parachute_from_ingenuity", 418, ["HELI_RTE"], 2),
    ("roubion", 164, ["NAVCAM_LEFT", "MCZ_LEFT"], 1),
    ("rochette", 190, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("brac", 262, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("issole_seitah", 298, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("dust_storm_sky", 313, ["NAVCAM_LEFT", "SKYCAM", "MCZ_LEFT"], 2),
    ("dust_storm_after", 320, ["NAVCAM_LEFT", "MCZ_LEFT"], 1),
    ("sid", 371, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("skinner_ridge", 490, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("wildcat_ridge", 509, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("amalik", 575, ["MCZ_LEFT", "NAVCAM_LEFT"], 1),
    ("hidden_harbor", 631, ["MCZ_LEFT", "NAVCAM_LEFT", "MCZ_RIGHT"], 1),
    ("observation_mountain", 634, ["NAVCAM_LEFT", "MCZ_LEFT"], 1),
    ("three_forks_depot", 690, ["NAVCAM_LEFT", "FRONT_HAZCAM_LEFT_A", "MCZ_LEFT"], 2),
]


def images_for(sol):
    out, page = [], 0
    while True:
        d = requests.get(API.format(page=page, sol=sol), timeout=60).json()
        out += d.get("images", [])
        if len(out) >= d.get("total_results", 0) or not d.get("images") or page > 30:
            return out
        page += 1


def dims(im):
    try:
        w, h = (int(x) for x in im["extended"]["dimension"].strip("()").split(","))
        return w * h
    except Exception:
        return 0


def score(im):
    """Prefer detailed, well-exposed, full-frame landscape views over sun shots and blank frames."""
    import io

    import numpy as np
    from PIL import Image

    url = im["image_files"].get("small") or im["image_files"].get("medium")
    try:
        g = np.asarray(Image.open(io.BytesIO(requests.get(url, timeout=60).content)).convert("L"), dtype=float)
    except Exception:
        return -99
    h, w = g.shape
    hist = np.histogram(g, bins=64, range=(0, 255))[0] / g.size
    ent = -(hist[hist > 0] * np.log2(hist[hist > 0])).sum()
    edge = np.abs(np.diff(g, axis=1)).mean()
    s = ent + edge / 4
    if g.mean() < 45 or g.mean() > 215:
        s -= 4
    if h / w < 0.6:
        s -= 2
    if (g > 250).mean() > 0.002 and g.mean() < 80:  # sun disk on dark sky
        s -= 4
    return s


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    meta = []
    for poi, sol, prefs, n in POIS:
        window = [sol] + [sol + d for d in (1, -1, 2, -2, 3, 4, 5, 6, 7)]
        if prefs == ["HELI_RTE"]:
            window = list(range(sol, sol + 30))
        picked = []
        for s in window:
            ims = images_for(s)
            for inst in prefs:
                cand = [i for i in ims if i["camera"]["instrument"] == inst]
                cand.sort(key=dims, reverse=True)
                cand = cand[::max(1, len(cand) // 12)][:12]
                scored = sorted(((score(i), i) for i in cand), key=lambda t: -t[0])
                picked += [i for sc, i in scored if sc > 4][: n - len(picked)]
                if len(picked) >= n:
                    break
            if len(picked) >= n:
                break
        for k, im in enumerate(picked):
            url = im["image_files"].get("large") or im["image_files"]["full_res"]
            name = f"{poi}_{k + 1}.jpg" if url.lower().endswith(".jpg") else f"{poi}_{k + 1}.png"
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            (out / name).write_bytes(r.content)
            meta.append({
                "poi": poi, "file": name, "sol": im["sol"], "instrument": im["camera"]["instrument"],
                "imageid": im.get("imageid"), "date_taken_utc": im.get("date_taken_utc"),
                "source_url": url, "credit": im.get("credit", "NASA/JPL-Caltech"),
                "caption": (im.get("caption") or "")[:300],
            })
            print(poi, name, im["camera"]["instrument"], len(r.content) // 1024, "KB", flush=True)
        if not picked:
            print(poi, "NO IMAGE for sol", sol, "instruments seen:", sorted({i['camera']['instrument'] for i in ims}))
    (out / "photos.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
