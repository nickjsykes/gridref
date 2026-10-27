"""Cut the offline OS map pack for the reserves.

Source: OS OpenMap Local, Full Colour Raster (OGL v3), 5 km GeoTIFFs at 1 m on the British
National Grid, downloaded per 100 km square into build/src as omlras_gtfc_<sq>.zip.
Reserves: Natural England NNR boundaries in data/nnr.geojson (build/README).

Ground relief from the EA 1 m LiDAR (build/build_relief.py, run that first) is blended into
zooms 14-17 around each reserve, so walls, banks, ditches and drains show on the map.

Output: maps/{z}/{x}/{y}.webp web-map tiles around each reserve, and maps/index.json, the
list the app downloads. Needs rasterio and Pillow (the Terra venv has both):
  C:/Dev/Terra/.venv/Scripts/python.exe build/build_tiles.py
"""
import hashlib, json, math, re, zipfile
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "src"
OUT = ROOT / "maps"
# The reserves the team works (REF_CODE from the NNR dataset). Chosen by Nick, 27 Oct 2026.
PACK = {
    "1006126": "Roudsea Wood and Mosses", "1006018": "Blelham Bog", "1006954": "Duddon Mosses",
    "1006067": "Hallsenna Moor", "1006114": "North Walney", "1006058": "Gait Barrows",
    "1006111": "North Fen",
}
ZOOMS = range(11, 18)
RELIEF_FROM = 14  # zooms below this are too coarse for walls and drains
RELIEF = {}  # REF_CODE -> (factor array, transform, bounds) on the British National Grid
for f in sorted((SRC / "relief").glob("*.tif")):
    with rasterio.open(f) as d:
        RELIEF[f.stem] = (d.read(1), d.transform, d.bounds)
BUFFER_M = {11: 6000, 12: 4000, 13: 2500, 14: 1500, 15: 1000, 16: 700, 17: 500}  # map around each reserve
QUALITY = 80
TILE = 256

