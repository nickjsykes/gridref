"""Draws the line-art used in the app (empty saved tabs, the arrival reward) into art/.

  python build/draw_art.py

Same style as osprey.svg: one stroke colour (currentColor, so it follows light/dark mode),
round ends, a lighter half-opacity line for texture. Stones are drawn from a fixed seed so
the wall and cairn come out the same every time.
"""
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "art"
OUT.mkdir(exist_ok=True)
HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="{label}">\n  <title>{label}</title>\n'
FAINT = 'stroke-width="1.2" opacity=".5"'


def stone(x0, y0, x1, y1, rnd, r=3.0):
    """A rough stone filling the box: a rounded quadrilateral with wobbly corners."""
    j = lambda: rnd.uniform(-1.2, 1.2)
    a, b, c, d = (x0 + j(), y0 + j()), (x1 + j(), y0 + j()), (x1 + j(), y1 + j()), (x0 + j(), y1 + j())
    return (f'M{a[0]+r:.1f} {a[1]:.1f}L{b[0]-r:.1f} {b[1]:.1f}Q{b[0]:.1f} {b[1]:.1f} {b[0]:.1f} {b[1]+r:.1f}'
            f'L{c[0]:.1f} {c[1]-r:.1f}Q{c[0]:.1f} {c[1]:.1f} {c[0]-r:.1f} {c[1]:.1f}'
            f'L{d[0]+r:.1f} {d[1]:.1f}Q{d[0]:.1f} {d[1]:.1f} {d[0]:.1f} {d[1]-r:.1f}'
            f'L{a[0]:.1f} {a[1]+r:.1f}Q{a[0]:.1f} {a[1]:.1f} {a[0]+r:.1f} {a[1]:.1f}Z')


def grass(xs, y=104):
    return "".join(f"M{x} {y}q1-6-3-10M{x+3} {y}q2-8 6-11M{x+6} {y}q0-5 3-7" for x in xs)


def wall():
    """A dry stone wall: batter, courses that cross joints, a through stone, cope stones."""
    rnd = random.Random(7)
    s = []
    courses = [(92, 104), (80, 92), (69, 80), (59, 69)]
    for i, (top, bot) in enumerate(courses):
        inset = 6 + i * 3  # the batter: each course a little narrower
        x = 18 + inset + (0 if i % 2 == 0 else -rnd.uniform(4, 8))  # stagger so joints cross
        end = 182 - inset
        while x < end - 6:
            w = rnd.uniform(14, 24)
            if end - (x + w) < 10: w = end - x
            s.append(stone(x + 0.8, top + 0.8, x + w - 0.8, bot - 0.8, rnd))
            x += w
    s.append(stone(15, 71, 33, 79, rnd))  # a through stone poking out of the face
    cope = []
    x = 33
    while x < 167:
        w = rnd.uniform(6.5, 8.5)
        h = rnd.uniform(9, 12)
        cope.append(stone(x + 0.6, 59 - h, x + w - 0.6, 59, rnd, r=2.2))
        x += w
    svg = HEAD.format(label="Dry stone wall")
    svg += '  <path d="M8 104H192"/>\n'
    svg += f'  <path d="{"".join(s)}"/>\n'
    svg += f'  <path d="{"".join(cope)}"/>\n'
    svg += f'  <path d="{grass([10, 26, 168, 184])}" {FAINT}/>\n'
    svg += f'  <path d="M10 44Q40 26 70 36T130 30T190 40" {FAINT}/>\n'  # the fell behind
    return svg + "</svg>\n"


def cairn():
    """A summit cairn: big stones at the base, smaller up to a pointed top."""
    rnd = random.Random(3)
    rows = [(92, 104, 58, 142), (81, 92, 64, 136), (71, 81, 71, 129), (62, 71, 78, 122), (54, 62, 84, 116), (47, 54, 90, 110)]
    s = []
    for top, bot, x0, x1 in rows:
        x = x0 + rnd.uniform(-2, 2)
        while x < x1 - 4:
            w = rnd.uniform(9, 17)
            if x1 - (x + w) < 7: w = x1 - x
            s.append(stone(x + 0.7, top + 0.7, x + w - 0.7, bot - 0.7, rnd, r=2.6))
            x += w
    s.append(stone(95, 39, 106, 47, rnd, r=2.4))
    svg = HEAD.format(label="Cairn")
    svg += '  <path d="M8 104H192"/>\n'
    svg += f'  <path d="{"".join(s)}"/>\n'
    svg += f'  <path d="M8 78Q30 64 52 70M148 66Q170 58 192 66" {FAINT}/>\n'
    svg += f'  <path d="{grass([30, 46, 150, 166])}" {FAINT}/>\n'
    return svg + "</svg>\n"


WAYMARK = HEAD.format(label="Waymark post") + f'''  <path d="M8 104Q100 100 192 104"/>
  <path d="M10 78Q45 58 72 70T132 62T190 74" {FAINT}/>
  <path d="M91 103V42L100 35L109 42V103"/>
  <path d="M95 74V90M104 80V96M97 48V60" {FAINT}/>
  <circle cx="100" cy="58" r="10"/>
  <path d="M94 58H105M101 54L105 58L101 62"/>
  <path d="{grass([66, 78, 114, 126])}"/>
  <g transform="translate(-23 -10)"><!-- a wheatear has stopped on top of the post -->
    <path d="M115 37q2-6 8-6q4 0 6 3l4 1l-4 1q-1 5-7 6h-4q-4 0-6 2l-3-1q3-2 6-6Z" stroke-width="1.8"/>
    <path d="M126 33.5h.1" stroke-width="2.6"/>
    <path d="M120 42l-1 3M124 42l1 3" stroke-width="1.4"/>
  </g>
</svg>
'''

