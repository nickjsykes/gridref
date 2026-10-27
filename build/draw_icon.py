"""The Field Notes home-screen icon: a field notebook with a location pin, on spruce.

  python build/draw_icon.py   ->  icon-512.png, icon-192.png, icon-180.png (Apple)

Drawn at 4x and scaled down for smooth edges. Full-bleed square: iOS and Android round the
corners themselves. Design units are a 120 x 120 grid (as the mock-up the team chose).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPRUCE, SAND, SPINE, ORANGE = (46, 101, 96), (236, 228, 208), (201, 191, 164), (217, 72, 15)
LINE = tuple(round(s * 0.7 + p * 0.3) for s, p in zip(SAND, SPRUCE))  # spruce lines at 30% on sand


def draw(size):
    k = size * 4 / 120
    im = Image.new("RGB", (size * 4, size * 4), SPRUCE)
    d = ImageDraw.Draw(im)
    u = lambda *v: [round(a * k) for a in v]
    # the notebook, with a darker spine down its left edge
    d.rounded_rectangle(u(30, 22, 90, 100), radius=round(7 * k), fill=SAND)
    d.rounded_rectangle(u(30, 22, 44, 100), radius=round(7 * k), fill=SPINE)
    d.rectangle(u(38, 22, 40, 100), fill=SPINE)
    d.rectangle(u(40, 22, 44, 100), fill=SAND)
    # ruled lines
    for y, x2 in ((40, 80), (52, 80), (64, 72)):
        d.rounded_rectangle(u(48, y - 1.2, x2, y + 1.2), radius=round(1.2 * k), fill=LINE)
    # the pin: a circle that tapers to a point, then a sand dot
    cx, cy, r, tip = 66, 69, 14, 92
    a = math.acos(r / (tip - cy))  # where the tangent lines leave the circle
    pts = [(cx + r * math.cos(t), cy + r * math.sin(t)) for t in [math.pi / 2 + a + i * (2 * math.pi - 2 * a) / 60 for i in range(61)]]
    d.polygon([tuple(u(x, y)) for x, y in pts] + [tuple(u(cx, tip))], fill=ORANGE)
    d.ellipse(u(cx - 5, cy - 5, cx + 5, cy + 5), fill=SAND)
    return im.resize((size, size), Image.Resampling.LANCZOS)


for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png")):
    draw(size).save(ROOT / name, optimize=True)
    print("wrote", name)
