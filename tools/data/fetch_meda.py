"""Download Perseverance MEDA CSVs for selected sols and reduce them to hourly + daily summaries.

Raw CSVs are deleted after summarising (the NMSU server is slow and files are 2-19 MB each).
Usage: python fetch_meda.py OUT_JSON_DIR
"""
import csv
import io
import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import requests

B = "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"
S = requests.Session()
SIGMA = 5.670374e-8

STORM = list(range(300, 331))           # Jan 2022 regional dust storm (sol ~313) and recovery
SEASON = list(range(15, 1760, 20))      # one sol every 20 sols, ~2.6 Mars years
SOLS = sorted(set(STORM + SEASON))


def folder(level, sol):
    lo = 0 if sol < 90 else 90 if sol < 180 else 180 + 120 * ((sol - 180) // 120)
    hi = 89 if sol < 90 else 179 if sol < 180 else lo + 119
    return f"{B}{level}/sol_{lo:04d}_{hi:04d}/sol_{sol:04d}/"


def listing(level, sol):
    for a in range(4):
        try:
            r = S.get(folder(level, sol), timeout=120)
            if r.status_code == 404:
                return []
            r.raise_for_status()
            return re.findall(r'href="(WE__[^"]+\.CSV)"', r.text)
        except requests.RequestException:
            time.sleep(5 * (a + 1))
    return []


def newest(files, tag):
    c = sorted(f for f in files if tag in f)
    return c[-1] if c else None


def get_csv(level, sol, name):
    for a in range(4):
        try:
            r = S.get(folder(level, sol) + name, timeout=600)
            r.raise_for_status()
            return list(csv.DictReader(io.StringIO(r.text)))
        except requests.RequestException:
            time.sleep(10 * (a + 1))
    return []


def ltst_hours(rows):
    out = []
    for r in rows:
        t = r["LTST"].split()[-1]
        h, m, s = (float(x) for x in t.split(":"))
        out.append(h + m / 60 + s / 3600)
    return np.array(out)


def col(rows, name):
    v = []
    for r in rows:
        x = r.get(name, "")
        try:
            f = float(x)
            v.append(np.nan if abs(f) >= 9e8 else f)
        except ValueError:
            v.append(np.nan)
    return np.array(v)


def hourly(h, v):
    out = []
    for k in range(24):
        m = (h >= k) & (h < k + 1) & ~np.isnan(v)
        out.append(round(float(np.mean(v[m])), 2) if m.sum() >= 30 else None)
    return out


def do_sol(sol):
    der, cal = listing("data_derived_env", sol), listing("data_calibrated_env", sol)
    res = {"sol": sol, "files": []}
    ps = newest(der, "_DER_PS_")
    if ps:
        rows = get_csv("data_derived_env", sol, ps)
        res["files"].append(ps)
        h, p = ltst_hours(rows), col(rows, "PRESSURE")
        res["pressurePa_hourly"] = hourly(h, p)
        res["pressurePa"] = [round(float(np.nanmin(p)), 1), round(float(np.nanmean(p)), 1), round(float(np.nanmax(p)), 1)]
    ats = newest(cal, "_CAL_ATS_")
    if ats:
        rows = get_csv("data_calibrated_env", sol, ats)
        res["files"].append(ats)
        h = ltst_hours(rows)
        t = np.nanmean(np.stack([col(rows, f"ATS_LOCAL_TEMP{i}") for i in range(1, 6)]), axis=0) - 273.15
        res["airTempC_hourly"] = hourly(h, t)
        hv = [x for x in res["airTempC_hourly"] if x is not None]
        if hv:
            res["airTempC"] = [min(hv), round(float(np.mean(hv)), 1), max(hv)]
        res["airTempHoursCovered"] = len(hv)
    ws = newest(der, "_DER_WS_")
    if ws:
        rows = get_csv("data_derived_env", sol, ws)
        res["files"].append(ws)
        h, w, d = ltst_hours(rows), col(rows, "HORIZONTAL_WIND_SPEED"), col(rows, "WIND_DIRECTION")
        res["windMS_hourly"] = hourly(h, w)
        res["windDirDeg_hourly"] = hourly(h, d)
        if np.isfinite(w).any():
            res["windMS"] = [round(float(np.nanmean(w)), 2), round(float(np.nanpercentile(w, 99)), 2)]
    tirs = newest(der, "_DER_TIRS_")
    if tirs:
        rows = get_csv("data_derived_env", sol, tirs)
        res["files"].append(tirs)
        h = ltst_hours(rows)
        up, dn = col(rows, "UPWARD_LW_IRRADIANCE"), col(rows, "DOWNWARD_LW_IRRADIANCE")
        with np.errstate(invalid="ignore"):
            tg = (up / (0.98 * SIGMA)) ** 0.25 - 273.15  # ground brightness temp, emissivity ~0.98 assumed
            ts = (dn / SIGMA) ** 0.25 - 273.15         # effective sky temperature
        res["groundTempC_hourly"] = hourly(h, tg)
        res["skyTempC_hourly"] = hourly(h, ts)
        res["downLW_Wm2_hourly"] = hourly(h, dn)
    return res


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    done = {int(p.stem.split("_")[1]) for p in out.glob("sol_*.json")}
    todo = [s for s in SOLS if s not in done]
    print(f"{len(todo)} sols to fetch", flush=True)
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(do_sol, todo):
            (out / f"sol_{r['sol']:04d}.json").write_text(json.dumps(r))
            print(r["sol"], r.get("pressurePa"), r.get("airTempC"), r.get("windMS"), flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
