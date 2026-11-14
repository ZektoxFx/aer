"""Bake relay.json (when Perseverance can reach an orbiter) and dustdevils.json (vortex timing at Jezero).

relay.json: orbit facts from NASA's Mars Relay Network Handbook (JPL D-71874, Release 4, April 27 2026).
dustdevils.json: every vortex in Table 1 of Jackson 2022 (PSJ 3, 20; arXiv 2109.04601), MEDA sols 15-89,
scaled to the coverage-corrected rate of Hueso et al. 2023 (JGR Planets 128, e2022JE007516).

Usage: python bake_extra.py VORTEX_PAPER_PDF REPO_DIR
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pypdf

HANDBOOK = ("NASA Mars Exploration Program, Mars Relay Network Handbook, JPL D-71874, Release 4 (April 27, 2026), "
            "Table 2-3 and sections 3.1, 3.3, 5.2. "
            "https://assets.science.nasa.gov/content/dam/science/psd/mars/files/mars-relay-network/"
            "MRN%20Handbook_v4_final_URS_cleared.pdf")
JACKSON = ("Jackson 2022, 'Vortices and Dust Devils as Observed by the MEDA Instruments on Board the Mars 2020 "
           "Perseverance Rover', Planetary Science Journal 3, 20 (arXiv 2109.04601), Table 1")
HUESO = ("Hueso et al. 2023, 'Convective Vortices and Dust Devils Detected and Characterized by Mars 2020', "
         "JGR Planets 128, e2022JE007516 (abstract)")


def relay():
    return {
        "source": HANDBOOK,
        "use": "When the astronaut can talk to Earth through Perseverance. The rover sends to an orbiter over UHF "
               "during a pass; the orbiter forwards to Earth later, and the signal then takes the one-way light time "
               "(reference.json mars.lightTimeOneWayMin). A reply comes up the same way on a later pass.",
        "jezeroLatDeg": 18.44,
        "orbiters": [
            {"id": "MRO", "name": "Mars Reconnaissance Orbiter (NASA)", "orbit": "low, near-polar, Sun-synchronous",
             "periodMin": 112, "nodesLMST": ["15:09", "03:09"],
             "passesPerSol": "at least 2 at low latitudes (Jezero is 18.4 N)",
             "usablePassMin": [10, 11], "shortPassMin": [7, 8],
             "note": "Short 7-8 min overflights are not usually used; 10-11 min is typical for the passes that are."},
            {"id": "ODY", "name": "2001 Mars Odyssey (NASA)", "orbit": "low, near-polar, Sun-synchronous",
             "periodMin": 118, "nodesLMST": ["06:11", "18:11"],
             "passesPerSol": "2-4 within 30 deg of the equator, clustered around the two node times",
             "averagePassMin": 14,
             "note": "Average time above 10 deg elevation."},
            {"id": "TGO", "name": "ExoMars Trace Gas Orbiter (ESA)", "orbit": "low, 76 deg inclination, not "
             "Sun-synchronous, so pass times drift from week to week",
             "periodMin": 118, "nodesLMST": None, "typicalSessionMin": 17,
             "note": "A typical TGO session with adaptive data rate lasts about 17 minutes."},
            {"id": "MEX", "name": "Mars Express (ESA)", "orbit": "elliptical, 7 h period",
             "periodMin": 419, "nodesLMST": None,
             "note": "Highly elliptical orbit: less frequent passes with widely varying range."},
        ],
        "notMoreAvailable": {"MAVEN": "Lost in 2025 (handbook section 1). Do not list it as a current relay."},
        "gameWindowsLTST": {
            "about": "Simple schedule for the game: the two Sun-synchronous orbiters pass Jezero near fixed local "
                     "times. Windows are node time +/- 1 h because the nearest ground track can fall either side of "
                     "the site. Times are LMST; the game clock is LTST, which differs by up to about 50 minutes over "
                     "the Mars year, so treat the windows as approximate. TGO adds about one pass at a varying time.",
            "windows": [
                {"orbiter": "MRO", "centre": "03:09", "fromHour": 2.15, "toHour": 4.15, "passMin": 10},
                {"orbiter": "ODY", "centre": "06:11", "fromHour": 5.18, "toHour": 7.18, "passMin": 14},
                {"orbiter": "MRO", "centre": "15:09", "fromHour": 14.15, "toHour": 16.15, "passMin": 10},
                {"orbiter": "ODY", "centre": "18:11", "fromHour": 17.18, "toHour": 19.18, "passMin": 14},
            ],
            "values": "Window width and the one-pass-per-window rule are design simplifications; node times and "
                      "pass lengths are from the handbook.",
        },
    }


def vortices(pdf):
    r = pypdf.PdfReader(pdf)
    text = re.sub(r"[ \t]+", " ", "\n".join(p.extract_text() or "" for p in r.pages))
    rows = re.findall(r"^(\d{1,3}) (\d{1,2}):(\d\d):(\d\d(?:\.\d+)?)±\S+ ([\d.]+)±\S+ ([\d.]+)±\S+ (\S+)", text, re.M)
    assert len(rows) == 309, len(rows)  # the paper reports 309 encounters
    return [{"sol": int(s), "ltstHour": int(h) + int(m) / 60 + float(sec) / 3600, "dropPa": float(dp),
             "durationS": float(g), "dusty": rds != "-"} for s, h, m, sec, dp, g, rds in rows]


def dust_devils(pdf):
    v = vortices(pdf)
    per_sol = 4.9
    count = Counter(int(x["ltstHour"]) for x in v)
    dusty = Counter(int(x["ltstHour"]) for x in v if x["dusty"])
    n = len(v)
    hourly = [{"hour": h, "vortices": count.get(h, 0), "dusty": dusty.get(h, 0),
               "expectedPerSol": round(per_sol * count.get(h, 0) / n, 3)} for h in range(24)]
    drops = sorted(x["dropPa"] for x in v)
    return {
        "source": f"{JACKSON}; rates from {HUESO}",
        "use": "When and how often a dust devil passes the astronaut. expectedPerSol for an hour is the chance-weighted "
               "number of vortices passing within MEDA's reach in that LTST hour; sum over the sol is 4.9. About one "
               "in four carries visible dust.",
        "perSol": per_sol,
        "perSolNote": "Vortices with pressure drop > 0.5 Pa, corrected for gaps in MEDA coverage, 415 sols (Hueso 2023).",
        "peakPerHourNoon": 1.5,
        "peakNote": "1.5 +/- 0.2 encounters per hour at midday (Jackson 2022), about one every 40 minutes.",
        "dustyFraction": round(sum(x["dusty"] for x in v) / n, 2),
        "dustyNote": "74 of 309 vortices showed a dust signal (Jackson 2022); Hueso 2023: at least one in five, and 75% "
                     "of vortices with drop > 2 Pa.",
        "diameterM": {"min": 5, "mean": 20, "max": 135},
        "strongest": {"dropPa": 9.0, "windMS": 25, "note": "Strongest vortex in 415 sols (Hueso 2023)."},
        "activityPerKm2PerSol": [2.0, 3.0],
        "pressureDropPa": {"min": drops[0], "median": drops[n // 2], "max": drops[-1],
                           "over1Pa": sum(d > 1 for d in drops), "over2Pa": sum(d > 2 for d in drops)},
        "duringStorm": "Dust devils were abundant during the January 2022 regional dust storm (Ls 152-156, the "
                       "storm sols in dust.json) (Hueso 2023).",
        "hourlyLTST": hourly,
        "notes": [
            "Hourly shape: counts of the 309 encounters in sols 15-89 by LTST hour. MEDA logged most daytime hours "
            "on most sols; the scaled noon rate (1.43/h) matches the paper's 1.5 +/- 0.2.",
            "None were seen before 08:00 or after 20:00 LTST.",
        ],
    }


def main(pdf, repo):
    out = Path(repo) / "public/data"
    (out / "relay.json").write_text(json.dumps(relay(), ensure_ascii=False, indent=1), encoding="utf-8")
    dd = dust_devils(pdf)
    (out / "dustdevils.json").write_text(json.dumps(dd, ensure_ascii=False, indent=1), encoding="utf-8")
    print("relay.json; dustdevils.json:", sum(h["vortices"] for h in dd["hourlyLTST"]), "vortices, noon rate",
          next(h["expectedPerSol"] for h in dd["hourlyLTST"] if h["hour"] == 12))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
