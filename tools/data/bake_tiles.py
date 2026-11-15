"""Cut sharper HiRISE photo tiles for the 3D walking view.

The whole-area photo (jezero_base_2m.jpg) is 2 m per pixel, which blurs when the camera stands on it.
These tiles add detail where the player walks; the 3D terrain shader blends them over the base photo.

  jezero_tile_1m.jpg    1 m per pixel, from the cabin west to the rover's parking spots
                        (cut from work/terrain/ortho_1m.npy, no download)
  jezero_tile_25cm.jpg  0.25 m per pixel (the mosaic's full resolution), 512 m square on the AER-1 cabin
                        (read from the USGS mosaic with HTTP range requests)
  terrain_tiles.json    where each tile sits in the map frame

Both use the same contrast stretch as jezero_base_2m.jpg (bake_pack.py), so they blend without a seam.
Source: USGS Mars 2020 TRN HiRISE orthomosaic, 25 cm (DOI 10.5066/P9REJ9JN).

Usage: python bake_tiles.py WORK_DIR REPO_DIR [1m|25cm|all]
"""
import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from bake_terrain import COSLAT, E_MIN, LAND_LAT, LAND_LON, N_MAX, ORTHO  # noqa: E402
from remote_tiff import MARS_R, HttpFile, geo  # noqa: E402

CABIN_X, CABIN_Y = -640.0 - E_MIN, N_MAX - 230.0   # map frame (metres from the NW corner): 3060, 2170

# name, metres per pixel, x0M, y0M, widthM, heightM
TILE_1M = ("jezero_tile_1m.jpg", 1.0, CABIN_X - 2400.0, CABIN_Y - 1024.0, 3072.0, 2048.0)
TILE_25CM = ("jezero_tile_25cm.jpg", 0.25, CABIN_X - 256.0, CABIN_Y - 256.0, 512.0, 512.0)


def stretch_limits(work):
    """The same 0.3 % and 99.7 % limits bake_pack.py uses for jezero_base_2m.jpg."""
    o = np.load(Path(work) / "terrain" / "ortho_1m.npy")
    lo, hi = np.nanpercentile(o, [0.3, 99.7])
    return o, float(lo), float(hi)


