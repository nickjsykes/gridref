"""The Field Notes home-screen icon: a plain white location pin with a crosshair in its head,
on flat spruce. Flat colour and one bold glyph, like the apps around it (Messages, WhatsApp,
Microsoft, GOV.UK): no outlines, shading or small detail, so it reads at 60 px.

  python build/draw_icon.py            ->  icon-512.png, icon-192.png, icon-180.png (Apple)
  python build/draw_icon.py preview    ->  the three candidate styles side by side

Drawn at 4x and scaled down for smooth edges. Full-bleed square: iOS and Android round the
corners themselves. Design units are a 120 x 120 grid.
"""
import math, sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SPRUCE, WHITE = (46, 101, 96), (255, 255, 255)


def pin(d, u, k, fg, cut, cx=60, cy=50, r=24, tip=100):
    """A pin whose point sits on the spot, with a crosshair (in the cut colour) in its head."""
    a = math.acos(r / (tip - cy))  # where the tangent lines leave the circle
    pts = [(cx + r * math.cos(t), cy + r * math.sin(t)) for t in [math.pi / 2 + a + i * (2 * math.pi - 2 * a) / 90 for i in range(91)]]
    d.polygon([tuple(u(x, y)) for x, y in pts] + [tuple(u(cx, tip))], fill=fg)
    w, ring, arm = 3.2, 9, 15
    d.ellipse(u(cx - ring, cy - ring, cx + ring, cy + ring), outline=cut, width=round(w * k))
    for x0, y0, x1, y1 in ((cx - arm, cy, cx - ring + 3, cy), (cx + ring - 3, cy, cx + arm, cy), (cx, cy - arm, cx, cy - ring + 3), (cx, cy + ring - 3, cx, cy + arm)):
        d.line(u(x0, y0, x1, y1), fill=cut, width=round(w * k))


def draw(size, style="a"):
    k = size * 4 / 120
    u = lambda *v: [round(a * k) for a in v]
    bg = WHITE if style == "b" else SPRUCE
    im = Image.new("RGB", (size * 4, size * 4), bg)
    d = ImageDraw.Draw(im)
    if style == "a":
        pin(d, u, k, WHITE, SPRUCE)
    elif style == "b":
        pin(d, u, k, SPRUCE, WHITE)
    else:  # c: a white map square with a crosshair on the spot
        d.rounded_rectangle(u(26, 26, 94, 94), radius=round(10 * k), outline=WHITE, width=round(6 * k))
        for x0, y0, x1, y1 in ((60, 36, 60, 52), (60, 68, 60, 84), (36, 60, 52, 60), (68, 60, 84, 60)):
            d.line(u(x0, y0, x1, y1), fill=WHITE, width=round(6 * k))
        d.ellipse(u(56, 56, 64, 64), fill=WHITE)
    return im.resize((size, size), Image.Resampling.LANCZOS)


if __name__ == "__main__" and sys.argv[1:2] == ["preview"]:
    sheet = Image.new("RGB", (3 * 220 + 40, 260), (238, 238, 238))
    for i, s in enumerate("abc"):
        ic = draw(180, s)
        mask = Image.new("L", (180, 180), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 179, 179), radius=40, fill=255)  # as iOS shows it
        sheet.paste(ic, (40 + i * 220, 40), mask)
        ImageDraw.Draw(sheet).text((40 + i * 220 + 84, 230), s.upper(), fill=(60, 60, 60))
    sheet.save(sys.argv[2] if len(sys.argv) > 2 else ROOT / "review" / "icon options.png")
elif __name__ == "__main__":
    for size, name in ((512, "icon-512.png"), (192, "icon-192.png"), (180, "icon-180.png")):
        draw(size).save(ROOT / name, optimize=True)
        print("wrote", name)
