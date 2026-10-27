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

  // Typos: how many letters apart two words are (a swap of two neighbours counts as one)
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    return d[a.length][b.length];
  }
  // A typed word is "near" a name word when it's a few letters off (more allowed for long words)
  const nearWord = (w, x) => w.length >= 4 && editDistance(w, x.slice(0, Math.max(w.length, Math.min(x.length, w.length + 2)))) <= (w.length >= 7 ? 2 : 1);
  const fuzzyMatch = (words, nameWords) => words.every((w) => nameWords.some((x) => x.startsWith(w) || nearWord(w, x)));

  // Best matches for a place name, nearest first among equally good matches. When the spelling
  // finds little, near-misses ("Hawkshed", "Rudsea") come back marked "Did you mean".
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
    if (hits.length < 3 && q.length >= 4) {
      const got = new Set(hits.map((h) => h.i));
      places.norm.forEach((nm, i) => {
        if (got.has(i) || !fuzzyMatch(words, nm.split(" "))) return;
        const r = places.rows[i], type = places.types[r[1]];
        const dist = c ? Math.hypot(r[2] - c.e, r[3] - c.n) : 0;
        hits.push({ i, score: 50 + (RANK[type] ?? 3), dist, fuzzy: true });
      });
    }
    hits.sort((a, b) => a.score - b.score || a.dist - b.dist);
    return hits.slice(0, limit).map(({ i, dist, fuzzy }) => {
      const [name, t, e, n, cx] = places.rows[i];
      const type = places.types[t].split(",")[0];
      const ctx = places.contexts[cx];
      const away = c ? (dist < 1000 ? `${Math.round(dist / 10) * 10} m` : `${(dist / 1000).toFixed(dist < 10000 ? 1 : 0)} km`) + " away" : "";
      const zoom = /City|Town/.test(type) ? 13 : /Village|Hamlet|Settlement|Suburban/.test(type) ? 15 : 16;
      return toItem(name, [type, ctx !== name ? ctx : "", away].filter(Boolean).join(" · "), fuzzy ? "Did you mean" : "", e, n, zoom);
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

  root.LocalSearch = { load, searchPlaces, postcode, outcode, covers, norm, fuzzyMatch };
})(typeof window !== "undefined" ? window : globalThis);
