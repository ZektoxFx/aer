"""Cut a 2 m elevation tile around the AER-1 crash site, for the 3D walking view.

Source: the 2 m grid that bake_terrain.py box-averages from the USGS Mars 2020 TRN HiRISE 1 m DTM
(work/terrain/elevation_2m.npy, same north-up local frame as jezero_pack.json's 10 m grid).

Output (in public/data/):
  terrain_patch_2m.bin   uint16 little-endian, row-major from the tile's north-west corner,
                         height = minM + value * 0.01 (centimetres above the tile's lowest point)
  terrain_patch_2m.json  size, position in the map frame, scale and source

Usage: python bake_patch.py WORK_DIR REPO_DIR
"""
import json
import sys
from pathlib import Path

import numpy as np

E_MIN, N_MAX = -3700.0, 2400.0      # map frame: xM = east - E_MIN, yM = N_MAX - north (bake_terrain.py)
SRC_CELL = 2.0
SIZE_M = 1600.0                     # tile edge
CENTRE_EAST, CENTRE_NORTH = -640.0, 230.0   # AER-1 cabin (jezero_pack.json crashedLander.cabinLocation)


def main(work, repo):
    z = np.load(Path(work) / "terrain" / "elevation_2m.npy")
    pack = json.loads((Path(repo) / "public/data/jezero_pack.json").read_text(encoding="utf-8"))
    cab = pack["crashedLander"]["cabinLocation"]
    assert (cab["eastingM"], cab["northingM"]) == (CENTRE_EAST, CENTRE_NORTH), cab

    x0 = CENTRE_EAST - E_MIN - SIZE_M / 2   # metres from the map's west edge
    y0 = N_MAX - CENTRE_NORTH - SIZE_M / 2  # metres from the map's north edge
    n = int(SIZE_M / SRC_CELL)
    c0, r0 = int(x0 / SRC_CELL), int(y0 / SRC_CELL)
    tile = z[r0:r0 + n, c0:c0 + n].astype(np.float64)
    assert tile.shape == (n, n) and not np.isnan(tile).any()

    lo = float(np.floor(tile.min() * 100) / 100)
    q = np.round((tile - lo) * 100)
    assert q.max() < 65535
    q = q.astype("<u2")

    # Check: 5 x 5 blocks of the tile average to the pack's 10 m cells.
    e = pack["elevation"]
    h10 = np.array(e["heightsM"], dtype=np.float64).reshape(e["rows"], e["cols"])
    k = int(e["cellM"] / SRC_CELL)
    blocks = (lo + q.astype(np.float64) / 100).reshape(n // k, k, n // k, k).mean(axis=(1, 3))
    ref = h10[int(y0 / e["cellM"]):int(y0 / e["cellM"]) + n // k, int(x0 / e["cellM"]):int(x0 / e["cellM"]) + n // k]
    diff = np.abs(blocks - ref)
    print(f"tile {n}x{n} @ {SRC_CELL} m, x0 {x0} y0 {y0}, height {lo:.2f} .. {tile.max():.2f} m; "
          f"vs 10 m pack grid: mean |diff| {diff.mean():.3f} m, max {diff.max():.3f} m")

    out = Path(repo) / "public/data"
    (out / "terrain_patch_2m.bin").write_bytes(q.tobytes())
    meta = {
        "source": "USGS Mars 2020 TRN HiRISE 1 m DTM (DOI 10.5066/P9REJ9JN), box-averaged to 2 m by "
                  "tools/data/bake_terrain.py and cut by tools/data/bake_patch.py",
        "use": "Fetch terrain_patch_2m.bin as an ArrayBuffer and read it as Uint16Array (little-endian). "
               "heightM = minM + value * scaleM. Row 0 is the tile's north edge, column 0 its west edge.",
        "file": "terrain_patch_2m.bin",
        "cols": n, "rows": n, "cellM": SRC_CELL,
        "x0M": x0, "y0M": y0,
        "frame": "Same frame as jezero_pack.json elevation: metres from the map's north-west corner, x east, "
                 "y south. Cell (row r, col c) covers x0M + c*cellM .. +cellM, y0M + r*cellM .. +cellM.",
        "centre": {"what": "AER-1 cabin (crashedLander.cabinLocation)", "eastM": CENTRE_EAST, "northM": CENTRE_NORTH},
        "minM": lo, "maxM": round(float(tile.max()), 2), "scaleM": 0.01,
        "checkAgainst10mGrid": {"meanAbsDiffM": round(float(diff.mean()), 3), "maxAbsDiffM": round(float(diff.max()), 3)},
        "notes": [
            "True heights, no vertical exaggeration.",
            "HiRISE DTMs with 1 m posts resolve features a few metres across (Kirk et al. 2008, JGR 113, E00A24), so 2 m keeps the useful detail.",
            "Covers the cabin, the descent stage, the parachute and backshell, the landing site and Ingenuity's airfield (south-east part).",
        ],
    }
    (out / "terrain_patch_2m.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
