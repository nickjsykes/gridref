"""data/ostn15.json: makes the app's OS grid conversion match OS's own (OSTN15).

The app converts GPS lat/long to OS eastings/northings with a Helmert transform, which is
good to about a metre (here it reads ~1 m too far north). This table holds what OSTN15 says
minus what the Helmert says, every 5 km across Great Britain, in centimetres; the app adds
it on (interpolated), which brings it to within a few centimetres of OSTN15.

Needs the OSTN15 grid (open licence) in build/src/proj:
  curl -L -o build/src/proj/uk_os_OSTN15_NTv2_OSGBtoETRS.tif https://cdn.proj.org/uk_os_OSTN15_NTv2_OSGBtoETRS.tif
Run with the Terra venv (pyproj); node must be on the PATH (it runs the app's own osgb.js):
  C:/Dev/Terra/.venv/Scripts/python.exe build/build_ostn15.py
"""
import json, math, subprocess
from pathlib import Path

import pyproj
from pyproj.transformer import TransformerGroup

ROOT = Path(__file__).resolve().parent.parent
pyproj.datadir.append_data_dir(str(ROOT / "build" / "src" / "proj"))
STEP, E1, N1 = 5000, 700000, 1250000

to_grid = TransformerGroup("EPSG:4326", "EPSG:27700", always_xy=True).transformers[0]
to_ll = TransformerGroup("EPSG:27700", "EPSG:4326", always_xy=True).transformers[0]
assert "(9)" in to_grid.description, f"OSTN15 grid not found: {to_grid.description}"

nodes = [(e, n) for n in range(0, N1 + 1, STEP) for e in range(0, E1 + 1, STEP)]
lls = [to_ll.transform(e, n) for e, n in nodes]
ok = [math.isfinite(lo) and math.isfinite(la) for lo, la in lls]
# The app's Helmert, run through osgb.js itself so the table matches it exactly
js = ("const fs=require('fs');eval(fs.readFileSync('osgb.js','utf8'));"
      "const P=JSON.parse(fs.readFileSync(0,'utf8'));"
      "console.log(JSON.stringify(P.map(([lo,la])=>{const g=OSGB.wgs84ToGrid(la,lo,true);return [g.e,g.n]})))")
helm = json.loads(subprocess.run(["node", "-e", js], input=json.dumps([[lo, la] if k else [0, 50] for (lo, la), k in zip(lls, ok)]),
                                 capture_output=True, text=True, cwd=ROOT, check=True).stdout)
de, dn = [], []
for (e, n), (he, hn), k in zip(nodes, helm, ok):
    # true grid position (e, n) vs the Helmert's: the correction to add, in cm. 0 where OSTN15 has nothing
    good = k and abs(he - e) < 50 and abs(hn - n) < 50
    de.append(round((e - he) * 100) if good else 0)
    dn.append(round((n - hn) * 100) if good else 0)
# Out at sea OSTN15 has nothing. Fill those cells from their nearest neighbours that do, so
# the blend between table points stays true right up to the coast
cols, rows = E1 // STEP + 1, N1 // STEP + 1
have = [k and abs(he - e) < 50 and abs(hn - n) < 50 for (e, n), (he, hn), k in zip(nodes, helm, ok)]
while not all(have):
    nxt = have[:]
    for idx in range(len(nodes)):
        if have[idx]:
            continue
        i, j = idx % cols, idx // cols
        near = [j2 * cols + i2 for i2, j2 in ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1)) if 0 <= i2 < cols and 0 <= j2 < rows and have[j2 * cols + i2]]
        if near:
            de[idx] = round(sum(de[k] for k in near) / len(near))
            dn[idx] = round(sum(dn[k] for k in near) / len(near))
            nxt[idx] = True
    if nxt == have:
        break
    have = nxt
out = {"step": STEP, "cols": E1 // STEP + 1, "rows": N1 // STEP + 1, "de": de, "dn": dn,
       "source": "OSTN15 (Ordnance Survey, open licence) via PROJ uk_os_OSTN15_NTv2_OSGBtoETRS"}
(ROOT / "data" / "ostn15.json").write_text(json.dumps(out, separators=(",", ":")), "utf-8", newline="\n")
nz = [abs(x) for x in dn if x]
print(f"{len(nodes)} nodes, {sum(ok)} with OSTN15; northing correction {min(dn)}..{max(dn)} cm; "
      f"{(ROOT / 'data' / 'ostn15.json').stat().st_size // 1024} KB")
