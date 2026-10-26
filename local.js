// Offline search: OS Open Names (named places) and Code-Point Open (postcodes) for
// the SD and NY squares, built by build/build_offline.py. Loaded on first use and
// kept by the service worker, so place and postcode search work with no signal.
(function (root) {
  const OSGB = root.OSGB;
  let places = null, postcodes = null, loading = null;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  // Settlements and natural features before schools and substations
  const RANK = { City: 0, Town: 0, Village: 1, Hamlet: 1, "Other Settlement": 1, "Suburban Area": 2, "Woodland Or Forest": 1, "Hill Or Mountain": 1,
    "Inland Water": 1, Valley: 2, Wetland: 2, Waterfall: 2, Island: 2, Bay: 2, Beach: 2, "Railway Station": 2 };

  function load() {
    if (loading) return loading;
    loading = Promise.all([
      fetch("data/places.json").then((r) => r.json()),
      fetch("data/postcodes.json").then((r) => r.json()),
    ]).then(([p, c]) => {
      places = { ...p, norm: p.rows.map((r) => norm(r[0])) };
      postcodes = new Map();
      for (const row of c.rows.split(";")) {
        const [pc, e, n] = row.split(",");
        postcodes.set(pc, [+e, +n]);
      }
      postcodes.areas = c.areas;
    }).catch((err) => { loading = null; throw err; });
    return loading;
  }

  function toItem(name, sub, tag, e, n, zoom) {
    const ll = OSGB.gridToWgs84(e, n);
    return { title: name, sub, tag, lat: ll.lat, lon: ll.lon, zoom, e, n };
  }

  // Best matches for a place name, nearest first among equally good matches
  async function searchPlaces(text, near, limit = 8) {
    await load();
    const q = norm(text);
    if (q.length < 2) return [];
    const words = q.split(" ");
    const c = near ? OSGB.wgs84ToGrid(near.lat, near.lng) : null;
    const hits = [];
    places.norm.forEach((nm, i) => {
      let score;
      if (nm === q) score = 0;
      else if (nm.startsWith(q)) score = 1;
      else {
        const nw = nm.split(" ");
        if (words.every((w) => nw.some((x) => x.startsWith(w)))) score = 2;
        else if (nm.includes(q)) score = 3;
        else return;
      }
      const r = places.rows[i], type = places.types[r[1]];
      const dist = c ? Math.hypot(r[2] - c.e, r[3] - c.n) : 0;
      hits.push({ i, score: score * 10 + (RANK[type] ?? 3), dist });
    });
    hits.sort((a, b) => a.score - b.score || a.dist - b.dist);
    return hits.slice(0, limit).map(({ i, dist }) => {
      const [name, t, e, n, cx] = places.rows[i];
      const type = places.types[t].split(",")[0];
      const ctx = places.contexts[cx];
      const away = c ? (dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(dist < 10000 ? 1 : 0)} km`) + " away" : "";
      const zoom = /City|Town/.test(type) ? 13 : /Village|Hamlet|Settlement|Suburban/.test(type) ? 15 : 16;
      return toItem(name, [type, ctx !== name ? ctx : "", away].filter(Boolean).join(" · "), "", e, n, zoom);
    });
  }

  async function postcode(code) {
    await load();
    const pc = code.replace(/\s+/g, "").toUpperCase();
    const hit = postcodes.get(pc);
    if (!hit) return null;
    return toItem(pc.slice(0, -3) + " " + pc.slice(-3), "Postcode", "Postcode", hit[0], hit[1], 17);
  }

  // Centre of every postcode in a district, e.g. LA12
  async function outcode(code) {
    await load();
    const oc = code.toUpperCase();
    let e = 0, n = 0, k = 0;
    for (const [pc, [pe, pn]] of postcodes) if (pc.slice(0, -3) === oc) { e += pe; n += pn; k++; }
    return k ? toItem(oc, `${k} postcodes`, "Postcode area", e / k, n / k, 13) : null;
  }

  // Does the offline data cover this postcode area at all?
  const covers = (code) => postcodes && postcodes.areas.includes(code.toUpperCase().match(/^[A-Z]{1,2}/)[0]);

  root.LocalSearch = { load, searchPlaces, postcode, outcode, covers, norm };
})(typeof window !== "undefined" ? window : globalThis);
