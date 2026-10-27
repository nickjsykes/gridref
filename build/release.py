"""Bump the app version everywhere it has to match, in one go.

  python build/release.py        -> next version (e.g. 36 -> 37)

Updates: VERSION in app.js, the ?v= on the scripts and styles index.html loads (so a phone never runs
a new page with old scripts from its memory cache), version.json (what open copies check
to reload themselves) and CACHE in sw.js (so the service worker installs fresh files).
"""
import re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
index = ROOT / "index.html"
html = index.read_text("utf-8")

# Refuse to release code that doesn't even parse (one stray line break once broke the app)
CHECK = r"""
const fs = require('fs'), path = require('path'), root = process.argv[1];
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m, i) => ['index.html script ' + i, m[1]]);
for (const f of ['app.js', 'osgb.js', 'parse.js', 'local.js', 'config.js', 'zip.js', 'exif.js', 'sw.js']) blocks.push([f, fs.readFileSync(path.join(root, f), 'utf8')]);
let bad = 0;
for (const [name, code] of blocks) { try { new Function(code); } catch (e) { console.error(name + ': ' + e.message); bad++; } }
process.exit(bad ? 1 : 0);
"""
if subprocess.run(["node", "-e", CHECK, str(ROOT)]).returncode:
    sys.exit("Syntax error: not releasing")
app = ROOT / "app.js"
code = app.read_text("utf-8")
m = re.search(r'const VERSION = "(\d+)";', code)
assert m, "VERSION not found in app.js"
old = int(m[1])
new = old + 1
app.write_text(re.sub(r'const VERSION = "\d+";', f'const VERSION = "{new}";', code), "utf-8", newline="\n")
html = re.sub(r'((?:src|href)="(?:vendor/leaflet/leaflet\.(?:js|css)|config\.js|osgb\.js|parse\.js|local\.js|zip\.js|exif\.js|app\.js|app\.css))(?:\?v=\d+)?"', rf'\1?v={new}"', html)
index.write_text(html, "utf-8", newline="\n")
(ROOT / "version.json").write_text(f'{{"v":"{new}"}}\n', "utf-8", newline="\n")
sw = ROOT / "sw.js"
sw.write_text(re.sub(r'const CACHE = "gridref-v\d+";', f'const CACHE = "gridref-v{new}";', sw.read_text("utf-8")), "utf-8", newline="\n")
print(f"version {old} -> {new}")
