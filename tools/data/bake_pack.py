"""Turn the downloaded raw data into the game's static files in <repo>/public/data/.

Usage: python bake_pack.py REPO_DIR
Inputs come from ../work and ../raw (see tools/README.md).
"""
import json
import math
import shutil
import sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
WORK, RAW = ROOT / "work", ROOT / "raw"
sys.path.insert(0, str(Path(__file__).parent))
import solar_flux  # noqa: E402

MARS_R = 3396190.0
meta = json.loads((WORK / "terrain" / "terrain_meta.json").read_text())
LON0, LAT0 = meta["landing_lon"], meta["landing_lat"]
COSLAT = math.cos(math.radians(LAT0))
E_MIN, E_MAX, N_MIN, N_MAX = meta["e_min"], meta["e_max"], meta["n_min"], meta["n_max"]
W_M, H_M = E_MAX - E_MIN, N_MAX - N_MIN


def en(lon, lat):
    return MARS_R * math.radians(lon - LON0) * COSLAT, MARS_R * math.radians(lat - LAT0)


def lonlat(e, n):
    return LON0 + math.degrees(e / (MARS_R * COSLAT)), LAT0 + math.degrees(n / MARS_R)


def pos(e, n):
    """Position record: map metres from the NW corner (x east, y south), plus E/N from landing and lon/lat."""
    lo, la = lonlat(e, n)
    return {"xM": round(e - E_MIN, 1), "yM": round(N_MAX - n, 1), "eastM": round(e, 1), "northM": round(n, 1),
            "lon": round(lo, 6), "lat": round(la, 6)}


def save_png(arr, path):
    Image.fromarray(arr).save(path, optimize=True)


