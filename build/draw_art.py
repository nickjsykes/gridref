"""Draws art/contours.svg: the faint contour-line texture behind the empty saved tabs.

  python build/draw_art.py

A made-up bit of fell (a few hills and a valley, from a fixed seed) traced into contours
with matplotlib, so the lines never cross: it should pass a GIS person's glance. Every
fifth contour is heavier, like an OS map's index contours. Black lines; the app tints them
with the theme's ink colour through a CSS mask, so it works in light and dark mode.
"""
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

W, H = 400, 520
OUT = Path(__file__).resolve().parent.parent / "art" / "contours.svg"

rng = np.random.default_rng(11)
y, x = np.mgrid[0:H:2, 0:W:2].astype(float)
z = np.zeros_like(x)
for _ in range(6):  # rounded fell tops
    cx, cy = rng.uniform(-40, W + 40), rng.uniform(-40, H + 40)
    s, h = rng.uniform(70, 150), rng.uniform(0.6, 1.4)
    z += h * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * s * s))
z += 0.25 * np.sin(x / 61 + 1.3) * np.cos(y / 83 - 0.4)  # long ridges and a valley
z += 0.08 * np.sin(x / 23 + y / 31)                       # a little roughness

levels = np.linspace(z.min(), z.max(), 34)[1:-1]
cs = plt.contour(x, y, z, levels=levels)
paths = {False: [], True: []}
for i, segs in enumerate(cs.allsegs):
    for seg in segs:
        if len(seg) < 4:
            continue
        seg = seg[:: max(1, len(seg) // 70)]  # plenty of points for a smooth line, small file
        d = "M" + "L".join(f"{px:.1f} {py:.1f}" for px, py in seg)
        paths[i % 5 == 0].append(d)
plt.close("all")

svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" fill="none" stroke="#000" stroke-linejoin="round">\n'
       f'  <path stroke-width="0.8" d="{"".join(paths[False])}"/>\n'
       f'  <path stroke-width="1.6" d="{"".join(paths[True])}"/>\n'
       "</svg>\n")
OUT.parent.mkdir(exist_ok=True)
OUT.write_text(svg, "utf-8", newline="\n")
print(f"wrote {OUT.name}: {len(svg) // 1024} KB")
