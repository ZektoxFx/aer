"""Bake the AER map area from the USGS Mars 2020 TRN HiRISE mosaics.

Output grids are in true ground metres on a local east/north plane around the landing site,
north-up, so one cell is the same distance in both directions (the source equirectangular
projection, latTs=0, is stretched east-west by 1/cos(lat)).

Usage: python bake_terrain.py OUT_DIR
"""
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile

sys.path.insert(0, str(Path(__file__).parent))
from remote_tiff import MARS_R, HttpFile, geo  # noqa: E402

BASE = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
DTM = BASE + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO = BASE + "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"

# Octavia E. Butler Landing: first Perseverance localisation (sol 13, MMGIS M20_waypoints.json)
LAND_LON, LAND_LAT = 77.45088572, 18.44462715
COSLAT = math.cos(math.radians(LAND_LAT))
# Area, in metres east/north of the landing site
E_MIN, E_MAX = -3700.0, 2700.0
N_MIN, N_MAX = -1600.0, 2400.0


def sample_grid(url, step_m, row_stride_px, chunk=200):
    """Box-average the source onto a ground grid of step_m (north row first).

    Reads every row_stride_px-th source row, only the columns covering the area.
    """
    f = HttpFile(url)
    tif = tifffile.TiffFile(f)
    page = tif.pages[0]
    x0, y0, dx, dy = geo(page)
    H, W = page.shape
    dt = page.dtype.newbyteorder(tif.byteorder)
    bpp = dt.itemsize
    offs = page.dataoffsets
    assert not page.is_tiled and page.rowsperstrip == 1 and page.compression.name == "NONE"

    ncols = int(round((E_MAX - E_MIN) / step_m))
    nrows = int(round((N_MAX - N_MIN) / step_m))
    es = E_MIN + (np.arange(ncols) + 0.5) * step_m
    ns = N_MAX - (np.arange(nrows) + 0.5) * step_m
    lons = LAND_LON + np.degrees(es / (MARS_R * COSLAT))
    lats = LAND_LAT + np.degrees(ns / MARS_R)
    src_c = (MARS_R * np.radians(lons) - x0) / dx  # fractional source column per target col
    src_r = (MARS_R * np.radians(lats) - y0) / dy  # fractional source row per target row
    half_c = step_m / COSLAT / abs(dx) / 2  # half-width in source columns
    half_r = step_m / abs(dy) / 2
    c0 = max(0, int(src_c[0] - half_c) - 1)
    c1 = min(W, int(src_c[-1] + half_c) + 2)
    ncol = c1 - c0
    assert 0 <= src_r[0] - half_r and src_r[-1] + half_r < H
    ca = np.clip(np.floor(src_c - half_c).astype(int) - c0, 0, ncol)
    cb = np.clip(np.ceil(src_c + half_c).astype(int) - c0, 0, ncol)
    print(f"{url.rsplit('/', 1)[-1]}: {nrows}x{ncols} @ {step_m} m, cols {c0}-{c1}, row stride {row_stride_px}")

    def get(r):
        return np.frombuffer(f.fetch(offs[r] + c0 * bpp, ncol * bpp), dtype=dt)

    out = np.full((nrows, ncols), np.nan, dtype=np.float32)
    ex = ThreadPoolExecutor(16)
    for t0 in range(0, nrows, chunk):
        t1 = min(nrows, t0 + chunk)
        ra = np.floor(src_r[t0:t1] - half_r).astype(int)
        rb = np.ceil(src_r[t0:t1] + half_r).astype(int)
        lo, hi = ra.min(), rb.max()
        rows = list(range(lo - lo % row_stride_px, hi, row_stride_px))
        block = np.stack(list(ex.map(get, rows))).astype(np.float32)
        if dt.kind == "f":
            block[block < -1e30] = np.nan
        else:
            block[block == 0] = np.nan
        valid = ~np.isnan(block)
        S = np.pad(np.where(valid, block, 0).astype(np.float64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        C = np.pad(valid.astype(np.float64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
        rows_arr = np.array(rows)
        ia = np.searchsorted(rows_arr, ra)
        ib = np.searchsorted(rows_arr, rb)
        ib = np.maximum(ib, ia + 1)
        tot = S[ib][:, cb] - S[ia][:, cb] - S[ib][:, ca] + S[ia][:, ca]
        cnt = C[ib][:, cb] - C[ia][:, cb] - C[ib][:, ca] + C[ia][:, ca]
        with np.errstate(invalid="ignore", divide="ignore"):
            out[t0:t1] = tot / cnt
        print(f"  rows {t1}/{nrows}", flush=True)
    ex.shutdown()
    return out


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    which = sys.argv[2] if len(sys.argv) > 2 else "all"
    if which in ("all", "dtm"):
        z = sample_grid(DTM, 2.0, 1)
        print("DTM 2 m", z.shape, "NaN", int(np.isnan(z).sum()), "range", np.nanmin(z), np.nanmax(z))
        np.save(out / "elevation_2m.npy", z)
    if which in ("all", "ortho"):
        img = sample_grid(ORTHO, 1.0, 2)
        print("Ortho 1 m", img.shape, "NaN", int(np.isnan(img).sum()))
        np.save(out / "ortho_1m.npy", img)
    meta = dict(landing_lon=LAND_LON, landing_lat=LAND_LAT, e_min=E_MIN, e_max=E_MAX,
                n_min=N_MIN, n_max=N_MAX, dtm=DTM, ortho=ORTHO,
                note="Grids are north-up, row 0 = north edge, true ground metres east/north of the landing site")
    (out / "terrain_meta.json").write_text(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
