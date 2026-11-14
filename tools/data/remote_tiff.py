"""Read windows from big remote GeoTIFFs with HTTP range requests (no GDAL needed).

Works for tiled or striped TIFFs. Only the tiles that cover the requested window are fetched.
Projection helpers assume the USGS Mars equirectangular products (lat_ts=0, lon_0=0, R=3396190 m).
"""
import io
import math

import numpy as np
import requests
import tifffile

MARS_R = 3396190.0
S = requests.Session()


class HttpFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, with a small block cache."""

    BLOCK = 1 << 20

    def __init__(self, url):
        self.url = url
        r = S.head(url, allow_redirects=True, timeout=60)
        r.raise_for_status()
        self.size = int(r.headers["Content-Length"])
        self.pos = 0
        self.cache = {}

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i):
        if i not in self.cache:
            a = i * self.BLOCK
            b = min(a + self.BLOCK, self.size) - 1
            for attempt in range(4):
                try:
                    r = S.get(self.url, headers={"Range": f"bytes={a}-{b}"}, timeout=120)
                    r.raise_for_status()
                    break
                except requests.RequestException:
                    if attempt == 3:
                        raise
            self.cache[i] = r.content
            if len(self.cache) > 256:
                self.cache.pop(next(iter(self.cache)))
        return self.cache[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            i, o = divmod(self.pos, self.BLOCK)
            blk = self._block(i)[o:o + n]
            out += blk
            self.pos += len(blk)
            n -= len(blk)
        return bytes(out)

    def readinto(self, b):
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)

    def fetch(self, off, n):
        r = S.get(self.url, headers={"Range": f"bytes={off}-{off + n - 1}"}, timeout=300)
        r.raise_for_status()
        return r.content


def geo(page):
    """Return (x0, y0, dx, dy) of the top-left pixel corner in projected metres."""
    tags = page.tags
    sx, sy, _ = tags["ModelPixelScaleTag"].value
    tp = tags["ModelTiepointTag"].value
    i, j, _, x, y, _ = tp[:6]
    return x - i * sx, y + j * sy, sx, -sy


def lonlat_to_xy(lon, lat, lon0=0.0):
    return MARS_R * math.radians(lon - lon0), MARS_R * math.radians(lat)


def read_window(src, page_index, row0, col0, rows, cols):
    """Read a pixel window from a (possibly remote) TIFF page by fetching only needed tiles/strips."""
    tif = tifffile.TiffFile(src)
    page = tif.pages[page_index]
    H, W = page.shape[:2]
    spp = page.samplesperpixel
    out_shape = (rows, cols) if spp == 1 else (rows, cols, spp)
    out = np.zeros(out_shape, dtype=page.dtype)
    if page.is_tiled:
        th, tw = page.tilelength, page.tilewidth
        tiles_across = math.ceil(W / tw)
        t_r0, t_r1 = row0 // th, (row0 + rows - 1) // th
        t_c0, t_c1 = col0 // tw, (col0 + cols - 1) // tw
        for tr in range(t_r0, t_r1 + 1):
            for tc in range(t_c0, t_c1 + 1):
                idx = tr * tiles_across + tc
                off, n = page.dataoffsets[idx], page.databytecounts[idx]
                if n == 0:
                    continue
                raw = src.fetch(off, n) if hasattr(src, "fetch") else _local(src, off, n)
                tile, _, _ = page.decode(raw, idx)
                tile = tile.reshape((th, tw) if spp == 1 else (th, tw, spp))
                r_a, c_a = tr * th, tc * tw
                rs, re_ = max(row0, r_a), min(row0 + rows, r_a + th, H)
                cs, ce = max(col0, c_a), min(col0 + cols, c_a + tw, W)
                if rs < re_ and cs < ce:
                    out[rs - row0:re_ - row0, cs - col0:ce - col0] = tile[rs - r_a:re_ - r_a, cs - c_a:ce - c_a]
    else:
        rps = page.rowsperstrip
        for s in range(row0 // rps, (row0 + rows - 1) // rps + 1):
            off, n = page.dataoffsets[s], page.databytecounts[s]
            raw = src.fetch(off, n) if hasattr(src, "fetch") else _local(src, off, n)
            strip, _, _ = page.decode(raw, s)
            strip = strip.reshape((-1, W) if spp == 1 else (-1, W, spp))
            r_a = s * rps
            rs, re_ = max(row0, r_a), min(row0 + rows, r_a + strip.shape[0])
            out[rs - row0:re_ - row0] = strip[rs - r_a:re_ - r_a, col0:col0 + cols]
    return out


def _local(f, off, n):
    f.seek(off)
    return f.read(n)
