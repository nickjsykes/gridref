"""data/tides.json: the next week of official high and low waters for the tidal reserves.

From the UK Hydrographic Office's ADMIRALTY UK Tidal API (Discovery, free): times and heights
in metres above chart datum, the same figures as the tide tables. Run every morning by the
GitHub workflow .github/workflows/tides.yml, with the key kept as the repository secret
ADMIRALTY_KEY (it never goes in the app or the repo). The app reads data/tides.json, so tides
work offline for a week.

Locally: ADMIRALTY_KEY=... python build/fetch_tides.py
"""
import json, math, os, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://admiraltyapi.azure-api.net/uktidalapi/api/V1"
# Each tidal reserve and the water it opens onto; the nearest tide station to that is used
RESERVES = {"1006114": ("Walney", 54.13, -3.29), "1006954": ("Duddon", 54.18, -3.27), "1006126": ("Roudsea", 54.15, -3.06)}


def get(path, key):
    req = urllib.request.Request(f"{API}/{path}", headers={"Ocp-Apim-Subscription-Key": key, "User-Agent": "GridRef tides"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main():
    key = os.environ.get("ADMIRALTY_KEY", "").strip()
    if not key:
        sys.exit("ADMIRALTY_KEY isn't set")
    stations = get("Stations", key)["features"]
    out = {"fetched": datetime.now(timezone.utc).isoformat(timespec="minutes"), "source": "ADMIRALTY UK Tidal API, © Crown copyright, UK Hydrographic Office", "reserves": {}}
    for code, (name, lat, lon) in RESERVES.items():
        def dist(f):
            slon, slat = f["geometry"]["coordinates"][:2]
            return math.hypot((slon - lon) * math.cos(math.radians(lat)), slat - lat)
        st = min(stations, key=dist)
        events = get(f"Stations/{st['properties']['Id']}/TidalEvents?duration=7", key)
        out["reserves"][code] = {
            "station": st["properties"]["Name"],
            "events": [{"high": e["EventType"] == "HighWater", "at": e["DateTime"][:16] + "Z", "m": round(e["Height"], 1)}
                       for e in events if e.get("Height") is not None],
        }
        print(f"{name}: {st['properties']['Name']} ({dist(st) * 111:.0f} km), {len(out['reserves'][code]['events'])} tides")
    (ROOT / "data" / "tides.json").write_text(json.dumps(out, separators=(",", ":")), "utf-8", newline="\n")


if __name__ == "__main__":
    main()