def main(repo):
    out = Path(repo) / "public" / "data"
    out.mkdir(parents=True, exist_ok=True)
    (out / "photos").mkdir(exist_ok=True)

    # ---------- terrain ----------
    z2 = np.load(WORK / "terrain" / "elevation_2m.npy").astype(np.float64)
    z10 = z2.reshape(z2.shape[0] // 5, 5, z2.shape[1] // 5, 5).mean(axis=(1, 3))
    z20 = z2.reshape(z2.shape[0] // 10, 10, z2.shape[1] // 10, 10).mean(axis=(1, 3))

    # Base photo (HiRISE ortho, 1 m), contrast-stretched
    o = np.load(WORK / "terrain" / "ortho_1m.npy")
    lo, hi = np.nanpercentile(o, [0.3, 99.7])
    o8 = np.clip((np.nan_to_num(o, nan=lo) - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)
    img1 = Image.fromarray(o8)
    img1.save(out / "jezero_base_1m.jpg", quality=82, optimize=True, progressive=True)
    img1.resize((img1.width // 2, img1.height // 2), Image.LANCZOS).save(out / "jezero_base_2m.jpg", quality=85, optimize=True, progressive=True)

    # Hillshade (2 m), from the NW at 35 deg
    zs = ndimage.gaussian_filter(z2, 1.0)
    gy, gx = np.gradient(zs, 2.0)  # gy: +south, gx: +east
    slope = np.arctan(np.hypot(gx, gy))
    az, alt = math.radians(315), math.radians(35)
    # light vector components: east = sin(az)cos(alt), north = cos(az)cos(alt)
    lx, ly, lz = math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)
    nx, ny, nz = -gx, gy, np.ones_like(gx)  # surface normal (east, north, up); north gradient = -gy
    hs = (nx * lx + ny * ly + nz * lz) / np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    save_png((np.clip(hs, 0, 1) * 255).astype(np.uint8), out / "hillshade_2m.png")

    # Slope (deg) on the 10 m and 20 m grids, and a coloured 2 m overlay
    def slope_deg(z, cell):
        gy_, gx_ = np.gradient(z, cell)
        return np.degrees(np.arctan(np.hypot(gx_, gy_)))

    s10, s20 = slope_deg(z10, 10.0), slope_deg(z20, 20.0)
    s4 = np.degrees(slope)
    rgba = np.zeros(s4.shape + (4,), np.uint8)
    bands = [(10, (255, 220, 0, 110)), (15, (255, 140, 0, 150)), (25, (230, 30, 30, 180)), (35, (150, 0, 0, 210))]
    for thr, c in bands:
        rgba[s4 >= thr] = c
    save_png(rgba, out / "overlay_slope_2m.png")

    # Rock/roughness: std of 2 m elevation residual within each 20 m cell
    resid = z2 - ndimage.uniform_filter(z2, 11)
    rough20 = resid.reshape(z20.shape[0], 10, z20.shape[1], 10).std(axis=(1, 3))

    # THEMIS thermal inertia (100 m, Edwards & Buz 2021), resampled to the 20 m grid
    t = tifffile.TiffFile(RAW / "themis_ti" / "Jezero_Thermal_Inertia_v1.tiff")
    p = t.pages[0]
    ti = p.asarray().astype(np.float64)
    ti[ti <= 0] = np.nan
    sx, sy, _ = p.tags["ModelPixelScaleTag"].value
    _, _, _, tx, ty, _ = p.tags["ModelTiepointTag"].value
    rows, cols = z20.shape
    es = E_MIN + (np.arange(cols) + 0.5) * 20
    ns = N_MAX - (np.arange(rows) + 0.5) * 20
    lons = LON0 + np.degrees(es / (MARS_R * COSLAT))
    lats = LAT0 + np.degrees(ns / MARS_R)
    cc = (MARS_R * np.radians(lons) - tx) / sx - 0.5
    rr = (ty - MARS_R * np.radians(lats)) / sy - 0.5
    R, C = np.meshgrid(rr, cc, indexing="ij")
    ti20 = ndimage.map_coordinates(np.nan_to_num(ti, nan=np.nanmedian(ti)), [R, C], order=1)

    # Terrain classes for route cost (design thresholds, tune in playtesting; see DATA_SOURCES.md)
    # 0 firm ground, 1 rocky/rough, 2 likely loose sand (low thermal inertia), 3 steep (>25 deg), 4 cliff (>35 deg)
    cls = np.zeros(z20.shape, np.uint8)
    cls[ti20 < 200] = 2
    cls[rough20 > np.percentile(rough20, 85)] = 1
    cls[s20 > 25] = 3
    cls[s20 > 35] = 4
    pal = {0: (0, 0, 0, 0), 1: (180, 120, 255, 120), 2: (255, 210, 120, 120), 3: (255, 120, 0, 160), 4: (200, 0, 0, 200)}
    rgba = np.zeros(cls.shape + (4,), np.uint8)
    for k, c in pal.items():
        rgba[cls == k] = c
    save_png(rgba, out / "overlay_terrain_20m.png")
    tin = np.clip((ti20 - 100) / (500 - 100), 0, 1)
    tiz = np.zeros(ti20.shape + (4,), np.uint8)
    tiz[..., 0] = (255 * tin).astype(np.uint8)
    tiz[..., 1] = (120 * (1 - abs(tin - 0.5) * 2)).astype(np.uint8)
    tiz[..., 2] = (255 * (1 - tin)).astype(np.uint8)
    tiz[..., 3] = 140
    save_png(tiz, out / "overlay_thermal_inertia_20m.png")

    layers = {
        "source": "Slope and roughness from the USGS Mars 2020 TRN HiRISE DTM mosaic (1 m); thermal inertia from "
                  "THEMIS (Edwards & Buz 2021, Zenodo 10.5281/zenodo.4931348, CC-BY-4.0)",
        "cols": cols, "rows": rows, "cellM": 20,
        "note": "Row-major from the north-west corner, same area as pack.json",
        "slopeDeg": [round(float(v), 1) for v in s20.ravel()],
        "roughnessM": [round(float(v), 2) for v in rough20.ravel()],
        "thermalInertia": [int(round(v)) for v in ti20.ravel()],
        "terrainClass": [int(v) for v in cls.ravel()],
        "terrainClassNames": ["firm", "rocky", "loose_sand_likely", "steep_over_25deg", "cliff_over_35deg"],
    }
    (out / "layers_20m.json").write_text(json.dumps(layers, separators=(",", ":")), encoding="utf-8")

    # ---------- points of interest ----------
    wps = json.loads((RAW / "m20_traverse" / "M20_waypoints.json").read_text())["features"]

    def at_sol(sol):
        c = [f["properties"] for f in wps if f["properties"]["sol"] <= sol]
        return c[-1]

    def wp_pos(sol):
        pp = at_sol(sol)
        e, n = en(pp["lon"], pp["lat"])
        d = pos(e, n)
        d["elevM"] = round(pp["elev_geoid"], 1)
        d["waypointSol"] = pp["sol"]
        return d

    pois = []

    def add(id_, name, kind, p_, **kw):
        pois.append({"id": id_, "name": name, "kind": kind, **p_, **kw})

    add("landing_site", "Octavia E. Butler Landing", "nasa_site", wp_pos(13),
        note="Perseverance touchdown, Feb 18 2021 (sol 0). Position = first localisation, sol 13.",
        photos=["landing_site_1.jpg", "landing_site_2.jpg"])
    add("wright_brothers_field", "Wright Brothers Field (Ingenuity airfield)", "nasa_hardware", wp_pos(43),
        note="Ingenuity was dropped here around sol 43 and made the first powered flight on another planet on "
             "sol 58 (Apr 19 2021). Position = rover position on the deployment sol, within ~50 m.",
        photos=["wright_brothers_field_1.jpg", "wright_brothers_field_2.jpg"])
    # EDL hardware: positions measured from the HiRISE ESP_068294_1985 annotated image, registered to the
    # HiRISE ortho mosaic with two crater control points (landing-site check error ~20 m). Accuracy ~ +/-40 m.
    for id_, name, e, n, ph, note in [
        ("descent_stage", "Descent stage crash site", -535, 450, "descent-stage-irb.jpg",
         "The sky crane flew away after lowering the rover and crashed ~700 m north-west, leaving a V-shaped debris pattern."),
        ("parachute_backshell", "Parachute and backshell", -1038, 408, "parachute.jpg",
         "The 21.5 m parachute and the backshell landed together ~1.1 km west-north-west. Ingenuity photographed the "
         "backshell standing upright on flight 26 (sol 418)."),
        ("heat_shield", "Heat shield impact", 1300, 666, "heatshield-no-contrast.jpg",
         "Jettisoned during descent, the heat shield hit the ground ~1.5 km east-north-east."),
    ]:
        add(id_, name, "nasa_hardware", pos(e, n), note=note, photos=[ph], positionAccuracyM=40,
            positionSource="HiRISE ESP_068294_1985 annotated release (uahirise.org/releases/perseverance), registered by hand")

    samples = [
        (1, "Roubion", "Roubion", 164, "Atmospheric", True, ["roubion_1.jpg"]),
        (2, "Montdenier", "Rochette", 194, "Rock core, igneous", True, ["rochette_1.jpg"]),
        (3, "Montagnac", "Rochette", 196, "Rock core, igneous", False, []),
        (4, "Salette", "Brac", 262, "Rock core, igneous", False, ["brac_1.jpg"]),
        (5, "Coulettes", "Brac", 271, "Rock core, igneous", True, []),
        (6, "Robine", "Issole", 298, "Rock core, igneous", False, ["issole_seitah_1.jpg"]),
        (7, "Malay", "Issole", 337, "Rock core, igneous", True, []),
        (8, "Ha'ahóni", "Sid", 371, "Rock core, igneous", False, ["sid_1.jpg"]),
        (9, "Atsá", "Sid", 377, "Rock core, igneous", True, []),
        (10, "Swift Run", "Skinner Ridge", 490, "Rock core, sedimentary", False, ["skinner_ridge_1.jpg"]),
        (11, "Skyland", "Skinner Ridge", 495, "Rock core, sedimentary", True, []),
        (12, "Hazeltop", "Wildcat Ridge", 509, "Rock core, sedimentary", False, ["wildcat_ridge_1.jpg"]),
        (13, "Bearwallow", "Wildcat Ridge", 516, "Rock core, sedimentary", True, []),
        (14, "Shuyak", "Amalik", 575, "Rock core, sedimentary", False, ["amalik_1.jpg"]),
        (15, "Mageik", "Amalik", 619, "Rock core, sedimentary", True, []),
        (16, "Kukaklek", "Hidden Harbor", 631, "Rock core, sedimentary", False, []),
        (17, "Atmo Mountain", "Observation Mountain", 634, "Regolith", False, ["observation_mountain_1.jpg"]),
        (18, "Crosswind Lake", "Observation Mountain", 639, "Regolith", True, []),
    ]
    for no, name, target, sol, kind, depot, ph in samples:
        add(f"sample_{no:02d}", f"Sample {no}: {name} ({target})", "science_sample", wp_pos(sol),
            sampleNo=no, target=target, solSealed=sol, sampleType=kind, copyInThreeForksDepot=depot, photos=ph,
            note="Position = rover's last localisation on or before the sealing sol (within tens of metres).")
    add("three_forks_depot", "Three Forks Sample Depot", "nasa_site", wp_pos(690),
        note="Ten sample tubes (9 rock/regolith/atmosphere + 1 witness tube) were dropped here between sol 653 and 690 "
             "(Dec 21 2022 - Jan 28 2023) as a backup cache for Mars Sample Return.",
        photos=["three_forks_depot_2.jpg"])

    # Rover candidate positions for the "find the rover" goal: real traverse points >1.5 km from the landing site
    cands = []
    for sol in (420, 464, 509, 560, 600, 640, 690):
        d = wp_pos(sol)
        dist = math.hypot(d["eastM"], d["northM"])
        if dist > 1500 and all(math.hypot(d["eastM"] - c["eastM"], d["northM"] - c["northM"]) > 200 for c in cands):
            d["distanceFromLandingM"] = round(dist)
            cands.append(d)
    for k, d in enumerate(cands):
        add(f"rover_candidate_{k + 1}", f"Rover candidate {k + 1} (real sol {d['waypointSol']} position)",
            "rover_candidate", d)

    # Traverse inside the area (sols up to the depot), for track clues
    trav = json.loads((RAW / "m20_traverse" / "M20_traverse.json").read_text())["features"]
    segs = []
    for f in trav:
        if f["properties"]["sol"] > 700:
            continue
        pts = []
        for lo_, la_, *_ in f["geometry"]["coordinates"][::3] + [f["geometry"]["coordinates"][-1]]:
            e, n = en(lo_, la_)
            if E_MIN <= e <= E_MAX and N_MIN <= n <= N_MAX:
                pts.append([round(e - E_MIN, 1), round(N_MAX - n, 1)])
        if len(pts) >= 2:
            segs.append({"sol": f["properties"]["sol"], "lengthM": f["properties"]["length"], "pointsXY": pts})

    pois_doc = {
        "source": "Positions from NASA/JPL Mars 2020 MMGIS waypoints and traverse (mars.nasa.gov/mmgis-maps/M20), "
                  "sample list from science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples",
        "coordinates": "xM/yM = metres from the map's north-west corner (x east, y south); eastM/northM = metres from "
                       "the landing site; lon/lat = Mars 2000 planetocentric, east longitude",
        "pois": pois,
        "traverse": segs,
    }
    (out / "pois.json").write_text(json.dumps(pois_doc, indent=1, ensure_ascii=False), encoding="utf-8")

    # ---------- photos ----------
    ph = json.loads((WORK / "photos_final" / "photos.json").read_text())
    for f in (WORK / "photos_final").glob("*.jpg"):
        im = Image.open(f).convert("RGB")
        im.thumbnail((1200, 1200))
        im.save(out / "photos" / f.name, quality=82, optimize=True, progressive=True)
    for f in ["descent-stage-irb.jpg", "parachute.jpg", "heatshield-no-contrast.jpg", "percy-full-res.jpg",
              "m2020-hardware-labels.jpg"]:
        ph.append({"poi": f.split(".")[0], "file": f, "instrument": "MRO HiRISE (ESP_068294_1985, Feb 22 2021)",
                   "credit": "NASA/JPL-Caltech/University of Arizona", "source_url": "https://www.uahirise.org/releases/perseverance/" + f})
    (out / "photos" / "photos.json").write_text(json.dumps(ph, indent=1), encoding="utf-8")

    # ---------- elevation pack (shared contract) ----------
    clat, clon = lonlat((E_MIN + E_MAX) / 2, (N_MIN + N_MAX) / 2)[::-1]
    return out, z10, (clat, clon)


if __name__ == "__main__":
    out, z10, (clat, clon) = main(sys.argv[1])
    np.save(WORK / "z10.npy", z10)
    (WORK / "center.json").write_text(json.dumps({"lat": clat, "lon": clon}), encoding="utf-8")
    print("baked into", out)
