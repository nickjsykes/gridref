// Works out what someone typed or pasted into the search box.
// Returns a list of readings, best first: { kind, label, lat, lon, zoom } for anything
// resolvable offline, { kind: "postcode" | "outcode" | "w3w", ... } for things that need
// a lookup. An empty list means treat it as a place name. "SK12" is both a grid square
// and a Stockport postcode district, so it gets two readings.
(function (root) {
  const OSGB = root.OSGB;
  const inUK = (lat, lon) => lat > 49 && lat < 61.5 && lon > -11 && lon < 2.5;
  const valid = (lat, lon) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  function fromGrid(e, n, label, zoom) {
    const ll = OSGB.gridToWgs84(e, n);
    return { kind: "grid", label, lat: ll.lat, lon: ll.lon, zoom };
  }

  // Map links: Google, Apple, OSM, Bing, OS Maps, geo: URIs, what3words links
  function fromLink(text) {
    if (!/^(https?:\/\/|geo:|www\.|maps\.|w3w\.co)/i.test(text)) return null;
    let s = text;
    try { s = decodeURIComponent(text); } catch {}
    const w3w = s.match(/(?:w3w\.co|what3words\.com)\/(?:\/\/\/)?([^\s\/?#.]+\.[^\s\/?#.]+\.[^\s\/?#.]+)/i);
    if (w3w) return { kind: "w3w", words: w3w[1].toLowerCase() };
    const num = "(-?\\d{1,3}\\.\\d+)";
    const patterns = [
      new RegExp("!3d" + num + "!4d" + num),                      // Google place pin
      new RegExp("[?&](?:q|ll|query|daddr|destination|center|sll|cp)=" + num + "(?:,|%2C|~|\\s)+" + num),
      new RegExp("[?&]lat=" + num + ".*[?&](?:lon|lng|long)=" + num),
      new RegExp("[?&]mlat=" + num + "&mlon=" + num),             // OSM marker
      new RegExp("#map=\\d+(?:\\.\\d+)?\\/" + num + "\\/" + num),  // OSM view
      new RegExp("@" + num + "," + num),                           // Google view
      new RegExp("^geo:" + num + "," + num),
      new RegExp("\\/" + num + ",\\s*" + num),                     // what3words.com/lat,lng etc.
    ];
    for (const re of patterns) {
      const m = s.match(re);
      if (m && valid(+m[1], +m[2])) return { kind: "latlon", label: "Map link", lat: +m[1], lon: +m[2], zoom: 16 };
    }
    return { kind: "link-unknown" };
  }

  function fromGridRef(text) {
    const g = OSGB.parseGridRef(text);
    if (!g) return null;
    const zoom = g.size >= 10000 ? 11 : g.size >= 1000 ? 14 : g.size >= 100 ? 16 : 17;
    const digits = String(text).replace(/[^0-9]/g, "").length;
    const r = fromGrid(g.e, g.n, digits ? `OS grid ref, ${digits}-figure` : "OS 100 km square", zoom);
    r.title = digits ? OSGB.gridRef(g.e, g.n, digits) : OSGB.gridRef(g.e, g.n, 2).slice(0, 2); // as typed, tidied
    return r;
  }

  // "333905, 483605" / "E 333905 N 483605" / "333905E 483605N" / "(333905 483605)"
  function fromEastingNorthing(text) {
    const s = text.toUpperCase().replace(/EASTINGS?|NORTHINGS?/g, " ").replace(/[()\[\]:=]/g, " ");
    let m = s.match(/^\s*E?\s*(\d{3,6}(?:\.\d+)?)\s*E?\s*[,;\/\s]\s*N?\s*(\d{3,7}(?:\.\d+)?)\s*N?\s*$/);
    let e, n;
    if (m) { e = +m[1]; n = +m[2]; }
    else if ((m = s.match(/^\s*N\s*(\d{3,7}(?:\.\d+)?)\s*[,;\/\s]\s*E\s*(\d{3,6}(?:\.\d+)?)\s*$/))) { n = +m[1]; e = +m[2]; }
    else return null;
    if (e < 1000 || n < 1000 || !OSGB.inGrid(e, n)) return null;
    return fromGrid(e, n, "Easting / northing", 17);
  }

  // Decimal degrees, degrees-minutes, degrees-minutes-seconds, any punctuation,
  // hemisphere letters before or after, either order.
  function fromLatLon(text) {
    let s = " " + text.toUpperCase() + " ";
    s = s.replace(/\bNORTH\b/g, "N").replace(/\bSOUTH\b/g, "S").replace(/\bEAST\b/g, "E").replace(/\bWEST\b/g, "W");
    s = s.replace(/\b(LATITUDE|LONGITUDE|LAT|LONG|LON|LNG)\b/g, " ");
    s = s.replace(/[°º˚′″'"`’”:dhms]/gi, (c) => (/[NSEW]/.test(c) ? c : " "));
    if (/[^0-9NSEW.,;+\-\s\/]/.test(s)) return null;
    const tokens = s.match(/[NSEW]|[+-]?\d+(?:\.\d+)?|[,;\/]/g);
    if (!tokens) return null;
    const groups = [];
    let cur = { nums: [], hemi: null };
    const close = () => { if (cur.nums.length) groups.push(cur); cur = { nums: [], hemi: null }; };
    for (const t of tokens) {
      if (/^[,;\/]$/.test(t)) close();
      else if (/^[NSEW]$/.test(t)) {
        if (cur.nums.length && cur.hemi) { close(); cur.hemi = t; } // "N54 W3": a new leading letter
        else if (cur.nums.length) { cur.hemi = t; close(); }      // "54N 3W": a trailing letter
        else cur.hemi = t;
      } else {
        cur.nums.push(t);
      }
    }
    close();
    // "54 14 38 3 0 57" with no separators: split down the middle
    if (groups.length === 1 && !groups[0].hemi && groups[0].nums.length % 2 === 0 && groups[0].nums.length >= 2) {
      const h = groups[0].nums.length / 2;
      groups.splice(0, 1, { nums: groups[0].nums.slice(0, h), hemi: null }, { nums: groups[0].nums.slice(h), hemi: null });
    }
    if (groups.length !== 2 || groups.some((g) => g.nums.length > 3)) return null;
    const vals = [];
    for (const g of groups) {
      const [d, m = "0", sec = "0"] = g.nums;
      if (+m >= 60 || +sec >= 60) return null;
      if (g.nums.length > 1 && /\./.test(d)) return null;
      let v = Math.abs(+d) + +m / 60 + +sec / 3600;
      if (d.startsWith("-") || g.hemi === "S" || g.hemi === "W") v = -v;
      vals.push({ v, hemi: g.hemi, dms: g.nums.length > 1 });
    }
    let lat, lon;
    const [a, b] = vals;
    if (/[EW]/.test(a.hemi || "") || /[NS]/.test(b.hemi || "")) { lon = a.v; lat = b.v; }
    else { lat = a.v; lon = b.v; }
    // "-3.01, 54.24": no letters but clearly the wrong way round for the UK
    if (!a.hemi && !b.hemi && !inUK(lat, lon) && inUK(lon, lat)) [lat, lon] = [lon, lat];
    if (!valid(lat, lon)) return null;
    // Two big bare integers are eastings/northings, not degrees
    if (!a.dms && !b.dms && Math.abs(lat) > 90) return null;
    return { kind: "latlon", label: a.dms || b.dms ? "Lat / long (deg min sec)" : "Lat / long", lat, lon, zoom: 16 };
  }

  function fromW3W(text) {
    const m = text.trim().toLowerCase().match(/^(?:\/\/\/)?\s*([\p{L}]+)\.([\p{L}]+)\.([\p{L}]+)$/u);
    return m ? { kind: "w3w", words: `${m[1]}.${m[2]}.${m[3]}` } : null;
  }

  function fromPostcode(text) {
    const t = text.trim().toUpperCase();
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/.test(t)) return { kind: "postcode", code: t.replace(/\s+/g, "") };
    const out = t.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\s+\d)?$/);
    if (out) return { kind: "outcode", code: out[1] };
    return null;
  }

  // Plus codes (Open Location Code): what Google Maps shares, e.g. "9C6WPXQ7+5F" or the short
  // "PXQ7+5F Ulverston", which needs a place (or where the map is) to say which one.
  const OLC = "23456789CFGHJMPQRVWX", PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];
  function olcDecode(code) {
    const c = code.toUpperCase().replace("+", "").replace(/0+$/, "");
    let lat = -90, lng = -180, rLat = 0, rLng = 0;
    for (let i = 0; i < Math.min(c.length, 10); i += 2) {
      rLat = rLng = PAIR_RES[i / 2];
      lat += OLC.indexOf(c[i]) * rLat;
      lng += OLC.indexOf(c[i + 1]) * rLng;
    }
    for (let i = 10; i < c.length; i++) { // finer grid digits: 5 rows x 4 columns
      rLat /= 5; rLng /= 4;
      const d = OLC.indexOf(c[i]);
      lat += Math.floor(d / 4) * rLat;
      lng += (d % 4) * rLng;
    }
    return { lat: lat + rLat / 2, lon: lng + rLng / 2 };
  }
  function olcEncode(lat, lng, pairs) {
    let a = Math.min(Math.max(lat, -90), 89.9999999) + 90, b = ((lng + 180) % 360 + 360) % 360, s = "";
    for (let i = 0; i < pairs; i++) {
      const r = PAIR_RES[i], da = Math.floor(a / r), db = Math.floor(b / r);
      s += OLC[da] + OLC[db];
      a -= da * r; b -= db * r;
    }
    return s;
  }
  // A short code is the end of a full one: borrow the start from a nearby place
  function olcRecover(code, refLat, refLng) {
    const pad = 8 - code.indexOf("+"), res = Math.pow(20, 2 - pad / 2), half = res / 2;
    const p = olcDecode(olcEncode(refLat, refLng, 4).slice(0, pad) + code);
    if (refLat + half < p.lat && p.lat - res >= -90) p.lat -= res; else if (refLat - half > p.lat && p.lat + res <= 90) p.lat += res;
    if (refLng + half < p.lon) p.lon -= res; else if (refLng - half > p.lon) p.lon += res;
    return p;
  }
  function fromPlusCode(text) {
    const m = text.trim().match(new RegExp(`^([${OLC}]{2,8}\\+[${OLC}]{0,7})(?:[\\s,]+(.+))?$`, "i"));
    if (!m) return null;
    const code = m[1].toUpperCase(), lead = code.indexOf("+");
    if (lead === 8) { const p = olcDecode(code); return { kind: "latlon", label: "Plus code", lat: p.lat, lon: p.lon, zoom: 18 }; }
    if (lead % 2 || lead < 2) return null;
    return { kind: "pluscode", code, locality: (m[2] || "").trim() };
  }

  // A location somewhere inside a longer message ("meet at SD 342 815 by the gate"): try the
  // bits that look like one. Returns readings with a lat/long, each marked "Found in text".
  function findIn(text) {
    const looks = [
      /\b[A-HJ-Z]{2}\s?\d{2,5}\s?\d{2,5}\b/gi,                                   // grid ref
      /-?\d{1,2}\.\d{3,}\s*[,\s]\s*-?\d{1,3}\.\d{3,}/g,                          // lat, long
      new RegExp(`\\b[${OLC}]{4,8}\\+[${OLC}]{2,7}\\b`, "gi"),                   // plus code
      /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi,                                 // postcode
      /(?:\/\/\/)?\b[a-z]+\.[a-z]+\.[a-z]+\b/gi,                                 // what3words
    ];
    const out = [], seen = new Set();
    for (const re of looks) for (const m of text.matchAll(re)) {
      const bit = m[0].trim();
      if (seen.has(bit.toUpperCase())) continue;
      seen.add(bit.toUpperCase());
      for (const r of parse(bit)) if (r.kind !== "bad-ref" && r.kind !== "link-unknown") out.push({ ...r, label: "Found in text", found: bit });
    }
    return out;
  }

  function parse(raw) {
    const text = String(raw || "").trim();
    if (!text) return [];
    const link = fromLink(text);
    if (link) return [link];
    // Looks like a grid ref but isn't one ("SD 123", "ZZ 12 34"): say what's wrong
    const gr = text.toUpperCase().replace(/\s+/g, "").match(/^([A-Z]{2})(\d{1,10})$/);
    if (gr && !fromGridRef(text) && !fromPostcode(text)) {
      const valid = OSGB.parseGridRef(gr[1] + "00") !== null;
      return [{ kind: "bad-ref", message: !valid ? `${gr[1]} isn't an OS grid square. Check the two letters.` : `Grid refs need an even number of digits, e.g. ${gr[1]} 12 34 or ${gr[1]} 123 456.` }];
    }
    return [fromW3W(text), fromGridRef(text), fromPostcode(text), fromPlusCode(text), fromEastingNorthing(text), fromLatLon(text)].filter(Boolean);
  }

  root.GridSearch = { parse, findIn, plusRecover: olcRecover };
})(typeof window !== "undefined" ? window : globalThis);
