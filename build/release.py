"""Bump the app version everywhere it has to match, in one go.

  python build/release.py        -> next version (e.g. 36 -> 37)

Updates: VERSION in index.html, the ?v= on index.html's own scripts (so a phone never runs
a new page with old scripts from its memory cache), version.json (what open copies check
to reload themselves) and CACHE in sw.js (so the service worker installs fresh files).
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
index = ROOT / "index.html"
html = index.read_text("utf-8")
m = re.search(r'const VERSION = "(\d+)";', html)
assert m, "VERSION not found in index.html"
old = int(m[1])
new = old + 1
html = re.sub(r'const VERSION = "\d+";', f'const VERSION = "{new}";', html)
html = re.sub(r'((?:src|href)="(?:vendor/leaflet/leaflet\.(?:js|css)|config\.js|osgb\.js|parse\.js|local\.js))(?:\?v=\d+)?"', rf'\1?v={new}"', html)
index.write_text(html, "utf-8", newline="\n")
(ROOT / "version.json").write_text(f'{{"v":"{new}"}}\n', "utf-8", newline="\n")
sw = ROOT / "sw.js"
sw.write_text(re.sub(r'const CACHE = "gridref-v\d+";', f'const CACHE = "gridref-v{new}";', sw.read_text("utf-8")), "utf-8", newline="\n")
print(f"version {old} -> {new}")