def puff(cx, cy):
    """A soft cotton-wool head: a small lumpy cloud about 12 wide."""
    return (f"M{cx-5} {cy+1}a3 3 0 0 1 1.5-4.5a3.5 3.5 0 0 1 5.5-1a3 3 0 0 1 4 3.5"
            f"a2.8 2.8 0 0 1-1.5 5a3.3 3.3 0 0 1-5 1.2a3 3 0 0 1-4.5-4.2Z")


def tuft(x, y):
    """Common cottongrass: two or three heads drooping from the top of the stem."""
    return (f"M{x} {y}q-3 0-6 4{puff(x-8, y+9)}"
            f"M{x} {y}q3 0 6 4{puff(x+8, y+9)}"
            f"M{x} {y}v-1{puff(x, y-6)}")


BOGCOTTON = HEAD.format(label="Bog cotton on a moss") + f'''  <path d="M8 104Q28 92 48 102Q70 90 96 101Q120 91 142 102Q166 92 192 104"/>
  <path d="M22 100q4-3 9 0M60 98q5-3 10 0M110 98q5-3 10 0M152 99q4-3 9 0" {FAINT}/>
  <path d="M40 98Q38 74 44 52M70 96Q72 70 66 44M98 98Q96 76 102 56M126 96Q130 72 124 48M156 99Q154 80 160 62"/>
  <path d="{"".join(tuft(x, y) for x, y in [(44, 52), (66, 44), (102, 56), (124, 48), (160, 62)])}"/>
  <path d="M52 100Q50 86 54 76M58 100Q60 88 64 82M84 99Q86 84 82 74M114 97Q112 84 116 76M140 98Q142 86 138 78M170 100Q168 88 174 80" {FAINT}/>
</svg>
'''

TRAILCAM = HEAD.format(label="Trail camera on a tree") + f'''  <path d="M8 104Q100 100 192 104"/>
  <path d="M82 104Q86 96 86 84V12M118 104Q114 96 114 84V12"/>
  <path d="M76 104Q82 100 86 98M124 104Q118 100 114 98" {FAINT}/>
  <path d="M90 20V34M108 28V40M92 86V98M110 84V96M96 44V48" {FAINT}/>
  <path d="M86 56Q100 60 114 56M86 63Q100 67 114 63"/>
  <rect x="88" y="48" width="24" height="32" rx="4"/>
  <circle cx="100" cy="59" r="5.5"/>
  <circle cx="100" cy="59" r="2" fill="currentColor" stroke="none"/>
  <rect x="94" y="69" width="12" height="5" rx="1.5"/>
  <circle cx="106" cy="52" r="1" fill="currentColor" stroke="none"/>
  <path d="M114 30Q130 26 146 18M132 25q8-8 16-4q-6 8-16 4ZM140 21q4-10 12-10q-2 9-12 10Z"/>
  <path d="{grass([40, 56, 140, 156])}" {FAINT}/>
</svg>
'''

NATTERJACK = HEAD.format(label="Natterjack toad") + f'''  <path d="M8 106Q100 102 192 106" {FAINT}/>
  <path d="M100 26C114 26 124 34 125 46C134 54 136 70 130 84C124 96 112 100 100 100C88 100 76 96 70 84C64 70 66 54 75 46C76 34 86 26 100 26Z"/>
  <path d="M84 36c0-6 8-8 10-2M116 36c0-6-8-8-10-2"/>
  <circle cx="88" cy="36" r="1.6" fill="currentColor" stroke="none"/><circle cx="112" cy="36" r="1.6" fill="currentColor" stroke="none"/>
  <path d="M77 48c3-4 7-4 9 0M123 48c-3-4-7-4-9 0" stroke-width="1.6"/>
  <path d="M98 30V96M102 30V96" stroke-width="1.5"/>
  <path d="M74 60C62 60 52 66 50 74M50 74l-6 2M50 74l-4 5M50 74l0 6M126 60C138 60 148 66 150 74M150 74l6 2M150 74l4 5M150 74l0 6"/>
  <path d="M74 88C60 88 50 96 54 104C58 108 66 104 72 98M54 104l-8 2M54 104l-5 6M54 104l1 7M126 88C140 88 150 96 146 104C142 108 134 104 128 98M146 104l8 2M146 104l5 6M146 104l-1 7"/>
  <path d="M84 54h.1M90 66h.1M80 74h.1M88 84h.1M116 54h.1M110 66h.1M120 74h.1M112 84h.1M94 46h.1M106 46h.1M84 92h.1M116 92h.1" stroke-width="3.2"/>
</svg>
'''

for name, svg in [("waymark", WAYMARK), ("wall", wall()), ("bogcotton", BOGCOTTON), ("trailcam", TRAILCAM),
                  ("cairn", cairn()), ("natterjack", NATTERJACK)]:
    (OUT / f"{name}.svg").write_text(svg, "utf-8", newline="\n")
    print("wrote art/" + name + ".svg")
