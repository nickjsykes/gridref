"""Banner art for the notebook: each team reserve drawn as contour lines from its real ground.

The Environment Agency's 1 m LiDAR (cached by build_relief.py in build/src/lidar/) is averaged
to a 4 m grid, smoothed, and contoured at an interval that suits the reserve: tight on a flat
moss (where a 25 cm step shows the dome of a raised bog), wider on a limestone ridge. Every
fifth line is a little stronger, as on an OS map, and the reserve's boundary is drawn over the
top. Lines only, in white, for the spruce banner (the app inverts them in dark mode).

"All reserves" gets an overview of the patch: the coast and the big lakes (OpenStreetMap, via
Overpass) with the seven reserves drawn where they lie.

Output: art/banner/<REF_CODE>.svg and art/banner/all.svg
Run with the Terra venv (rasterio, scipy, pyproj, matplotlib), after build_relief.py:
  C:/Dev/Terra/.venv/Scripts/python.exe build/draw_banners.py
Contains Environment Agency data © Environment Agency (OGL v3). Boundaries © Natural England.
Coast and lakes © OpenStreetMap contributors (ODbL).
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.merge import merge
from scipy.ndimage import gaussian_filter
from shapely.geometry import LineString

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "build" / "src" / "lidar"
OUT = ROOT / "art" / "banner"
TEAM = ["1006114", "1006954", "1006126", "1006058", "1006067", "1006018", "1006111"]
SMOOTH = 4        # cells (16 m): soft, flowing lines rather than every bump
CELL = 4          # metres: fine enough for the land's shape, coarse enough for smooth lines
BUFFER = 400      # metres round the reserve (the LiDAR cache reaches 500)
WIDTH = 1200      # SVG units across
STEPS = [0.25, 0.5, 1, 2, 2.5, 5, 10, 20]
LINES = 14        # roughly how many contours across the reserve's height range: few, so it reads small
TOL = 2.5         # SVG units: how far a simplified line may stray (under 2 px on a phone)
MIN_LEN = 90      # SVG units: shorter wisps are noise, not land


def reserve_rings(code):
    gj = json.loads((ROOT / "data" / "nnr.geojson").read_text("utf-8"))
    f = next(f for f in gj["features"] if f["properties"].get("REF_CODE") == code)
    to_bng = Transformer.from_crs(4326, 27700, always_xy=True)
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return f["properties"].get("NAME", code), [[to_bng.transform(x, y) for x, y in ring] for poly in polys for ring in poly]


def ground(e0, n0, e1, n1):
    tiles = []
    for p in CACHE.glob("dtm_*.tif"):
        _, te, tn = p.stem.split("_")
        te, tn = int(te), int(tn)
        if te < e1 and te + 1200 > e0 and tn < n1 and tn + 1200 > n0:
            tiles.append(rasterio.open(p))
    z, _ = merge(tiles, bounds=(e0, n0, e1, n1), nodata=np.nan)
    for t in tiles:
        t.close()
    z = z[0].astype("float32")
    z[z < -100] = np.nan
    # 1 m to CELL m by block means (gaps stay gaps)
    h, w = (z.shape[0] // CELL) * CELL, (z.shape[1] // CELL) * CELL
    z = np.nanmean(z[:h, :w].reshape(h // CELL, CELL, w // CELL, CELL), axis=(1, 3))
    # smooth, filling gaps from their neighbours so lines don't fray at a hole
    gap = np.isnan(z)
    filled = np.where(gap, np.nanmedian(z), z)
    smooth = gaussian_filter(filled, SMOOTH)
    weight = gaussian_filter((~gap).astype("float32"), SMOOTH)
    z = gaussian_filter(np.where(gap, 0, z), SMOOTH) / np.maximum(weight, 1e-3)
    z[weight < 0.3] = np.nan
    return z, smooth


def draw(code):
    name, rings = reserve_rings(code)
    xs = [x for r in rings for x, _ in r]
    ys = [y for r in rings for _, y in r]
    e0, e1 = int(min(xs)) - BUFFER, int(max(xs)) + BUFFER
    n0, n1 = int(min(ys)) - BUFFER, int(max(ys)) + BUFFER
    z, _ = ground(e0, n0, e1, n1)
    lo, hi = np.nanpercentile(z, 2), np.nanpercentile(z, 98)
    step = min(STEPS, key=lambda s: abs((hi - lo) / s - LINES))
    levels = np.arange(np.floor(np.nanmin(z) / step) * step, np.nanmax(z) + step, step)
    ny, nx = z.shape
    k = WIDTH / nx                       # grid cells to SVG units
    H = ny * k
    xs_g = np.arange(nx) + 0.5
    ys_g = np.arange(ny) + 0.5
    cs = plt.contour(xs_g, ys_g, z, levels=levels)
    paths = {"minor": [], "index": []}
    for lev, segs in zip(cs.levels, cs.allsegs):
        kind = "index" if round(lev / step) % 5 == 0 else "minor"
        for seg in segs:
            if len(seg) < 3:
                continue
            line = LineString(seg * k)   # grid rows run north to south from the top
            if line.length < MIN_LEN:
                continue                 # specks: noise, not land
            pts = line.simplify(TOL).coords
            paths[kind].append("M" + "L".join(f"{x:.0f},{y:.0f}" for x, y in pts))
    plt.close("all")
    # the boundary, in the same frame (row 0 is the north edge)
    bound = []
    for r in rings:
        ring = LineString([((x - e0) / CELL * k, (n1 - y) / CELL * k) for x, y in r]).simplify(TOL / 2)
        bound.append("M" + "L".join(f"{x:.0f},{y:.0f}" for x, y in ring.coords) + "Z")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {H:.0f}" preserveAspectRatio="xMidYMid slice">'
        f"<!-- {name}: contours every {step:g} m from Environment Agency LiDAR (OGL v3); boundary © Natural England -->"
        f'<g fill="none" stroke="#fff" stroke-linejoin="round" stroke-linecap="round">'
        f'<path stroke-width="2.4" stroke-opacity=".6" d="{"".join(paths["minor"])}"/>'
        f'<path stroke-width="3.6" stroke-opacity=".85" d="{"".join(paths["index"])}"/>'
        f'<path stroke-width="7" d="{"".join(bound)}"/>'
        "</g></svg>"
    )
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{code}.svg"
    out.write_text(svg, "utf-8", newline="\n")
    print(f"{name}: {step:g} m contours, {len(paths['minor']) + len(paths['index'])} lines, {out.stat().st_size // 1024} KB")


# The overview: South Cumbria from Hallsenna to Gait Barrows
AREA = (-3.47, 54.09, -2.74, 54.42)   # west, south, east, north (WGS84)
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]


def osm_lines():
    w, s_, e, n = AREA
    q = (f'[out:json][timeout:120];(way["natural"="coastline"]({s_},{w},{n},{e});'
         f'way["natural"="water"]["name"~"Windermere|Coniston Water|Esthwaite Water"]({s_},{w},{n},{e});'
         f'relation["natural"="water"]["name"~"Windermere|Coniston Water|Esthwaite Water"]({s_},{w},{n},{e}););out geom;')
    els = None
    for url in OVERPASS * 2:             # busy servers say 502/504: try the next, then again
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "FieldNotes-banner/1"})
            with urllib.request.urlopen(req, timeout=180) as r:
                els = json.load(r)["elements"]
            break
        except Exception as err:
            print(f"  {url}: {err}")
            time.sleep(10)
    if els is None:
        raise SystemExit("Overpass is busy: try again later")
    out = []
    for el in els:
        if el["type"] == "way":
            out.append([(p["lon"], p["lat"]) for p in el["geometry"]])
        else:
            out += [[(p["lon"], p["lat"]) for p in m["geometry"]] for m in el.get("members", []) if m.get("geometry")]
    return out


def draw_overview():
    to_bng = Transformer.from_crs(4326, 27700, always_xy=True)
    w, s_, e, n = AREA
    (e0, n0), (e1, n1) = to_bng.transform(w, s_), to_bng.transform(e, n)
    k = WIDTH / (e1 - e0)
    H = (n1 - n0) * k
    xy = lambda lon, lat: (lambda E, N: ((E - e0) * k, (n1 - N) * k))(*to_bng.transform(lon, lat))
    def path(pts, closed=False):
        line = LineString([xy(*p) for p in pts]).simplify(1.2)
        return "M" + "L".join(f"{x:.0f},{y:.0f}" for x, y in line.coords) + ("Z" if closed else "")
    land = "".join(path(l) for l in osm_lines() if len(l) > 1)
    res = "".join(path(r, True) for code in TEAM for r in reserve_rings_wgs(code))
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {H:.0f}" preserveAspectRatio="xMidYMid slice">'
        f"<!-- South Cumbria: coast and lakes © OpenStreetMap contributors (ODbL); reserves © Natural England -->"
        f'<g fill="none" stroke="#fff" stroke-linejoin="round" stroke-linecap="round">'
        f'<path stroke-width="5" stroke-opacity=".8" d="{land}"/>'
        f'<path stroke-width="5" fill="#fff" fill-opacity=".45" d="{res}"/>'
        "</g></svg>"
    )
    out = OUT / "all.svg"
    out.write_text(svg, "utf-8", newline="\n")
    print(f"Overview: {out.stat().st_size // 1024} KB")


def reserve_rings_wgs(code):
    gj = json.loads((ROOT / "data" / "nnr.geojson").read_text("utf-8"))
    f = next(f for f in gj["features"] if f["properties"].get("REF_CODE") == code)
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    return [ring for poly in polys for ring in poly]


if __name__ == "__main__":
    for code in TEAM:
        draw(code)
    draw_overview()
