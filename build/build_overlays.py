"""Offline overlays for the team's reserves: things that help you find your way on the ground.

  python build/build_overlays.py

  data/units.geojson  SSSI condition units (name, unit number, condition) from Natural England's
                      open SSSI Units layer. © Natural England (OGL v3).
  data/osm.geojson    Paths and tracks, gates, stiles, cattle grids, footbridges, hides, boards,
                      car parks, and walls/fences where mapped, from OpenStreetMap via Overpass.
                      © OpenStreetMap contributors (ODbL).

Each reserve's box plus about 800 m. Re-run to refresh (both change slowly).
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEAM = ["1006114", "1006954", "1006126", "1006058", "1006067", "1006018", "1006111"]
PAD = 0.008  # degrees, ~800 m
UNITS = "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/SSSI_Units_England/FeatureServer/1/query"
OVERPASS = "https://overpass-api.de/api/interpreter"


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "GridRef overlay builder (nickjsykes.github.io/gridref)"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())
        except Exception as err:  # Overpass rate-limits; wait and retry
            print(f"  retry {attempt + 1}: {err}")
            time.sleep(15 * (attempt + 1))
    raise SystemExit(f"gave up on {url[:80]}")


def boxes():
    gj = json.loads((ROOT / "data" / "nnr.geojson").read_text("utf-8"))
    for f in gj["features"]:
        if f["properties"]["REF_CODE"] not in TEAM:
            continue
        g = f["geometry"]
        cs = [c for p in (g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]) for c in p[0]]
        yield f["properties"]["LABEL"], (min(c[0] for c in cs) - PAD, min(c[1] for c in cs) - PAD / 1.7,
                                         max(c[0] for c in cs) + PAD, max(c[1] for c in cs) + PAD / 1.7)


def rounded(geom, nd=5):
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def units():
    out, seen = [], set()
    for label, (w, s, e, n) in boxes():
        q = urllib.parse.urlencode({"where": "1=1", "geometry": f"{w},{s},{e},{n}", "geometryType": "esriGeometryEnvelope", "inSR": 4326,
                                    "spatialRel": "esriSpatialRelIntersects", "outFields": "SSSI_NAME,NUMBER,CONDITION,ID", "outSR": 4326,
                                    "maxAllowableOffset": 0.000015, "f": "geojson"})
        got = get(f"{UNITS}?{q}")
        for f in got.get("features", []):
            p = f["properties"]
            if p["ID"] in seen or not f.get("geometry"):
                continue
            seen.add(p["ID"])
            out.append({"type": "Feature", "geometry": rounded(f["geometry"]),
                        "properties": {"sssi": p["SSSI_NAME"], "unit": p["NUMBER"], "condition": (p["CONDITION"] or "").capitalize()}})
        print(f"  {label}: {len(got.get('features', []))} units")
    return out


# What we keep from OpenStreetMap, and the kind each becomes in the app
KEEP = [
    ("gate", lambda t: t.get("barrier") in ("gate", "kissing_gate", "lift_gate", "swing_gate", "hampshire_gate")),
    ("stile", lambda t: t.get("barrier") in ("stile", "step_over") or t.get("stile")),
    ("grid", lambda t: t.get("barrier") == "cattle_grid"),
    ("hide", lambda t: t.get("leisure") == "bird_hide" or t.get("amenity") == "hunting_stand"),
    ("board", lambda t: t.get("tourism") == "information" and t.get("information") in ("board", "map", "guidepost")),
    ("parking", lambda t: t.get("amenity") == "parking"),
    ("bridge", lambda t: t.get("highway") in ("footway", "path", "bridleway", "track", "steps") and t.get("bridge") not in (None, "no")),
    ("path", lambda t: t.get("highway") in ("footway", "path", "bridleway", "steps")),
    ("track", lambda t: t.get("highway") == "track"),
    ("wall", lambda t: t.get("barrier") in ("wall", "retaining_wall") or t.get("wall") == "dry_stone"),
    ("fence", lambda t: t.get("barrier") in ("fence", "hedge")),
]


def osm():
    parts = []
    for label, (w, s, e, n) in boxes():
        b = f"{s},{w},{n},{e}"
        parts.append(f'nwr["barrier"]({b});nwr["highway"~"^(footway|path|bridleway|track|steps)$"]({b});'
                     f'nwr["leisure"="bird_hide"]({b});nwr["tourism"="information"]({b});nwr["amenity"="parking"]({b});')
    q = f"[out:json][timeout:180];({''.join(parts)});out geom;"
    data = get(OVERPASS, urllib.parse.urlencode({"data": q}).encode())
    out = []
    for el in data.get("elements", []):
        t = el.get("tags", {})
        kind = next((k for k, test in KEEP if test(t)), None)
        if not kind:
            continue
        if el["type"] == "node":
            geom = {"type": "Point", "coordinates": [round(el["lon"], 6), round(el["lat"], 6)]}
        elif el["type"] == "way" and el.get("geometry"):
            pts = [[round(p["lon"], 6), round(p["lat"], 6)] for p in el["geometry"]]
            if kind in ("parking", "hide", "board"):  # an area: keep its middle as a point
                geom = {"type": "Point", "coordinates": [round(sum(p[0] for p in pts) / len(pts), 6), round(sum(p[1] for p in pts) / len(pts), 6)]}
            else:
                geom = {"type": "LineString", "coordinates": pts}
        else:
            continue
        props = {"kind": kind}
        for k in ("name", "ref", "surface", "designation"):
            if t.get(k):
                props[k] = t[k]
        if t.get("designation") in ("public_footpath", "public_bridleway", "byway_open_to_all_traffic", "restricted_byway"):
            props["prow"] = 1
        out.append({"type": "Feature", "geometry": geom, "properties": props})
    print(f"  OSM: {len(out)} features")
    return out


def main():
    print("SSSI units")
    u = units()
    (ROOT / "data" / "units.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": u}, separators=(",", ":")), "utf-8", newline="\n")
    print("OpenStreetMap")
    o = osm()
    (ROOT / "data" / "osm.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": o}, separators=(",", ":")), "utf-8", newline="\n")
    for name in ("units", "osm"):
        print(f"data/{name}.geojson: {(ROOT / 'data' / f'{name}.geojson').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
