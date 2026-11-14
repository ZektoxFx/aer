"""Second bake step: merge everything into <repo>/public/data.

Writes jezero_pack.json (shared DataPack contract, merged with the story content already in the repo),
weather.json, dust.json, sunlight.json, reference.json, and restores fake.json to the team placeholder.
Usage: python bake_final.py REPO_DIR
"""
import json
import math
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WORK, RAW = ROOT / "work", ROOT / "raw"
sys.path.insert(0, str(Path(__file__).parent))
import solar_flux  # noqa: E402

MARS_R = 3396190.0


def dump(path, obj, compact=False):
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":") if compact else None, indent=None if compact else 1)
    Path(path).write_text(txt, encoding="utf-8")


def main(repo):
    repo = Path(repo)
    out = repo / "public" / "data"
    meta = json.loads((WORK / "terrain" / "terrain_meta.json").read_text())
    lon0, lat0 = meta["landing_lon"], meta["landing_lat"]
    coslat = math.cos(math.radians(lat0))
    e_min, e_max, n_min, n_max = meta["e_min"], meta["e_max"], meta["n_min"], meta["n_max"]

    # ---------------- weather + dust ----------------
    merged = json.loads((WORK / "weather_merged.json").read_text())
    tau_daily = {int(k): v for k, v in merged["tauDaily"].items()}
    ls_by_sol = {int(k): v for k, v in merged["lsBySol"].items()}

    # Every Mastcam-Z measurement in the storm window, for a real tau-vs-time curve
    lines = (RAW / "tau_mastcamz" / "m20-ztau-merged-1717.txt").read_text().splitlines()
    i0 = [k for k, l in enumerate(lines) if l.startswith("Eye,")][0]
    storm_pts = []
    for l in lines[i0 + 1:]:
        p = [x.strip() for x in l.split(",")]
        if len(p) < 17:
            continue
        try:
            sol_dec, tau_r, ls = float(p[7]), float(p[11]), float(p[8])
        except ValueError:
            continue
        if 300 <= sol_dec < 331 and tau_r > 0:
            storm_pts.append({"sol": round(sol_dec, 3), "tau": tau_r, "ls": ls})

    sols = []
    for r in merged["sols"]:
        s = {
            "sol": r["sol"], "ls": r["ls"],
            "tau": r["tau"], "tauFromSol": r["tauSol"],
            "pressurePa": r.get("pressurePa"), "airTempC": r.get("airTempC"), "windMS": r.get("windMS"),
            "hourly": {k.replace("_hourly", ""): r[k] for k in r if k.endswith("_hourly")},
            "medaFiles": r.get("files"),
        }
        sols.append(s)
    weather = {
        "source": "Perseverance MEDA (PDS Atmospheres Node, mars2020_meda bundle): DER_PS pressure, CAL_ATS air temperature "
                  "(mean of ATS1-5), DER_WS wind, DER_TIRS long-wave irradiance. Dust tau: Mastcam-Z (Lemmon, Mendeley "
                  "10.17632/gktjp9jptb.2), 630 nm channel, daily median of the nearest measured sol.",
        "notes": [
            "Archived data, not live. Label charts with: Perseverance MEDA, sol N.",
            "Hourly arrays are indexed by Local True Solar Time hour 0-23; null = no data that hour.",
            "pressurePa = [lowest, mean, highest] of all 1 Hz readings. airTempC = [min, mean, max] of the hourly means. "
            "windMS = [mean, 99th percentile] of all readings.",
            "Wind sensor was damaged in the sol 313 storm: no wind after that.",
            "groundTemp/skyTemp are brightness temperatures from TIRS (ground emissivity 0.98 assumed).",
            "MEDA logs 12 h per sol on a normal cadence (odd/even hours alternate), so some sols miss hours.",
        ],
        "sols": sols,
    }
    dump(out / "weather.json", weather, compact=True)

    # storm sequence summary for the game (real Jezero regional dust storm, Jan 2022)
    storm_daily = []
    for s in range(305, 325):
        w = next((x for x in sols if x["sol"] == s), None)
        storm_daily.append({
            "sol": s, "tau": tau_daily.get(s), "pressurePa": w and w["pressurePa"], "airTempC": w and w["airTempC"],
            "windMS": w and w["windMS"],
        })
    dust = {
        "source": "Mastcam-Z solar-imaging optical depth, M. Lemmon (Mendeley Data 10.17632/gktjp9jptb.2, preliminary). "
                  "MEDA/TIRS aerosol optical depth (Zenodo 10.5281/zenodo.20827517, CC-BY-4.0) kept raw in the data repo.",
        "channel": "tau-R, 630 nm (visible); the closest to broadband sunlight for solar power",
        "tauDaily": {str(k): v for k, v in sorted(tau_daily.items())},
        "lsBySol": {str(k): round(v, 2) for k, v in sorted(ls_by_sol.items())},
        "jezeroStorm2022": {
            "description": "Regional dust storm over Jezero, Jan 2022 (sols 313-318). Pressure dropped ~40 Pa at arrival, "
                           "gusts reached 12.5 m/s on sol 313 and the MEDA wind sensor was damaged. Tau rose from ~0.3 to "
                           "1.38 (sol 316) and cleared within ~4 sols. Lemmon et al. 2022, GRL 49, e2022GL100126.",
            "daily": storm_daily,
            "measurements": storm_pts,
        },
        "references": {
            "opportunity2018": {"peakTau": 10.8, "note": "Opportunity's last reported tau, June 2018 planet-encircling "
                                "storm (proposal §3.6). Use as the extreme case, not Jezero data."},
            "highestJezeroTau": {"sol": max(tau_daily, key=tau_daily.get), "tau": max(tau_daily.values())},
        },
    }
    dump(out / "dust.json", dust, compact=True)

    # ---------------- sunlight ----------------
    _, rows_are_z, k125, f, _ = solar_flux.calibrate()
    taus = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0]
    elevs = [0, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90]
    albedo = 0.12  # Perseverance MEDA traverse mean (Martinez et al. 2023); see reference.json
    G = solar_flux.g_ob(180)  # placeholder, replaced per row by mean distance below
    g_mean = 590.0
    glob_tab, beam_tab = [], []
    for t in taus:
        grow, brow = [], []
        for el in elevs:
            z = 90 - el
            if el <= 0:
                grow.append(0.0)
                brow.append(0.0)
                continue
            cz = math.cos(math.radians(z))
            ff = max(0.0, f(z, max(t, 0.1), albedo)) if z <= 85 else max(0.0, f(85, max(t, 0.1), albedo)) * cz / math.cos(math.radians(85))
            gh = g_mean * cz * ff / (1 - albedo)
            bh = g_mean * cz * math.exp(-t / cz)
            grow.append(round(gh, 1))
            brow.append(round(min(bh, gh), 1))
        glob_tab.append(grow)
        beam_tab.append(brow)
    sunlight = {
        "source": "NASA TM-103623, Appelbaum & Flood, 'Solar radiation on Mars: Update 1990' (NTRS 19910005804): "
                  "normalized net flux function f(z,tau,albedo), Table III polynomial (fit checked against Table I: "
                  "mean error 0.4%), from Pollack's multiple-scattering model. Includes diffuse sky light.",
        "use": "solarWm2 = interpolate(globalHorizontalWm2, tau, sunElevationDeg) * distanceFactor(Ls). "
               "Values are on a horizontal surface at Mars' mean distance (590 W/m2 top of atmosphere).",
        "albedo": albedo,
        "tau": taus,
        "sunElevationDeg": elevs,
        "globalHorizontalWm2": glob_tab,
        "beamHorizontalWm2": beam_tab,
        "notes": ["tau below 0.1 uses the 0.1 row of f (the NASA table starts at 0.1)",
                  "sun elevations below 5 deg (zenith > 85) are extrapolated with cos(z)",
                  "Albedo 0.12: Perseverance MEDA broadband albedo (0.3-3 um) along the traverse, 0.12 +/- 0.01 (Martinez et al. 2023, JGR Planets 128, e2022JE007537); noon values 0.10-0.16, orbital TES ~0.15. Sources in reference.json jezeroMeasured.surfaceAlbedo."],
        "distanceFactor": {
            "formula": "(1 + e*cos(Ls - 248 deg))^2 / (1 - e^2)^2, e = 0.093377",
            "byLsDeg": {str(ls): round(solar_flux.g_ob(ls) / 590.0, 4) for ls in range(0, 360, 15)},
        },
        "sunElevation": {
            "formula": "sin(el) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(hourAngle); hourAngle = 15 deg * (LTST - 12); "
                       "sin(dec) = sin(25.19 deg) * sin(Ls)",
            "jezeroLatDeg": round(lat0, 4),
        },
    }
    dump(out / "sunlight.json", sunlight)

    # ---------------- merged data pack (shared contract) ----------------
    head_pack = json.loads(subprocess.run(["git", "-C", str(repo), "show", "HEAD:public/data/jezero_pack.json"],
                                          capture_output=True, check=True).stdout.decode("utf-8"))
    z10 = np.load(WORK / "z10.npy")
    pois = json.loads((out / "pois.json").read_text(encoding="utf-8"))
    by_id = {p["id"]: p for p in pois["pois"]}

    def sol_entry(sol, label, scenario, note):
        w = next(x for x in sols if x["sol"] == sol)
        return {"sol": sol, "pressureKPa": round(w["pressurePa"][1] / 1000, 3), "tempMinC": w["airTempC"][0],
                "tempMaxC": w["airTempC"][2], "windMS": (w["windMS"] or [None])[0], "tau": w["tau"],
                "label": label, "scenario": scenario, "notes": note}

    scen = [
        sol_entry(312, "Sol 312: clear sky before the storm", "Sol 1: Scrubber Saturation",
                  "Real MEDA + Mastcam-Z values. Normal Jezero day in northern winter (Ls ~153)."),
        sol_entry(313, "Sol 313: storm front arrives", "Sol 3: Dust Storm (warning)",
                  "Real. Pressure dips to 583 Pa, gusts to 12.5 m/s; the wind sensor is damaged this sol. "
                  "No Mastcam-Z tau on sol 313: tau shown is sol 312's; sol 314 measured 0.64."),
        sol_entry(316, "Sol 316: storm peak", "Sol 3: Dust Storm (peak)",
                  "Real. Tau 1.38, the highest of this storm. No wind data after sol 313 (sensor damaged)."),
        sol_entry(319, "Sol 319: storm clearing", "Sol 3: Dust Storm (clearing)", "Real. Tau back down to ~0.44."),
    ]
    # A warm-season sol for the cooling/water scenario: hottest daytime max in the season sample
    warm = max((x for x in sols if x["airTempC"] and x["sol"] not in range(300, 331)), key=lambda x: x["airTempC"][2])
    scen.insert(1, sol_entry(warm["sol"], f"Sol {warm['sol']}: warmest afternoon in the sample",
                             "Sol 2: Cooling and Water", "Real MEDA + Mastcam-Z values; hottest daytime air in the seasonal sample."))
    for s in scen:
        if s["windMS"] is None:
            s["windMS"] = 0
            s["notes"] += " windMS=0 means no data (sensor damaged), not calm air."

    def hw(id_, type_, sol, history, value, clue=None):
        p = by_id[id_]
        d = {"id": id_, "name": p["name"], "type": type_, "sol": sol, "lat": p["lat"], "lon": p["lon"],
             "eastingM": p["eastM"], "northingM": p["northM"], "history": history, "scientificValue": value}
        if clue:
            d["clue"] = clue
        return d

    old_hw = {h["id"]: h for h in head_pack.get("hardwareSites", [])}
    hardware = [
        hw("landing_site", "historic_landing", 0, by_id["landing_site"]["note"],
           "Start of Perseverance's traverse; the rover studied the Máaz crater-floor rocks around here.",
           old_hw.get("butler-landing", {}).get("clue")),
        hw("wright_brothers_field", "helicopter_airfield", 58, by_id["wright_brothers_field"]["note"],
           "First powered, controlled flight on another planet.", old_hw.get("ingenuity-wright-field", {}).get("clue")),
        hw("descent_stage", "edl_debris", 0, by_id["descent_stage"]["note"],
           "Seen from orbit by HiRISE the day after landing.", old_hw.get("descent-stage", {}).get("clue")),
        hw("parachute_backshell", "edl_debris", 0, by_id["parachute_backshell"]["note"],
           "Ingenuity's photos of the backshell helped engineers study how it survived entry.",
           old_hw.get("backshell-parachute", {}).get("clue")),
        hw("heat_shield", "edl_debris", 0, by_id["heat_shield"]["note"],
           "Its impact scar is visible in HiRISE images.", old_hw.get("heat-shield", {}).get("clue")),
        hw("three_forks_depot", "sample_depot", 653, by_id["three_forks_depot"]["note"],
           "The first sample depot on another planet.", None),
    ]

    # Rover waypoints in the area, regenerated from the NASA file
    wps = json.loads((RAW / "m20_traverse" / "M20_waypoints.json").read_text())["features"]
    rwp = []
    for f_ in wps:
        p = f_["properties"]
        e = MARS_R * math.radians(p["lon"] - lon0) * coslat
        n = MARS_R * math.radians(p["lat"] - lat0)
        if p["sol"] <= 700 and e_min <= e <= e_max and n_min <= n <= n_max:
            rwp.append({"sol": p["sol"], "site": p["site"], "drive": p["drive"], "lat": round(p["lat"], 7),
                        "lon": round(p["lon"], 7), "eastingM": round(e, 1), "northingM": round(n, 1),
                        "elevGeoidM": round(p["elev_geoid"], 2), "totalDistM": round(p["dist_total_m"], 1),
                        "note": p.get("Note") or ""})

    rocks = head_pack.get("rockFormations", [])
    for r in rocks:
        r["description"] = "[verify: values not yet checked against PIXL publications] " + r.get("description", "")

    lander = head_pack.get("crashedLander")
    if lander:
        lander["name"] = lander["name"]
        lander.setdefault("technicalSpecs", {})["fiction"] = "Fictional spacecraft for the game story, not NASA hardware."

    clat = lat0 + math.degrees(((n_min + n_max) / 2) / MARS_R)
    clon = lon0 + math.degrees(((e_min + e_max) / 2) / (MARS_R * coslat))
    pack = {
        "source": "HiRISE DTM + orthomosaic: USGS Mars 2020 TRN mosaics (DOI 10.5066/P9REJ9JN). Weather: Perseverance "
                  "MEDA (PDS). Dust: Mastcam-Z tau (Lemmon). Positions: NASA/JPL Mars 2020 waypoints. "
                  "Story items (lander, supplies, manual pages, visuals) are game fiction. See docs/DATA_SOURCES.md.",
        "imageUrl": "/data/jezero_base_2m.jpg",
        "area": {"name": "Jezero Crater: Octavia E. Butler Landing to the western delta front",
                 "lat": round(clat, 6), "lon": round(clon, 6), "widthM": e_max - e_min, "heightM": n_max - n_min,
                 "eMin": e_min, "eMax": e_max, "nMin": n_min, "nMax": n_max},
        "elevation": {"cols": int(z10.shape[1]), "rows": int(z10.shape[0]), "cellM": 10,
                      "heightsM": [round(float(v), 1) for v in z10.ravel()]},
        "sols": scen,
        "crashedLander": lander,
        "hardwareSites": hardware,
        "rockFormations": rocks,
        "roverWaypoints": rwp,
        "scatteredSupplies": head_pack.get("scatteredSupplies", []),
        "fieldManualPages": head_pack.get("fieldManualPages", []),
        "marsVisuals": head_pack.get("marsVisuals"),
    }
    dump(out / "jezero_pack.json", pack, compact=True)

    # fake.json back to the team placeholder (the build-against file before real data)
    orig = subprocess.run(["git", "-C", str(repo), "show", "b9462b7:public/data/fake.json"], capture_output=True, check=True).stdout
    (out / "fake.json").write_bytes(orig)
    print("done:", [p.name for p in out.iterdir()])


if __name__ == "__main__":
    main(sys.argv[1])
