// node test/parse.test.js : every format the search box should understand
require("../osgb.js"); require("../parse.js");
const P = globalThis.GridSearch.parse, O = globalThis.OSGB;
const cases = ["SD 3390 8360", "sd339836", "SD33908360", "SD 33905 83605", "NY21", "SK12", "LA12 8AA", "la128aa", "LA12", "LA12 8", "NE12",
  "333905, 483605", "E 333905 N 483605", "333905E 483605N", "N 483605 E 333905", "Easting 333905 Northing 483605", "(333905 483605)", "333905 1083605",
  "54.24385, -3.01574", "54.24385 -3.01574", "-3.01574, 54.24385", "54.24385N 3.01574W", "N54.24385 W3.01574", "lat 54.24385 long -3.01574",
  "54°14'37.9\"N 3°00'56.7\"W", "54° 14.632′ N, 3° 0.944′ W", "54 14 38 N 3 0 57 W", "N 54 14 38, W 3 0 57", "54 14 38 -3 0 57", "54:14:38N 003:00:57W",
  "///ramming.breaches.tint", "ramming.breaches.tint", "https://w3w.co/ramming.breaches.tint",
  "https://www.google.com/maps/place/Roudsea/@54.2438,-3.0157,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d54.24385!4d-3.01574",
  "https://www.google.com/maps/@54.2438,-3.0157,15z", "https://maps.google.com/?q=54.24385,-3.01574", "https://maps.apple.com/?ll=54.24385,-3.01574&q=Pin",
  "https://www.openstreetmap.org/?mlat=54.24385&mlon=-3.01574#map=15/54.24/-3.01", "https://www.openstreetmap.org/#map=15/54.24385/-3.01574", "geo:54.24385,-3.01574",
  "https://explore.osmaps.com/?lat=54.24385&lon=-3.01574&zoom=14", "https://maps.app.goo.gl/abc123", "Roudsea Wood", "Haverthwaite", "St. Bees"];
for (const c of cases) {
  const r = P(c);
  const out = r.length ? r.map((x) => {
    if (x.lat == null) return x.kind + " " + (x.code || x.words || "");
    const g = O.wgs84ToGrid(x.lat, x.lon);
    return x.label + " → " + O.gridRef(g.e, g.n, 8);
  }).join(" | ") : "(place search)";
  console.log(c.slice(0, 46).padEnd(46), "=>", out);
}