# ---------- OS 5 km tile names, e.g. SD38NW -> its south-west corner ----------
def square_origin(letters):
    l1, l2 = (ord(c) - 65 for c in letters)
    l1 -= l1 > 7
    l2 -= l2 > 7
    e100 = ((l1 - 2) % 5) * 5 + (l2 % 5)
    n100 = 19 - (l1 // 5) * 5 - (l2 // 5)
    return e100 * 100000, n100 * 100000

def tile_origin(name):
    m = re.match(r"([A-Z]{2})(\d)(\d)(NW|NE|SW|SE)$", name)
    assert m, name
    e0, n0 = square_origin(m[1])
    e = e0 + int(m[2]) * 10000 + (5000 if m[4][1] == "E" else 0)
    n = n0 + int(m[3]) * 10000 + (5000 if m[4][0] == "N" else 0)
    return e, n

SOURCES = {}  # name -> (zip path, member)
for z in sorted(SRC.glob("omlras_gtfc_*.zip")):
    for member in zipfile.ZipFile(z).namelist():
        m = re.search(r"/data/([A-Z]{2}\d\d(?:NW|NE|SW|SE))\.tif$", member)
        if m:
            SOURCES[m[1]] = (z, member)
BY_ORIGIN = {tile_origin(n): n for n in SOURCES}

@lru_cache(maxsize=12)
def source_rgb(name, step):
    """One 5 km tile as RGB, decimated by `step` (1 = full 1 m)."""
    zpath, member = SOURCES[name]
    path = SRC / "oml" / Path(member).name
    if not path.exists():
        path.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(zpath) as z, open(path, "wb") as f:
            f.write(z.read(member))
    with rasterio.open(path) as d:
        idx = d.read(1, out_shape=(d.height // step, d.width // step), resampling=Resampling.nearest)
        cmap = d.colormap(1)
    lut = np.zeros((256, 3), np.uint8)
    for k, v in cmap.items():
        lut[k] = v[:3]
    return lut[idx].transpose(2, 0, 1)  # (3, H, W)

# ---------- web-map tile maths ----------
R = 6378137.0
def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y

def tile_bounds_3857(z, x, y):
    size = 2 * math.pi * R / 2 ** z
    left = -math.pi * R + x * size
    top = math.pi * R - y * size
    return left, top - size, left + size, top

def render(z, x, y):
    b = tile_bounds_3857(z, x, y)
    w, s, e, n = transform_bounds("EPSG:3857", "EPSG:27700", *b, densify_pts=21)
    metres_per_px = (b[2] - b[0]) / TILE * math.cos(math.radians(54.3))
    step = max(1, int(metres_per_px / 2))  # read at about twice the output detail, then average
    dst = np.zeros((3, TILE, TILE), np.uint8)
    alpha = np.zeros((1, TILE, TILE), np.uint8)
    dst_t = from_bounds(*b, TILE, TILE)
    found = False
    for e0 in range(int(w // 5000) * 5000, int(e) + 1, 5000):
        for n0 in range(int(s // 5000) * 5000, int(n) + 1, 5000):
            name = BY_ORIGIN.get((e0, n0))
            if not name:
                continue
            found = True
            rgb = source_rgb(name, step)
            src_t = from_bounds(e0, n0, e0 + 5000, n0 + 5000, rgb.shape[2], rgb.shape[1])
            kw = dict(src_transform=src_t, src_crs="EPSG:27700", dst_transform=dst_t, dst_crs="EPSG:3857")
            # 0 marks "no data" in the alpha band, so each 5 km tile only writes where it has map
            reproject(rgb, dst, resampling=Resampling.bilinear if step == 1 else Resampling.average, init_dest_nodata=False, **kw)
            reproject(np.full((1,) + rgb.shape[1:], 255, np.uint8), alpha, resampling=Resampling.nearest, init_dest_nodata=False, **kw)
    if not found or not alpha.any():
        return None
    if z >= RELIEF_FROM:
        fac = np.ones((1, TILE, TILE), np.float32)
        for arr, tr, bd in RELIEF.values():
            if bd.right < w or bd.left > e or bd.top < s or bd.bottom > n:
                continue
            reproject(arr[None], fac, src_transform=tr, src_crs="EPSG:27700", dst_transform=dst_t, dst_crs="EPSG:3857",
                      resampling=Resampling.bilinear if metres_per_px < 1.5 else Resampling.average, init_dest_nodata=False)
        dst = np.clip(dst.astype(np.float32) * fac, 0, 255).astype(np.uint8)
    img = np.concatenate([dst, alpha]).transpose(1, 2, 0)
    return Image.fromarray(img, "RGBA") if alpha.min() < 255 else Image.fromarray(img[..., :3], "RGB")

def main():
    gj = json.loads((ROOT / "data" / "nnr.geojson").read_text("utf-8"))
    reserves = [f for f in gj["features"] if f["properties"]["REF_CODE"] in PACK]
    missing = set(PACK) - {f["properties"]["REF_CODE"] for f in reserves}
    assert not missing, f"not in nnr.geojson: {missing}"
    wanted = set()
    for f in reserves:
        coords = []
        geom = f["geometry"]
        for poly in (geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]):
            coords += poly[0]
        lons, lats = [c[0] for c in coords], [c[1] for c in coords]
        for z in ZOOMS:
            dlat = BUFFER_M[z] / 111320
            dlon = BUFFER_M[z] / (111320 * math.cos(math.radians(54.3)))
            x0, y0 = lonlat_to_tile(min(lons) - dlon, max(lats) + dlat, z)
            x1, y1 = lonlat_to_tile(max(lons) + dlon, min(lats) - dlat, z)
            for x in range(int(x0), int(x1) + 1):
                for y in range(int(y0), int(y1) + 1):
                    wanted.add((z, x, y))
    print(f"{len(reserves)} reserves, {len(wanted)} tiles to cut")
    tiles, total = [], 0
    # Sort so neighbouring tiles share cached sources
    for i, (z, x, y) in enumerate(sorted(wanted, key=lambda t: (-t[0], t[1] // 8, t[2] // 8, t))):
        path = OUT / str(z) / str(x) / f"{y}.webp"
        if not path.exists():
            img = render(z, x, y)
            if img is None:
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            img.save(path, "WEBP", quality=QUALITY, method=6)
        tiles.append(f"{z}/{x}/{y}.webp")
        total += path.stat().st_size
        if i % 500 == 0:
            print(f"  {i}/{len(wanted)}  {total / 1e6:.1f} MB")
    tiles.sort()
    # Remove tiles left over from reserves no longer in the pack
    keep = {OUT / t for t in tiles}
    for f in OUT.rglob("*.webp"):
        if f not in keep:
            f.unlink()
    for d in sorted(OUT.rglob("*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
    version = hashlib.sha1(("\n".join(tiles) + str(total)).encode()).hexdigest()[:10]
    index = {"version": version, "reserves": sorted(PACK.values()), "zooms": [min(ZOOMS), max(ZOOMS)], "bytes": total, "tiles": tiles,
             "source": "OS OpenMap Local raster, Contains OS data © Crown copyright 2026 (OGL v3); relief from EA LiDAR © Environment Agency (OGL v3)"}
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), "utf-8", newline="\n")
    print(f"done: {len(tiles)} tiles, {total / 1e6:.1f} MB, version {version}")

if __name__ == "__main__":
    main()