def to_u8(a, lo, hi):
    return np.clip((np.nan_to_num(a, nan=lo) - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8)


def read_window(url, x0m, y0m, wm, hm, step):
    """Bilinear samples of the remote mosaic on a north-up ground grid (row 0 = north edge)."""
    f = HttpFile(url)
    tif = tifffile.TiffFile(f)
    page = tif.pages[0]
    gx0, gy0, dx, dy = geo(page)
    H, W = page.shape
    dt = page.dtype.newbyteorder(tif.byteorder)
    bpp = dt.itemsize
    offs = page.dataoffsets
    assert not page.is_tiled and page.rowsperstrip == 1 and page.compression.name == "NONE"

    ncols, nrows = int(round(wm / step)), int(round(hm / step))
    es = E_MIN + x0m + (np.arange(ncols) + 0.5) * step
    ns = N_MAX - y0m - (np.arange(nrows) + 0.5) * step
    lons = LAND_LON + np.degrees(es / (MARS_R * COSLAT))
    lats = LAND_LAT + np.degrees(ns / MARS_R)
    # Fractional source pixel centres (pixel i covers [i, i+1), so its centre is i + 0.5).
    sc = (MARS_R * np.radians(lons) - gx0) / dx - 0.5
    sr = (MARS_R * np.radians(lats) - gy0) / dy - 0.5
    c0, c1 = int(math.floor(sc.min())), int(math.floor(sc.max())) + 2
    r0, r1 = int(math.floor(sr.min())), int(math.floor(sr.max())) + 2
    assert 0 <= c0 and c1 <= W and 0 <= r0 and r1 <= H
    print(f"{url.rsplit('/', 1)[-1]}: {nrows}x{ncols} @ {step} m from source rows {r0}-{r1}, cols {c0}-{c1} "
          f"(source pixel {abs(dx):.3f} m, {abs(dx) * COSLAT:.3f} m east-west on the ground)", flush=True)

    def get(r):
        return np.frombuffer(f.fetch(offs[r] + c0 * bpp, (c1 - c0) * bpp), dtype=dt)

    with ThreadPoolExecutor(16) as ex:
        block = np.stack(list(ex.map(get, range(r0, r1)))).astype(np.float32)
    nodata = int((block == 0).sum())
    ci = np.floor(sc).astype(int) - c0
    ri = np.floor(sr).astype(int) - r0
    fc = (sc - np.floor(sc)).astype(np.float32)[None, :]
    fr = (sr - np.floor(sr)).astype(np.float32)[:, None]
    a = block[np.ix_(ri, ci)]
    b = block[np.ix_(ri, ci + 1)]
    c = block[np.ix_(ri + 1, ci)]
    d = block[np.ix_(ri + 1, ci + 1)]
    out = (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr
    print(f"  read {block.shape}, no-data pixels {nodata}", flush=True)
    return out


def main(work, repo, which="all"):
    out = Path(repo) / "public" / "data"
    ortho, lo, hi = stretch_limits(work)
    meta_path = out / "terrain_tiles.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    tiles = {t["file"]: t for t in meta.get("tiles", [])}

    def record(spec, img, quality):
        name, step, x0, y0, wm, hm = spec
        img.save(out / name, quality=quality, optimize=True, progressive=True)
        tiles[name] = {"file": name, "metresPerPixel": step, "x0M": x0, "y0M": y0, "widthM": wm, "heightM": hm,
                       "cols": img.width, "rows": img.height}
        print(f"  {name}: {img.width}x{img.height}, {(out / name).stat().st_size / 1e6:.2f} MB", flush=True)

    if which in ("all", "1m"):
        name, step, x0, y0, wm, hm = TILE_1M
        crop = ortho[int(y0):int(y0 + hm), int(x0):int(x0 + wm)]
        assert crop.shape == (int(hm), int(wm)), crop.shape
        record(TILE_1M, Image.fromarray(to_u8(crop, lo, hi)), 80)

    if which in ("all", "25cm"):
        name, step, x0, y0, wm, hm = TILE_25CM
        win = read_window(ORTHO, x0, y0, wm, hm, step)
        # Check against the 1 m grid already on disk: 4 x 4 blocks of the tile should match it closely.
        n = int(1.0 / step)
        blocks = win.reshape(win.shape[0] // n, n, win.shape[1] // n, n).mean(axis=(1, 3))
        ref = ortho[int(y0):int(y0 + hm), int(x0):int(x0 + wm)]
        diff = np.abs(blocks - ref)
        corr = float(np.corrcoef(blocks.ravel(), ref.ravel())[0, 1])
        print(f"  vs ortho_1m.npy: mean |diff| {np.nanmean(diff):.2f} of 255, correlation {corr:.4f}", flush=True)
        assert corr > 0.97, "the 25 cm tile does not line up with the 1 m grid"
        record(TILE_25CM, Image.fromarray(to_u8(win, lo, hi)), 80)

    order = [TILE_1M[0], TILE_25CM[0]]
    meta = {
        "source": "USGS Mars 2020 TRN HiRISE orthomosaic, 25 cm (DOI 10.5066/P9REJ9JN), resampled by "
                  "tools/data/bake_tiles.py with the same contrast stretch as jezero_base_2m.jpg",
        "use": "Sharper photo tiles for the 3D view, drawn over jezero_base_2m.jpg. Optional: the view works "
               "without them. Row 0 is the tile's north edge, column 0 its west edge.",
        "frame": "Same frame as jezero_pack.json: metres from the map's north-west corner, x east, y south.",
        "credit": "NASA/JPL-Caltech/University of Arizona, USGS Astrogeology Science Center",
        "tiles": [tiles[n] for n in order if n in tiles],
    }
    meta_path.write_text(json.dumps(meta, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("wrote", meta_path)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "all")
