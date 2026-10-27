"""Ground relief for the offline reserve maps, from the Environment Agency's 1 m LiDAR.

For each reserve (+500 m) this fetches the LiDAR Composite DTM 1 m (OGL) and works out a
shading factor that build_tiles.py multiplies into the OS map:

  - a soft multi-direction hillshade, for the shape of the land;
  - a local relief model (the ground minus a smoothed copy of itself), which strips out the
    hillside and leaves the small stuff: walls and banks (raised) and ditches, drains, grips
    and peat cuttings (sunk). This is what makes features findable on the ground.

The strength fades to nothing over the outer 200 m so the edge of the LiDAR doesn't show.
Output: build/src/relief/<REF_CODE>.tif, float32 factor on the British National Grid
(1 = no change, <1 darker, >1 lighter). Downloads are cached in build/src/lidar/.

Run with the Terra venv (rasterio, scipy):
  C:/Dev/Terra/.venv/Scripts/python.exe build/build_relief.py
Contains Environment Agency data © Environment Agency (OGL v3).
"""
import json, math, time, urllib.error, urllib.request
from pathlib import Path

import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.warp import transform_bounds
from scipy.ndimage import distance_transform_edt, gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "build" / "src" / "lidar"
OUT = ROOT / "build" / "src" / "relief"
WCS = ("https://environment.data.gov.uk/spatialdata/lidar-composite-digital-terrain-model-dtm-1m/wcs"
       "?service=WCS&version=2.0.1&request=GetCoverage"
       "&coverageId=13787b9a-26a4-4775-8523-806d13af58fc__Lidar_Composite_Elevation_DTM_1m"
       "&subset=E({e0},{e1})&subset=N({n0},{n1})&format=image/tiff")
TEAM = ["1006114", "1006954", "1006126", "1006058", "1006067", "1006018", "1006111"]
BUFFER, FEATHER, TILE_M = 500, 200, 1200


def fetch(e0, n0):
    path = CACHE / f"dtm_{e0}_{n0}.tif"
    if path.exists() and path.stat().st_size > 1000:
        return path
    url = WCS.format(e0=e0, e1=e0 + TILE_M, n0=n0, n1=n0 + TILE_M)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                data = r.read()
            if data[:2] not in (b"II", b"MM"):  # not a TIFF: an error message (e.g. no coverage)
                return None
            path.write_bytes(data)
            return path
        except (urllib.error.URLError, TimeoutError) as err:
            print(f"    retry {attempt + 1}: {err}")
            time.sleep(5 * (attempt + 1))
    return None


def hillshade(z, az, alt=40, exaggerate=2.0):
    gy, gx = np.gradient(z * exaggerate)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, h = math.radians(az), math.radians(alt)
    return np.sin(h) * np.cos(slope) + np.cos(h) * np.sin(slope) * np.cos(a - aspect)


def relief(dtm, valid):
    z = np.where(valid, dtm, np.nan)
    fill = np.nanmedian(z) if np.isfinite(z).any() else 0
    z = np.where(valid, dtm, fill)
    # Shape of the land: lit from the north-west, with a softer light from the north-east so
    # banks running NW-SE don't vanish. Never opposite pairs: averaging light from both sides
    # cancels the edges out and leaves only blotches (the mush seen close up in build 122).
    # Measured from what flat ground looks like, so flat moss stays mid-grey, not stretched.
    hs = 0.65 * hillshade(z, 315) + 0.35 * hillshade(z, 45) - math.sin(math.radians(40))
    # The small stuff: ground minus a 10 m-smoothed copy of itself, so a bank or a ditch reads
    # as raised or sunk even on a slope (tanh keeps the big ones from going solid)
    lrm = (z - gaussian_filter(z, 10)) / 0.4
    f = 1 + 0.36 * np.tanh(hs * 4) + 0.2 * np.tanh(lrm)
    # Fade out over the outer edge, and wherever there's no LiDAR (sea, gaps)
    dist = distance_transform_edt(valid)
    edge = np.ones_like(dist)
    edge[[0, -1], :] = edge[:, [0, -1]] = 0
    dist = np.minimum(dist, distance_transform_edt(edge))
    w = np.clip(dist / FEATHER, 0, 1)
    return (1 + (f - 1) * w).astype(np.float32)


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    gj = json.loads((ROOT / "data" / "nnr.geojson").read_text("utf-8"))
    for f in gj["features"]:
        code = f["properties"]["REF_CODE"]
        if code not in TEAM:
            continue
        out = OUT / f"{code}.tif"
        if out.exists():
            print(f"{f['properties']['LABEL']}: done already")
            continue
        g = f["geometry"]
        cs = [c for p in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]) for c in p[0]]
        w, s, e, n = transform_bounds("EPSG:4326", "EPSG:27700", min(c[0] for c in cs), min(c[1] for c in cs), max(c[0] for c in cs), max(c[1] for c in cs))
        e0, n0 = int((w - BUFFER) // TILE_M * TILE_M), int((s - BUFFER) // TILE_M * TILE_M)
        e1, n1 = int(e + BUFFER), int(n + BUFFER)
        boxes = [(x, y) for x in range(e0, e1, TILE_M) for y in range(n0, n1, TILE_M)]
        print(f"{f['properties']['LABEL']}: {len(boxes)} LiDAR tiles")
        paths = [p for p in (fetch(x, y) for x, y in boxes) if p]
        if not paths:
            print("  no LiDAR here")
            continue
        srcs = [rasterio.open(p) for p in paths]
        mosaic, transform = merge(srcs, bounds=(w - BUFFER, s - BUFFER, e + BUFFER, n + BUFFER), res=1, nodata=-9999)
        for d in srcs:
            d.close()
        dtm = mosaic[0].astype(np.float32)
        valid = (dtm > -1000) & np.isfinite(dtm)
        fac = relief(dtm, valid)
        with rasterio.open(out, "w", driver="GTiff", width=fac.shape[1], height=fac.shape[0], count=1, dtype="float32",
                           crs="EPSG:27700", transform=transform, compress="deflate", nodata=None) as d:
            d.write(fac, 1)
        print(f"  {fac.shape[1]} x {fac.shape[0]} m, {valid.mean() * 100:.0f}% covered")


if __name__ == "__main__":
    main()
