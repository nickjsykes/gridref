"""Build offline search data from Ordnance Survey open data (OGL v3).

Inputs (download into build/src, see README):
  opname.zip  - OS Open Names, CSV
  codepo.zip  - OS Code-Point Open, CSV
Output: data/places.json - named places in the SD and NY 100 km squares
        data/postcodes.json - every LA and CA postcode with its grid position
"""
import csv, io, json, re, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "src"
OUT = ROOT / "data"
SQUARES = ("SD", "NY")
POSTCODE_AREAS = ("la", "ca")
# Open Names types worth finding in the field. Roads and postcodes are left out:
# roads are tens of thousands of rows, postcodes come from Code-Point.
SKIP_LOCAL = {"Postcode", "Named Road", "Section Of Named Road", "Numbered Road", "Section Of Numbered Road"}


def places():
    z = zipfile.ZipFile(SRC / "opname.zip")
    head = next(csv.reader(io.TextIOWrapper(z.open("Doc/OS_Open_Names_Header.csv"), "utf-8-sig")))
    types, contexts, rows = [], [], []
    tix, cix = {}, {}
    names = [n for n in z.namelist() if re.match(r"Data/(%s)\d\d\.csv$" % "|".join(SQUARES), n)]
    for name in sorted(names):
        for r in csv.reader(io.TextIOWrapper(z.open(name), "utf-8")):
            d = dict(zip(head, r))
            local = d["LOCAL_TYPE"]
            if local in SKIP_LOCAL:
                continue
            context = d["POPULATED_PLACE"] or d["DISTRICT_BOROUGH"] or d["COUNTY_UNITARY"]
            if local not in tix:
                tix[local] = len(types); types.append(local)
            if context not in cix:
                cix[context] = len(contexts); contexts.append(context)
            rows.append([d["NAME1"], tix[local], round(float(d["GEOMETRY_X"])), round(float(d["GEOMETRY_Y"])), cix[context]])
    return {"types": types, "contexts": contexts, "rows": rows, "squares": SQUARES}


def postcodes():
    z = zipfile.ZipFile(SRC / "codepo.zip")
    out = []
    for area in POSTCODE_AREAS:
        for r in csv.reader(io.TextIOWrapper(z.open(f"Data/CSV/{area}.csv"), "utf-8")):
            pc, e, n = r[0].replace(" ", ""), int(r[2]), int(r[3])
            if e and n:
                out.append(f"{pc},{e},{n}")
    return {"areas": [a.upper() for a in POSTCODE_AREAS], "rows": ";".join(out)}


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    p = places()
    (OUT / "places.json").write_text(json.dumps(p, separators=(",", ":"), ensure_ascii=False), "utf-8", newline="\n")
    c = postcodes()
    (OUT / "postcodes.json").write_text(json.dumps(c, separators=(",", ":")), "utf-8", newline="\n")
    print(f"places: {len(p['rows'])} in {', '.join(SQUARES)}; postcodes: {c['rows'].count(';') + 1} in {', '.join(c['areas'])}")
    for f in OUT.iterdir():
        print(f"  {f.name}: {f.stat().st_size / 1e6:.2f} MB")
